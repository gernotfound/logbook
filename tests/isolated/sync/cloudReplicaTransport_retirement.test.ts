import { describe, expect, it, vi } from 'vitest';
import { CloudReplicaMutationReconciliationRequiredError, CloudReplicaTransportError, createCloudflareReplicaTransport } from '../../../src/lib/sync/cloudReplicaTransport';

describe('Cloudflare transport: durable retirement and stale receipt', () => {
    it('validates a retirement receipt before allowing a future local checkpoint', async () => {
        const control = { revision: 8, fenceEpoch: 3, consentRevision: 1, replicas: {} };
        const id = 'mutation0000000100';
        const target = { slot: 's00', replicaId: 'retiring-device', generation: 2 };
        const retirement = { mutationId: id, action: 'retire', revision: 9,
            baseSeq: 8, replayed: false, currentRevision: 9, reconciliationRequired: false,
            replica: { ...target, checkpointAtMs: Date.now() - 300000,
                leaseUntilMs: Date.now() - 200000 } };
        const fetcher = vi.fn(async () => new Response(JSON.stringify(retirement)));
        const client = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(client.retireExpiredReplica(control, target, id, 'csrf'))
            .resolves.toEqual(retirement);
        const changedReplica = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ ...retirement, replica: {
                ...retirement.replica, generation: 3,
            } }))) as typeof fetch);
        await expect(changedReplica.retireExpiredReplica(control, target, id, 'csrf'))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
        const invalid = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ ...retirement, revision: 8 }))) as typeof fetch);
        await expect(invalid.retireExpiredReplica(control, target, id, 'csrf'))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))
            .toEqual({
                mutationId: id, expectedRevision: 8, expectedFenceEpoch: 3,
                consentRevision: 1, replica: target,
            });
    });

    it('replays the original durable retirement body without changing its mutation identity', async () => {
        const request = {
            mutationId: 'mutation0000000333', expectedRevision: 2,
            expectedFenceEpoch: 5, consentRevision: 1,
            replica: { slot: 's03', replicaId: 'old-replica', generation: 2 },
        };
        const receipt = {
            mutationId: request.mutationId, action: 'retire' as const, revision: 3,
            currentRevision: 3, reconciliationRequired: false, replayed: true, baseSeq: 9,
            replica: { ...request.replica,
                checkpointAtMs: Date.now() - 86400000, leaseUntilMs: Date.now() - 360000 },
        };
        const fetcher = vi.fn(async () => new Response(JSON.stringify(receipt)));
        const transport = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(transport.replayStoredRetirement(request, 'csrf')).resolves.toEqual(receipt);
        expect(fetcher).toHaveBeenCalledWith('/v1/sync/replica/retire',
            expect.objectContaining({ method: 'POST', credentials: 'include' }));
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))
            .toEqual(request);

        const wrong = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify({ ...receipt, replica: {
                ...receipt.replica, replicaId: 'another-replica',
            } }))) as typeof fetch);
        await expect(wrong.replayStoredRetirement(request, 'csrf'))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
        await expect(transport.replayStoredRetirement(request, ''))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('binds explicit retirement receipt to all confirmed membership metadata', async () => {
        const target = { slot: 's03', replicaId: 'live-replica', generation: 2 };
        const confirmation = { lastSeq: 9, checkpointAtMs: Date.now() - 1000, leaseUntilMs: Date.now() + 60000 };
        const request = { mutationId: 'mutation0000000333', expectedRevision: 2, expectedFenceEpoch: 5,
            consentRevision: 1, replica: target, confirmation };
        const receipt = { mutationId: request.mutationId, action: 'retire', revision: 3, currentRevision: 3,
            reconciliationRequired: false, replayed: true, baseSeq: confirmation.lastSeq,
            replica: { ...target, checkpointAtMs: confirmation.checkpointAtMs, leaseUntilMs: confirmation.leaseUntilMs } };
        const good = createCloudflareReplicaTransport(vi.fn(async () => new Response(JSON.stringify(receipt))) as typeof fetch);
        await expect(good.replayStoredRetirement(request, 'csrf')).resolves.toEqual(receipt);
        for (const wrong of [{ ...receipt, baseSeq: 10 }, { ...receipt, replica: { ...receipt.replica, leaseUntilMs: confirmation.leaseUntilMs + 1 } },
            { ...receipt, replica: { ...receipt.replica, checkpointAtMs: confirmation.checkpointAtMs + 1 } }]) {
            const remote = createCloudflareReplicaTransport(vi.fn(async () => new Response(JSON.stringify(wrong))) as typeof fetch);
            await expect(remote.replayStoredRetirement(request, 'csrf')).rejects.toBeInstanceOf(CloudReplicaTransportError);
        }
    });

    it('refuses to adopt an old retire receipt after another replica changed the register', async () => {
        const target = { slot: 's00', replicaId: 'old-device', generation: 2 };
        const old = { mutationId: 'mutation0000000203', action: 'retire', revision: 3,
            currentRevision: 4, reconciliationRequired: true, replayed: true, baseSeq: 8,
            replica: { ...target, checkpointAtMs: Date.now() - 400000,
                leaseUntilMs: Date.now() - 300000 } };
        const transport = createCloudflareReplicaTransport(vi.fn(async () =>
            new Response(JSON.stringify(old))) as typeof fetch);
        await expect(transport.retireExpiredReplica({
            revision: 2, fenceEpoch: 3, consentRevision: 1, replicas: {},
        }, target, old.mutationId, 'csrf'))
            .rejects.toBeInstanceOf(CloudReplicaMutationReconciliationRequiredError);
    });

    it('requires a session-bound CSRF value before any encrypted commit', async () => {
        const fetcher = vi.fn(async () => new Response('{}'));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        await expect(remote.commit({
            batchId: 'batch000000000002', expectedRevision: 0, expectedFenceEpoch: 5, consentRevision: 1,
            replica: { slot: 's00', replicaId: 'replica-test', generation: 1 },
            lastSeq: 1, documents: [],
        }, '')).rejects.toBeInstanceOf(CloudReplicaTransportError);
        expect(fetcher).not.toHaveBeenCalled();
    });
});
