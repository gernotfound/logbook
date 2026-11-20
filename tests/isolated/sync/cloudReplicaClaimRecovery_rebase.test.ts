import { describe, expect, it } from 'vitest';
import { owner, uid, storage, key, data, prepare, transport } from './cloudReplicaClaimRecoveryFixture';
import { get } from 'idb-keyval';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaTransportError } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal, commitLocal } from '../../../src/lib/sync/localRepository';

describe('D1 claim: 409 rebase and authenticated checkpoint fences', () => {
    it('rebases only a provably uncommitted stale claim and journals its new request before retry', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const beforePending = (await readLocal(owner))!.pending;
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.claimMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        const other = { ...remote.replica, replicaId: 'competing-device' };
        const registered = { ...remote.replica, slot: 's02' };
        const control2 = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: {
                s01: { ...other, lastSeq: 0, status: 'active' as const,
                    checkpointClock: { s00: 1 } },
            } };
        const control3 = { revision: 3, fenceEpoch: 5, consentRevision: 1,
            replicas: {
                ...control2.replicas,
                s02: { ...registered, lastSeq: 0, status: 'active' as const,
                    checkpointClock: { s00: 1 } },
            } };
        remote.control.mockResolvedValueOnce(control2).mockResolvedValueOnce(control2)
            .mockResolvedValueOnce(control3).mockResolvedValueOnce(control3);
        remote.scanAll.mockResolvedValueOnce(await snapshot(2))
            .mockResolvedValueOnce(await snapshot(3));

        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('retry-staged');
        expect(remote.claimMutationOutcome).toHaveBeenCalledWith(staged, 'session-csrf');
        expect(remote.replayStoredClaim).toHaveBeenCalledTimes(1);
        const sealed = await get(storage);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        const after = (await readLocal(owner))!;
        const replacement = after.cloudflareReplicaClaim!;
        expect(replacement.mutationId).not.toBe(staged.mutationId);
        expect(replacement).toEqual({
            ...staged, mutationId: replacement.mutationId, expectedRevision: 2,
        });
        expect(after.pending).toEqual(beforePending);
        expect(after.replica).toBeNull();

        remote.replayStoredClaim.mockResolvedValueOnce({
            mutationId: replacement.mutationId, action: 'register', revision: 3,
            currentRevision: 3, reconciliationRequired: false, replayed: false,
            baseSeq: 0, replica: registered,
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('adopted');
        expect(remote.replayStoredClaim.mock.calls[1][0]).toEqual(replacement);
        const adopted = (await readLocal(owner))!;
        expect(adopted.cloudflareReplicaClaim).toBeUndefined();
        expect(adopted.replica).toEqual(registered);
        expect(adopted.pending.length).toBeGreaterThan(0);
        expect(adopted.pending.every(op => op.actorId === 's02')).toBe(true);
    });

    it('does not rotate after 409 when the primary outcome is committed or inconclusive', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const sealed = await get(storage);
        remote.replayStoredClaim.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.claimMutationOutcome.mockResolvedValueOnce({
            outcome: 'committed', currentRevision: 1,
        }).mockResolvedValueOnce({ outcome: 'inconclusive', currentRevision: 0 });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.cloudflareReplicaClaim).toEqual(staged);
    });

    it('rejects a 409 rebase when the primary revision and control disagree', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const sealed = await get(storage);
        remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.claimMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        // The first control is from a different D1 revision: never stage a
        // new request or assume absence of in-flight mutations from this scan.
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.cloudflareReplicaClaim).toEqual(staged);
    });

    it('stages the latest AEAD checkpoint clock instead of reusing stale causal evidence', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const remote = transport(snapshot);
        const oldPending = (await readLocal(owner))!.pending;
        remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.claimMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        const control = { revision: 2, fenceEpoch: 5, consentRevision: 1, replicas: {} };
        remote.control.mockResolvedValueOnce(control).mockResolvedValueOnce(control);
        const changed = sealCloudDocument(key, uid, '', { profile: { height: '169' } }, {
            protocolVersion: 3, clock: { s00: 2 }, fields: {},
            writer: { slot: 's00', replicaId: 'existing-remote',
                generation: 1, seq: 2, consentRevision: 1 },
        });
        remote.scanAll.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 2, document: changed }],
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('retry-staged');
        const saved = (await readLocal(owner))!;
        expect(saved.cloudflareReplicaClaim?.expectedRevision).toBe(2);
        expect(saved.cloudflareReplicaClaim?.checkpointClock).toEqual({ s00: 2 });
        expect(saved.cloudflareReplicaClaim?.mutationId).not.toBe(staged.mutationId);
        expect(saved.pending).toEqual(oldPending);
    });

    it('does not rotate the old claim if the control advances during the verified scan', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const sealed = await get(storage);
        remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.claimMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        const control = { revision: 2, fenceEpoch: 5, consentRevision: 1, replicas: {} };
        remote.control.mockResolvedValueOnce(control).mockResolvedValueOnce({
            ...control, revision: 3,
        });
        remote.scanAll.mockResolvedValueOnce(await snapshot(2));
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.cloudflareReplicaClaim).toEqual(staged);
    });

    it('preserves the original claim and business journal if the rebase scan is not AEAD-authentic', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.claimMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        remote.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1, replicas: {},
        });
        const forged = sealCloudDocument(new Uint8Array(32).fill(99), uid, '', {
            profile: { height: '168' },
        }, {
            protocolVersion: 3, clock: { s00: 1 }, fields: {},
            writer: { slot: 's00', replicaId: 'existing-remote',
                generation: 1, seq: 1, consentRevision: 1 },
        });
        remote.scanAll.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 2, document: forged }],
        });
        const sealed = await get(storage);
        const pending = (await readLocal(owner))!.pending;
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toThrow();
        expect(remote.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.cloudflareReplicaClaim).toEqual(staged);
        expect((await readLocal(owner))!.pending).toEqual(pending);
    });
});
