import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { replicaTransportBatch as batch } from './cloudReplicaTransportFixture';
import { CloudReplicaCapacityError, CloudReplicaCloudKeyRequiredError, CloudReplicaTransportError, createCloudflareReplicaTransport } from '../../../src/lib/sync/cloudReplicaTransport';

describe('Cloudflare transport: read and exact receipt authentication', () => {
    it('sends credentialed same-origin reads and returns ciphertext without granting an ACK', async () => {
        const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
            revision: 7,
            fenceEpoch: 3, consentRevision: 1,
            documents: [{ path: '', revision: 7, document: { _sealed: { ciphertext: 'untrusted' } } }],
        }), { status: 200 }));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        const snapshot = await remote.read(['']);
        expect(snapshot.documents[0].document).toEqual({ _sealed: { ciphertext: 'untrusted' } });
        expect(fetcher).toHaveBeenCalledWith('/v1/sync/read', expect.objectContaining({
            method: 'POST', credentials: 'include', mode: 'same-origin', cache: 'no-store', redirect: 'error',
        }));
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('bounds D1 responses and request lifetime without treating malformed bytes as receipt proof', async () => {
        const declaredOversize = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response('{"receipt":null}', {
                headers: { 'Content-Length': String(16 * 1024 + 1) },
            })) as typeof fetch);
        await expect(declaredOversize.receipt(batch)).rejects.toBeInstanceOf(CloudReplicaTransportError);

        let cancelled = false;
        const oversizedStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(16 * 1024 + 1));
            },
            cancel() { cancelled = true; },
        });
        const oversized = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(oversizedStream)) as typeof fetch);
        await expect(oversized.receipt(batch)).rejects.toBeInstanceOf(CloudReplicaTransportError);
        await vi.waitFor(() => expect(cancelled).toBe(true));

        const csrf = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            new Response(JSON.stringify({ receipt: null })));
        await expect(createCloudflareReplicaTransport(csrf as typeof fetch).receipt(batch)).resolves.toBeNull();
        const sent = (csrf.mock.calls[0] as [RequestInfo | URL, RequestInit])[1];
        expect(sent.signal).toBeInstanceOf(AbortSignal);
        expect(sent.signal?.aborted).toBe(false);

        const claimedMissingKey = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ error: 'cloud-key-required' }), {
                status: 428, headers: { 'Content-Type': 'application/json',
                    'Cache-Control': 'no-store', 'Content-Length': String(16 * 1024 + 1) },
            })) as typeof fetch);
        const claim = { mutationId: 'mutation0000000001', expectedRevision: 0,
            expectedFenceEpoch: 1, consentRevision: 1, candidateReplicaId: 'device-a',
            currentReplica: null, checkpointClock: {} };
        await expect(claimedMissingKey.replayStoredClaim(claim, 'csrf'))
            .rejects.toMatchObject({ status: 428 });
        await expect(claimedMissingKey.replayStoredClaim(claim, 'csrf'))
            .rejects.not.toBeInstanceOf(CloudReplicaCloudKeyRequiredError);
    });

    it('does not consider a conflict, timeout or malformed response to be a remote ACK', async () => {
        const conflict = createCloudflareReplicaTransport(vi.fn(async () => new Response(
            JSON.stringify({ error: 'replica-fenced-or-conflict' }), { status: 409 },
        )) as typeof fetch);
        await expect(conflict.receipt(batch)).rejects.toMatchObject({ status: 409 });
        const timedOut = createCloudflareReplicaTransport(vi.fn(async () => {
            throw new TypeError('network unavailable');
        }) as typeof fetch);
        await expect(timedOut.receipt(batch)).rejects.toBeInstanceOf(CloudReplicaTransportError);
        const malformed = createCloudflareReplicaTransport(vi.fn(async () => new Response(
            JSON.stringify({ receipt: { revision: '1', lastSeq: 1 } }),
        )) as typeof fetch);
        await expect(malformed.receipt(batch)).rejects.toBeInstanceOf(CloudReplicaTransportError);
    });

    it('treats only exact 428 no-key as a provisioning precondition', async () => {
        const claim = { mutationId: 'mutation0000000001', expectedRevision: 0,
            expectedFenceEpoch: 1, consentRevision: 1, candidateReplicaId: 'device-a',
            currentReplica: null, checkpointClock: {} };
        const missing = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ error: 'cloud-key-required' }), {
                status: 428, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            })) as typeof fetch);
        await expect(missing.replayStoredClaim(claim, 'csrf'))
            .rejects.toBeInstanceOf(CloudReplicaCloudKeyRequiredError);
        for (const response of [
            new Response('{"error":"unavailable"}', { status: 503 }),
            new Response('{"error":"cloud-key-required"}', { status: 409 }),
            new Response('{"error":"cloud-key-required","owner":"forged"}', {
                status: 428, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            }),
            new Response('<html>unavailable</html>', { status: 428,
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } }),
        ]) {
            const client = createCloudflareReplicaTransport(vi.fn(async () => response) as typeof fetch);
            await expect(client.replayStoredClaim(claim, 'csrf'))
                .rejects.not.toBeInstanceOf(CloudReplicaCloudKeyRequiredError);
        }
    });

    it('distinguishes a bounded exact claim capacity refusal from other conflicts', async () => {
        const claim = { mutationId: 'mutation0000000001', expectedRevision: 0,
            expectedFenceEpoch: 1, consentRevision: 1, candidateReplicaId: 'device-a',
            currentReplica: null, checkpointClock: {} };
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        const exact = createCloudflareReplicaTransport(vi.fn(async () => new Response(
            '{"error":"replica-capacity"}', { status: 409, headers },
        )) as typeof fetch);
        await expect(exact.replayStoredClaim(claim, 'csrf')).rejects.toBeInstanceOf(CloudReplicaCapacityError);
        for (const response of [
            new Response('{"error":"replica-capacity"}', { status: 409 }),
            new Response('{"error":"replica-capacity","proof":true}', { status: 409, headers }),
            new Response('{"error":"replica-capacity"}', { status: 428, headers }),
            new Response('{"error":"replica-capacity"}', { status: 409, headers: { ...headers, 'Content-Length': String(16 * 1024 + 1) } }),
        ]) {
            const remote = createCloudflareReplicaTransport(vi.fn(async () => response) as typeof fetch);
            await expect(remote.replayStoredClaim(claim, 'csrf')).rejects.not.toBeInstanceOf(CloudReplicaCapacityError);
        }
    });

    it('checks the exact batch fingerprint before recognizing a lost ACK receipt', async () => {
        const canonical = JSON.stringify({
            batchId: batch.batchId, consentRevision: 1, documents: [],
            expectedFenceEpoch: 5,
            expectedRevision: 0, lastSeq: 1,
            replica: { generation: 1, replicaId: 'replica-test', slot: 's00' },
        });
        const requestHash = createHash('sha256').update(canonical).digest('hex');
        const receipt = { requestHash, revision: 1, lastSeq: 1, consentRevision: 1,
            replica: { slot: 's00', replicaId: 'replica-test', generation: 1 } };
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ receipt })));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(remote.receipt(batch)).resolves.toEqual({ revision: 1, lastSeq: 1 });
        expect(fetcher).toHaveBeenCalledWith('/v1/sync/receipt', expect.objectContaining({
            method: 'POST', credentials: 'include', mode: 'same-origin',
        }));
        const tampered = createCloudflareReplicaTransport(vi.fn(async () => new Response(
            JSON.stringify({ receipt: { ...receipt, requestHash: '0'.repeat(64) } }),
        )) as typeof fetch);
        await expect(tampered.receipt(batch)).rejects.toBeInstanceOf(CloudReplicaTransportError);
        const absent = createCloudflareReplicaTransport(vi.fn(async () => new Response(
            JSON.stringify({ receipt: null }),
        )) as typeof fetch);
        await expect(absent.receipt(batch)).resolves.toBeNull();
    });

    it('binds a D1 commit status proof to the original batch without producing an ACK', async () => {
        const expectedHash = createHash('sha256').update(JSON.stringify({
            batchId: batch.batchId, consentRevision: batch.consentRevision, documents: [],
            expectedFenceEpoch: batch.expectedFenceEpoch, expectedRevision: batch.expectedRevision,
            lastSeq: batch.lastSeq,
            replica: { generation: 1, replicaId: 'replica-test', slot: 's00' },
        })).digest('hex');
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            outcome: 'not-committed', currentRevision: batch.expectedRevision + 1,
        })));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(remote.commitOutcome(batch, 'csrf-session')).resolves.toEqual({
            outcome: 'not-committed', currentRevision: 1,
        });
        expect(fetcher).toHaveBeenCalledWith('/v1/sync/commit/status', expect.objectContaining({
            credentials: 'include', method: 'POST',
            headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-session' }),
        }));
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))
            .toEqual({
                batchId: batch.batchId, expectedRevision: 0,
                expectedFenceEpoch: 5, consentRevision: 1, requestHash: expectedHash,
            });

        for (const invalid of [
            { outcome: 'not-committed', currentRevision: 0 },
            { outcome: 'committed', currentRevision: 0 },
            { outcome: 'inconclusive', currentRevision: 1 },
            { outcome: 'not-committed', currentRevision: '2' },
            { outcome: 'unknown', currentRevision: 2 },
        ]) {
            const malformed = createCloudflareReplicaTransport(vi.fn(async () =>
                new Response(JSON.stringify(invalid))) as typeof fetch);
            await expect(malformed.commitOutcome(batch, 'csrf-session'))
                .rejects.toBeInstanceOf(CloudReplicaTransportError);
        }
        const conflicting = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ error: 'batch-id-conflict' }), { status: 409 })) as typeof fetch);
        await expect(conflicting.commitOutcome(batch, 'csrf-session')).rejects.toMatchObject({ status: 409 });
        await expect(remote.commitOutcome(batch, '')).rejects.toBeInstanceOf(CloudReplicaTransportError);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});
