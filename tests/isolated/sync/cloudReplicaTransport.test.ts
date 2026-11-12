import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CloudReplicaTransportError, createCloudflareReplicaTransport } from '../../../src/lib/sync/cloudReplicaTransport';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { CloudCiphertextError, sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

describe('isolated Cloudflare document transport', () => {
    const batch = { batchId: 'batch000000000001', expectedRevision: 0, consentRevision: 1,
        replica: { slot: 's00', replicaId: 'replica-test', generation: 1 }, lastSeq: 1, documents: [] };
    it('uses same-origin credentialed requests and never acknowledges unverified ciphertext', async () => {
        const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
            revision: 7,
            fenceEpoch: 3,
            documents: [{ path: '', revision: 7, document: { _sealed: { ciphertext: 'untrusted' } } }],
        }), { status: 200 }));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        const snapshot = await remote.read(['']);
        expect(snapshot.documents[0].document).toEqual({ _sealed: { ciphertext: 'untrusted' } });
        expect(fetcher).toHaveBeenCalledWith('/v1/sync/read', expect.objectContaining({
            method: 'POST', credentials: 'include', mode: 'same-origin', cache: 'no-store', redirect: 'error',
        }));
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

    it('checks the exact batch fingerprint before recognizing a lost ACK receipt', async () => {
        const canonical = JSON.stringify({
            batchId: batch.batchId, consentRevision: 1, documents: [],
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

    it('requires a session-bound CSRF value before any encrypted commit', async () => {
        const fetcher = vi.fn(async () => new Response('{}'));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(remote.commit({
            batchId: 'batch000000000002', expectedRevision: 0, consentRevision: 1,
            replica: { slot: 's00', replicaId: 'replica-test', generation: 1 },
            lastSeq: 1, documents: [],
        }, '')).rejects.toBeInstanceOf(CloudReplicaTransportError);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('loads every monthly page and does not treat a page as a complete account', async () => {
        const paths = ['', ...Array.from({ length: 8 }, (_, i) =>
            `history_months/2026-${String(i + 1).padStart(2, '0')}`)];
        const document = { _sealed: { ciphertext: 'unverified, never hydrated by transport alone' } };
        const pages = [
            { revision: 2, fenceEpoch: 5, complete: false, nextAfter: paths[7],
                documents: paths.slice(0, 8).map(path => ({ path, revision: 2, document })) },
            { revision: 2, fenceEpoch: 5, complete: true, nextAfter: null,
                documents: paths.slice(8).map(path => ({ path, revision: 2, document })) },
        ];
        let index = 0;
        const fetcher = vi.fn(async () => new Response(JSON.stringify(pages[index++])));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        const result = await remote.scanAll();
        expect(result).toEqual({ revision: 2, fenceEpoch: 5,
            documents: pages.flatMap(page => page.documents) });
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))
            .toEqual({ after: null, expectedRevision: null });
        expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string))
            .toEqual({ after: paths[7], expectedRevision: 2 });
    });

    it('rejects incomplete, stale, non-monotone and malformed paginated snapshots', async () => {
        const paths = ['', ...Array.from({ length: 7 }, (_, i) =>
            `nutrition_months/2026-${String(i + 1).padStart(2, '0')}`)];
        const first = { revision: 2, fenceEpoch: 5, complete: false,
            nextAfter: paths[7], documents: paths.map(path => ({
                path, revision: 2, document: { _sealed: {} },
            })) };
        for (const bad of [
            { ...first, revision: 3, complete: true, nextAfter: null, documents: [] },
            { ...first, fenceEpoch: 6, complete: true, nextAfter: null, documents: [] },
            { ...first, complete: true, nextAfter: null,
                documents: [{ path: paths[7], revision: 2, document: {} }] },
            { ...first, complete: false, nextAfter: paths[7], documents: [] },
        ]) {
            let calls = 0;
            const transport = createCloudflareReplicaTransport(vi.fn(async () =>
                new Response(JSON.stringify(calls++ === 0 ? first : bad))) as typeof fetch);
            await expect(transport.scanAll()).rejects.toBeInstanceOf(CloudReplicaTransportError);
        }
        let calls = 0;
        const conflict = createCloudflareReplicaTransport(vi.fn(async () =>
            calls++ === 0 ? new Response(JSON.stringify(first))
                : new Response(JSON.stringify({ error: 'snapshot-changed' }), { status: 409 })) as typeof fetch);
        await expect(conflict.scanAll()).rejects.toMatchObject({ status: 409 });
    });

    it('opens every document with ADK/UID/path before publishing a checkpoint', async () => {
        const key = crypto.getRandomValues(new Uint8Array(32));
        const metadata: SyncMeta = { protocolVersion: 3, clock: { s00: 1 },
            fields: {}, writer: { slot: 's00', replicaId: 'device-synthetic', generation: 1,
                seq: 1, consentRevision: 1 } };
        const business = { profile: { notes: 'synthetic-health-only' } };
        const ciphertext = sealCloudDocument(key, 'synthetic-account', '', business, metadata);
        const scan = async () => ({ revision: 1, fenceEpoch: 5,
            documents: [{ path: '', revision: 1, document: ciphertext }] });
        const verified = await readAuthenticatedCloudflareCheckpoint(
            scan, 'synthetic-account', key, () => true,
        );
        expect(verified.documents.get('')?.business).toEqual(business);
        await expect(readAuthenticatedCloudflareCheckpoint(scan, 'different-account', key, () => true))
            .rejects.toBeInstanceOf(CloudCiphertextError);
        await expect(readAuthenticatedCloudflareCheckpoint(async () => ({ revision: 1, fenceEpoch: 5,
            documents: [{ path: '', revision: 1, document: { ...ciphertext,
                _sync: { ...ciphertext._sync, clock: { s00: 2 } } } }] }),
        'synthetic-account', key, () => true)).rejects.toBeInstanceOf(CloudCiphertextError);
        let current = true;
        await expect(readAuthenticatedCloudflareCheckpoint(async () => {
            current = false;
            return scan();
        }, 'synthetic-account', key, () => current)).rejects.toBeInstanceOf(CloudCiphertextError);
    });

});
