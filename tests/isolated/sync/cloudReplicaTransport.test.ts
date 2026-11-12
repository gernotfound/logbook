import { describe, expect, it, vi } from 'vitest';
import { CloudReplicaTransportError, createCloudflareReplicaTransport } from '../../../src/lib/sync/cloudReplicaTransport';

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
});
