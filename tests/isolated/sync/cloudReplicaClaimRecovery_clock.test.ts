import { describe, expect, it } from 'vitest';
import { owner, uid, storage, key, data, prepare, transport } from './cloudReplicaClaimRecoveryFixture';
import { get } from 'idb-keyval';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaMutationReconciliationRequiredError } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal, commitLocal } from '../../../src/lib/sync/localRepository';
import { lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';

describe('D1 claim: causal clock recovery and AEAD verification', () => {
    it('restages a committed claim when only the authenticated cloud clock advanced, preserving journal', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const pending = (await readLocal(owner))!.pending;
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        const control = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: {
                s01: { ...remote.replica, lastSeq: 0, status: 'active' as const,
                    checkpointClock: { s00: 1 } },
            },
        };
        remote.control.mockResolvedValue(control);
        const changed = sealCloudDocument(key, uid, '', { profile: { height: '169' } }, {
            protocolVersion: 3, clock: { s00: 2 }, fields: {},
            writer: { slot: 's00', replicaId: 'existing-remote', generation: 1,
                seq: 2, consentRevision: 1 },
        });
        const remoteSnapshot = {
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 2, document: changed }],
        };
        remote.scanAll.mockResolvedValueOnce(remoteSnapshot);
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('retry-staged');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        const sealed = await get(storage);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(JSON.stringify(sealed)).not.toContain('durable-new-device');
        const after = (await readLocal(owner))!;
        const next = after.cloudflareReplicaClaim!;
        expect(next).toEqual({
            ...staged, mutationId: next.mutationId,
            expectedRevision: 2, checkpointClock: { s00: 2 },
        });
        expect(next.mutationId).not.toBe(staged.mutationId);
        expect(after.replica).toBeNull();
        expect(after.pending).toEqual(pending);

        // The second request survives process restart and is not confused
        // with an ACK of the original membership or business journal.
        lockAllVaults();
        await unlockVaultForOwner(owner);
        const nextControl = { ...control, revision: 3,
            replicas: { s01: { ...control.replicas.s01, checkpointClock: { s00: 2 } } } };
        remote.control.mockResolvedValue(nextControl);
        remote.scanAll.mockResolvedValueOnce({ ...remoteSnapshot, revision: 3,
            documents: [{ ...remoteSnapshot.documents[0], revision: 3 }] });
        remote.replayStoredClaim.mockResolvedValueOnce({
            mutationId: next.mutationId, action: 'checkpoint', revision: 3,
            currentRevision: 3, reconciliationRequired: false, replayed: false,
            baseSeq: 0, replica: remote.replica,
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('adopted');
        const final = (await readLocal(owner))!;
        expect(remote.replayStoredClaim.mock.calls[1][0]).toEqual(next);
        expect(final.cloudflareReplicaClaim).toBeUndefined();
        expect(final.replica).toEqual(remote.replica);
        expect(final.pending.length).toBeGreaterThan(0);
        expect(final.pending.every(op => op.actorId === 's01')).toBe(true);
    });

    it('does not restage committed claim if remote controls diverge during clock recovery', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const original = await get(storage);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        const control = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0, status: 'active' as const,
                checkpointClock: { s00: 1 } } },
        };
        remote.control.mockResolvedValueOnce(control).mockResolvedValueOnce({
            ...control, revision: 3,
        });
        const changed = sealCloudDocument(key, uid, '', { profile: { height: '169' } }, {
            protocolVersion: 3, clock: { s00: 2 }, fields: {},
            writer: { slot: 's00', replicaId: 'existing-remote', generation: 1,
                seq: 2, consentRevision: 1 },
        });
        remote.scanAll.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 2, document: changed }],
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(await get(storage)).toBe(original);
        expect((await readLocal(owner))!.cloudflareReplicaClaim).toEqual(staged);
    });

    it('does not replace a concurrent claim after validating a committed historical receipt', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        const control = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0, status: 'active' as const,
                checkpointClock: { s00: 1 } } },
        };
        remote.control.mockResolvedValueOnce(control).mockImplementationOnce(async () => {
            await updateArchiveRecord<unknown>(owner, raw => ({
                ...(raw as Record<string, unknown>),
                cloudflareReplicaClaim: { ...staged, mutationId: 'concurrent0000000000001' },
            }));
            return control;
        });
        const changed = sealCloudDocument(key, uid, '', { profile: { height: '169' } }, {
            protocolVersion: 3, clock: { s00: 2 }, fields: {},
            writer: { slot: 's00', replicaId: 'existing-remote', generation: 1,
                seq: 2, consentRevision: 1 },
        });
        remote.scanAll.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 2, document: changed }],
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toThrow('Rebase claim D1 concorrente');
        expect((await readLocal(owner))!.cloudflareReplicaClaim?.mutationId)
            .toBe('concurrent0000000000001');
    });

    it('does not adopt or rotate a committed claim after an invalid AEAD scan', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const original = await get(storage);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        remote.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0, status: 'active' as const,
                checkpointClock: { s00: 1 } } },
        });
        const forged = sealCloudDocument(new Uint8Array(32).fill(99), uid, '', {
            profile: { height: '169' },
        }, {
            protocolVersion: 3, clock: { s00: 2 }, fields: {},
            writer: { slot: 's00', replicaId: 'existing-remote', generation: 1,
                seq: 2, consentRevision: 1 },
        });
        remote.scanAll.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 2, document: forged }],
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toThrow();
        expect(remote.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(original);
    });

    it('does not adopt a historical receipt when the server checkpoint clock differs', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const sealed = await get(storage);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        remote.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0,
                status: 'active' as const, checkpointClock: { s00: 2 } } },
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(staged);
    });
});
