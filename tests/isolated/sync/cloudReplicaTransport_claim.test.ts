import { describe, expect, it, vi } from 'vitest';
import { CloudReplicaMutationReconciliationRequiredError, CloudReplicaTransportError, createCloudflareReplicaTransport } from '../../../src/lib/sync/cloudReplicaTransport';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

describe('Cloudflare transport: primary non-commit and replica claim', () => {
    it('requires a primary SQL non-commit outcome before rotating a durable claim', async () => {
        const claim = {
            mutationId: 'mutation0000000800', expectedRevision: 1,
            expectedFenceEpoch: 5, consentRevision: 1,
            candidateReplicaId: 'candidate-device', currentReplica: null,
            checkpointClock: { s00: 2 },
        };
        const fetcher = vi.fn(async () =>
            new Response(JSON.stringify({ outcome: 'not-committed', currentRevision: 3 })));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(remote.claimMutationOutcome(claim, 'csrf')).resolves.toEqual({
            outcome: 'not-committed', currentRevision: 3,
        });
        expect(fetcher).toHaveBeenCalledWith('/v1/sync/replica/status',
            expect.objectContaining({ method: 'POST', credentials: 'include',
                headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }) }));
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))
            .toEqual(claim);
        for (const invalid of [
            { outcome: 'not-committed', currentRevision: 1 },
            { outcome: 'committed', currentRevision: 0 },
            { outcome: 'not-committed', currentRevision: '4' },
            { outcome: 'unknown', currentRevision: 3 },
        ]) {
            const wrong = createCloudflareReplicaTransport(vi.fn(async () =>
                new Response(JSON.stringify(invalid))) as typeof fetch);
            await expect(wrong.claimMutationOutcome(claim, 'csrf'))
                .rejects.toBeInstanceOf(CloudReplicaTransportError);
        }
        const conflict = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ error: 'mutation-id-conflict' }), { status: 409 })) as typeof fetch);
        await expect(conflict.claimMutationOutcome(claim, 'csrf')).rejects.toMatchObject({ status: 409 });
    });

    it('sends the original membership intent for explicit cancellation, never accepting an unchanged revision as proof', async () => {
        const input = { mutationId: 'mutation0000000800', expectedRevision: 2,
            expectedFenceEpoch: 5, consentRevision: 1, candidateReplicaId: 'candidate-device',
            currentReplica: null, checkpointClock: {} };
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ outcome: 'not-committed', currentRevision: 3 })));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(remote.cancelReplicaMutation(input, 'csrf')).resolves.toEqual({ outcome: 'not-committed', currentRevision: 3 });
        expect(fetcher).toHaveBeenCalledWith('/v1/sync/replica/cancel', expect.objectContaining({ method: 'POST', credentials: 'include',
            headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }) }));
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual(input);
        const bad = createCloudflareReplicaTransport(vi.fn(async () => new Response(JSON.stringify({ outcome: 'not-committed', currentRevision: 2 }))) as typeof fetch);
        await expect(bad.cancelReplicaMutation(input, 'csrf')).rejects.toBeInstanceOf(CloudReplicaTransportError);
    });

    it('uses the original retirement body for primary non-commit proof without a grant', async () => {
        const original = {
            mutationId: 'mutation0000000811', expectedRevision: 4,
            expectedFenceEpoch: 5, consentRevision: 1,
            replica: { slot: 's03', replicaId: 'retiring-device', generation: 2 },
        };
        const fetcher = vi.fn(async () =>
            new Response(JSON.stringify({ outcome: 'not-committed', currentRevision: 6 })));
        const transport = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(transport.retirementMutationOutcome(original, 'csrf'))
            .resolves.toEqual({ outcome: 'not-committed', currentRevision: 6 });
        expect(fetcher).toHaveBeenCalledWith('/v1/sync/replica/status',
            expect.objectContaining({ method: 'POST', credentials: 'include',
                headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }) }));
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))
            .toEqual(original);
        for (const invalid of [
            { outcome: 'not-committed', currentRevision: 4 },
            { outcome: 'committed', currentRevision: 3 },
            { outcome: 'inconclusive', currentRevision: '6' },
        ]) {
            const bad = createCloudflareReplicaTransport(vi.fn(async () =>
                new Response(JSON.stringify(invalid))) as typeof fetch);
            await expect(bad.retirementMutationOutcome(original, 'csrf'))
                .rejects.toBeInstanceOf(CloudReplicaTransportError);
        }
        await expect(transport.retirementMutationOutcome(original, ''))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
    });

    it('loads an authenticated replica register and rejects malformed clocks', async () => {
        const content = { revision: 4, fenceEpoch: 7, consentRevision: 1,
            replicas: { s00: {
                replicaId: 'fixture-device', generation: 1, status: 'active',
                leaseUntilMs: Date.now() + 86400000, checkpointAtMs: Date.now(),
                checkpointClock: { s00: 1 }, lastSeq: 1,
            } } };
        const client = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify(content))) as typeof fetch);
        expect(await client.control()).toEqual(content);
        const owned = { ...content, uid: 'k_' + 'A'.repeat(43) };
        const withOwner = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify(owned))) as typeof fetch);
        expect(await withOwner.control()).toEqual(owned);
        for (const bad of [
            { ...owned, uid: 'bad/uid' },
            { ...owned, uid: ' spaced ' },
            { ...owned, uid: 42 },
            { ...content, replicas: { s99: content.replicas.s00 } },
            { ...content, replicas: { s00: { ...content.replicas.s00, checkpointClock: { wrong: 1 } } } },
            { ...content, replicas: { s00: { ...content.replicas.s00, generation: 0 } } },
            { ...content, replicas: { s00: { ...content.replicas.s00, status: 'unknown' } } },
            { ...content, fenceEpoch: 0 },
        ]) {
            const remote = createCloudflareReplicaTransport(vi.fn(async () =>
                new Response(JSON.stringify(bad))) as typeof fetch);
            await expect(remote.control()).rejects.toBeInstanceOf(CloudReplicaTransportError);
        }
    });

    it('claims a replica only from a complete AEAD-open checkpoint with the same control revision', async () => {
        const key = new Uint8Array(32).fill(19);
        const sync: SyncMeta = { protocolVersion: 3, clock: { s00: 2 }, fields: {},
            writer: { slot: 's00', replicaId: 'device-a', generation: 1, seq: 2, consentRevision: 1 } };
        const encrypted = sealCloudDocument(key, 'owner-fixture', '', { profile: { height: '175' } }, sync);
        const scan = async () => ({ revision: 5, fenceEpoch: 3, consentRevision: 1,
            documents: [{ path: '', revision: 5, document: encrypted }] });
        const checkpoint = await readAuthenticatedCloudflareCheckpoint(
            scan, 'owner-fixture', key, 1, () => true,
        );
        const control = { revision: 5, fenceEpoch: 3, consentRevision: 1, replicas: {} };
        const mutationId = 'mutation0000000099';
        const result = { mutationId, action: 'register', revision: 6,
            replica: { slot: 's01', replicaId: 'device-new', generation: 1,
                checkpointAtMs: Date.now(), leaseUntilMs: Date.now() + 86400000 },
            baseSeq: 0, replayed: false, currentRevision: 6, reconciliationRequired: false };
        const fetcher = vi.fn(async () => new Response(JSON.stringify(result)));
        const client = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(client.claimCheckpoint(checkpoint, control,
            'device-new', null, mutationId, 'session-csrf')).resolves.toEqual(result);
        const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(request[0]).toBe('/v1/sync/replica/claim');
        expect(request[1].headers).toMatchObject({ 'X-CSRF-Token': 'session-csrf' });
        expect(JSON.parse(request[1].body as string)).toEqual({
            mutationId, candidateReplicaId: 'device-new', currentReplica: null,
            expectedRevision: 5, expectedFenceEpoch: 3, consentRevision: 1,
            checkpointClock: { s00: 2 },
        });
        await expect(client.claimCheckpoint(checkpoint, { ...control, revision: 6 },
            'device-new', null, mutationId, 'session-csrf'))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
        await expect(client.claimCheckpoint(checkpoint, control,
            'device-new', null, mutationId, ''))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
        const wrongIdentity = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ ...result, replica: { ...result.replica,
                replicaId: 'unexpected-device' } }))) as typeof fetch);
        await expect(wrongIdentity.claimCheckpoint(checkpoint, control,
            'device-new', null, mutationId, 'csrf'))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('refuses adoption from a historical claim receipt after a concurrent control revision', async () => {
        const key = new Uint8Array(32).fill(19);
        const sync: SyncMeta = { protocolVersion: 3, clock: { s00: 1 }, fields: {},
            writer: { slot: 's00', replicaId: 'device-a', generation: 1, seq: 1, consentRevision: 1 } };
        const encrypted = sealCloudDocument(key, 'owner-fixture', '', { profile: { height: '175' } }, sync);
        const checkpoint = await readAuthenticatedCloudflareCheckpoint(async () => ({
            revision: 5, fenceEpoch: 3, consentRevision: 1,
            documents: [{ path: '', revision: 5, document: encrypted }],
        }), 'owner-fixture', key, 1, () => true);
        const id = 'mutation0000000202';
        const historic = {
            mutationId: id, action: 'register', revision: 6, currentRevision: 9,
            reconciliationRequired: true, replayed: true, baseSeq: 0,
            replica: { slot: 's01', replicaId: 'new-device', generation: 1,
                checkpointAtMs: Date.now(), leaseUntilMs: Date.now() + 86400000 },
        };
        const sender = vi.fn(async () => new Response(JSON.stringify(historic)));
        const transport = createCloudflareReplicaTransport(sender as typeof fetch);
        try {
            await transport.claimCheckpoint(checkpoint, {
                revision: 5, fenceEpoch: 3, consentRevision: 1, replicas: {},
            }, 'new-device', null, id, 'csrf');
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(CloudReplicaMutationReconciliationRequiredError);
            expect((error as CloudReplicaMutationReconciliationRequiredError).historicalReceipt)
                .toMatchObject({ mutationId: id, revision: 6, currentRevision: 9 });
        }
        expect(sender).toHaveBeenCalledTimes(1);
        const invalid = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ ...historic, reconciliationRequired: false }))) as typeof fetch);
        await expect(invalid.claimCheckpoint(checkpoint, {
            revision: 5, fenceEpoch: 3, consentRevision: 1, replicas: {},
        }, 'new-device', null, id, 'csrf')).rejects.toBeInstanceOf(CloudReplicaTransportError);
    });
});
