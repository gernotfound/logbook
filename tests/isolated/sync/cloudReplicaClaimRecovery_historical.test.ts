import { describe, expect, it, vi } from 'vitest';
import { owner, storage, key, data, prepare, transport } from './cloudReplicaClaimRecoveryFixture';
import { get } from 'idb-keyval';
import { resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaMutationReconciliationRequiredError, CloudReplicaTransportError } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal, commitLocal } from '../../../src/lib/sync/localRepository';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';

describe('D1 claim: historical receipt and concurrent intent safety', () => {
    it('keeps a concurrent new claim intent when a stale rebase finishes remotely', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.claimMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        const control = { revision: 2, fenceEpoch: 5, consentRevision: 1, replicas: {} };
        remote.control.mockResolvedValueOnce(control).mockImplementationOnce(async () => {
            await updateArchiveRecord<unknown>(owner, raw => ({
                ...(raw as Record<string, unknown>),
                cloudflareReplicaClaim: { ...staged, mutationId: 'concurrent0000000000001' },
            }));
            return control;
        });
        remote.scanAll.mockResolvedValueOnce(await snapshot(2));
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toThrow('Rebase claim D1 concorrente');
        expect((await readLocal(owner))!.cloudflareReplicaClaim?.mutationId)
            .toBe('concurrent0000000000001');
    });

    it('retains the sealed intent when a historical reply is not a current grant', async () => {
        const { snapshot } = await prepare();
        const before = await get(storage);
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: 'historic', action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(before);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toBeDefined();
    });

    it('refuses historical adoption if the lease expires during the complete AEAD scan', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const original = await get(storage);
        remote.scanAll.mockImplementationOnce(async () => {
            vi.spyOn(Date, 'now').mockReturnValue(remote.replica.leaseUntilMs + 1);
            return snapshot(1);
        });

        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(original);
        const local = (await readLocal(owner))!;
        expect(local.cloudflareReplicaClaim).toEqual(staged);
        expect(local.replica).toBeNull();
    });

    it('adopts a historical claim only after an unchanged active replica and a fresh AEAD scan', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const pendingBefore = (await readLocal(owner))!.pending;
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        remote.control.mockImplementation(async () => ({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: {
                s01: { ...remote.replica, lastSeq: 0, status: 'active' as const,
                    checkpointClock: { s00: 1 } },
            },
        }));
        remote.scanAll.mockImplementation(async () => snapshot(2));

        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('adopted');
        expect(remote.replayStoredClaim).toHaveBeenCalledWith(staged, 'session-csrf');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        const local = (await readLocal(owner))!;
        expect(local.cloudflareReplicaClaim).toBeUndefined();
        expect(local.replica).toEqual(remote.replica);
        expect(local.pending.length).toBeGreaterThan(0);
        expect(local.pending.every(op => op.actorId === 's01')).toBe(true);
        expect(pendingBefore.length).toBeGreaterThan(0);
    });
});
