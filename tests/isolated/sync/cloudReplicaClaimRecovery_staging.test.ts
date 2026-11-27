import { describe, expect, it, vi } from 'vitest';
import { cancelCloudflareReplicaMutation } from '../../../src/lib/sync/cloudReplicaMutationCancellation';
import { lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { owner, uid, storage, key, data, prepare, transport } from './cloudReplicaClaimRecoveryFixture';
import { get } from 'idb-keyval';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim, resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaCapacityError, CloudReplicaCloudKeyRequiredError } from '../../../src/lib/sync/cloudReplicaTransport';
import type { CloudReplicaControlSnapshot } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal, commitLocal, adoptReplicaCheckpoint } from '../../../src/lib/sync/localRepository';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';

describe('D1 claim: durable staging and first replay', () => {
    async function stagedReplacementWithLateOfflineEdits() {
        const now = Date.now();
        const previous = {
            slot: 's00', replicaId: 'previous-device', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 86400000,
        };
        await adoptReplicaCheckpoint(owner, { identity: previous, baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        const verified = await readAuthenticatedCloudflareCheckpoint(
            async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] }),
            uid, key, 1, () => true,
        );
        const staged = await stageCloudflareReplicaClaim(owner, verified,
            { uid, revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            'new-device-after-retirement', () => true,
        );
        await commitLocal(owner, data(171), data(170));
        const saved = (await readLocal(owner))!;
        expect(saved.pending.length).toBeGreaterThan(0);
        expect(saved.pending.every(op => op.actorId === previous.slot)).toBe(true);
        return { previous, staged, saved };
    }

    it.each(['missing', 'retired', 'expired', 'wrong-owner'] as const)(
        'does not replay a replacement claim with late offline edits and %s membership', async scenario => {
            const { previous, staged, saved } = await stagedReplacementWithLateOfflineEdits();
            const sealed = await get(storage);
            const remote = transport(async revision => ({ revision, fenceEpoch: 5, consentRevision: 1, documents: [] }));
            const membership: CloudReplicaControlSnapshot['replicas'] = scenario === 'missing' ? {} : {
                s00: { ...previous, lastSeq: 0, checkpointClock: {},
                    status: scenario === 'retired' ? 'retired' as const : 'active' as const,
                    leaseUntilMs: scenario === 'expired' ? Date.now() - 600000 : previous.leaseUntilMs },
            };
            remote.control.mockResolvedValueOnce({ uid: scenario === 'wrong-owner' ? 'other' : uid,
                revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: membership });

            await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
                .resolves.toBe('reconciliation-required');
            expect(remote.replayStoredClaim).not.toHaveBeenCalled();
            expect(remote.scanAll).not.toHaveBeenCalled();
            expect(await get(storage)).toBe(sealed);
            expect(await readLocal(owner)).toEqual(saved);
            expect((await readLocal(owner))!.cloudflareReplicaClaim).toEqual(staged);
        });

    it.each(['inconclusive', 'not-committed'] as const)(
        'does not issue an uncommitted %s replacement claim after late offline edits, even with live control', async outcome => {
            const { previous, staged, saved } = await stagedReplacementWithLateOfflineEdits();
            const sealed = await get(storage);
            const remote = transport(async revision => ({ revision, fenceEpoch: 5, consentRevision: 1, documents: [] }));
            remote.control.mockResolvedValueOnce({ uid, revision: outcome === 'not-committed' ? 1 : 0,
                fenceEpoch: 5, consentRevision: 1,
                replicas: { s00: { ...previous, status: 'active', lastSeq: 0, checkpointClock: {} } },
            });
            remote.claimMutationOutcome.mockResolvedValueOnce({ outcome,
                currentRevision: outcome === 'not-committed' ? staged.expectedRevision + 1 : staged.expectedRevision });

            await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
                .resolves.toBe('reconciliation-required');
            expect(remote.claimMutationOutcome).toHaveBeenCalledWith(staged, 'session-csrf');
            expect(remote.replayStoredClaim).not.toHaveBeenCalled();
            expect(remote.scanAll).not.toHaveBeenCalled();
            expect(await get(storage)).toBe(sealed);
            expect(await readLocal(owner)).toEqual(saved);
        });

    it('replays only a primary-ledger-proven committed claim when late offline edits exist', async () => {
        const { previous, staged, saved } = await stagedReplacementWithLateOfflineEdits();
        const remote = transport(async revision => ({ revision, fenceEpoch: 5, consentRevision: 1, documents: [] }));
        const receiptReplica = { ...previous, checkpointAtMs: Date.now(), leaseUntilMs: Date.now() + 86400000 };
        remote.claimMutationOutcome.mockResolvedValueOnce({ outcome: 'committed', currentRevision: 1 });
        remote.replayStoredClaim.mockResolvedValueOnce({
            mutationId: staged.mutationId, action: 'checkpoint', revision: 1,
            currentRevision: 1, reconciliationRequired: false, replayed: true,
            baseSeq: 0, replica: receiptReplica,
        });
        remote.control.mockResolvedValue({ uid, revision: 1, fenceEpoch: 5, consentRevision: 1,
            replicas: { s00: { ...receiptReplica, status: 'active', lastSeq: 0, checkpointClock: {} } },
        });

        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('adopted');
        expect(remote.claimMutationOutcome).toHaveBeenCalledWith(staged, 'session-csrf');
        expect(remote.replayStoredClaim).toHaveBeenCalledWith(staged, 'session-csrf');
        expect((await readLocal(owner))!.pending).toEqual(saved.pending);
        expect((await readLocal(owner))!.cloudflareReplicaClaim).toBeUndefined();
        expect((await readLocal(owner))!.replica).toEqual(receiptReplica);
    });

    it('cannot adopt a previously committed replacement while late edits still belong to the old replica', async () => {
        const { previous, staged, saved } = await stagedReplacementWithLateOfflineEdits();
        const sealed = await get(storage);
        const remote = transport(async revision => ({ revision, fenceEpoch: 5, consentRevision: 1, documents: [] }));
        remote.control.mockResolvedValueOnce({ uid, revision: 1, fenceEpoch: 5, consentRevision: 1,
            replicas: { s00: { ...previous, status: 'active', lastSeq: 0, checkpointClock: {} } },
        });
        remote.claimMutationOutcome.mockResolvedValueOnce({ outcome: 'committed', currentRevision: 1 });
        remote.replayStoredClaim.mockResolvedValueOnce({
            mutationId: staged.mutationId, action: 'reuse-expired', revision: 1,
            currentRevision: 1, reconciliationRequired: false, replayed: true,
            baseSeq: 0, replica: remote.replica,
        });

        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.replayStoredClaim).toHaveBeenCalledWith(staged, 'session-csrf');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.pending).toEqual(saved.pending);
        expect((await readLocal(owner))!.replica).toEqual(previous);
    });

    it('preserves the sealed claim and pending if the primary mutation proof fails', async () => {
        const { previous, staged, saved } = await stagedReplacementWithLateOfflineEdits();
        const sealed = await get(storage);
        const remote = transport(async revision => ({ revision, fenceEpoch: 5, consentRevision: 1, documents: [] }));
        remote.control.mockResolvedValueOnce({ uid, revision: 0, fenceEpoch: 5, consentRevision: 1,
            replicas: { s00: { ...previous, status: 'active', lastSeq: 0, checkpointClock: {} } },
        });
        remote.claimMutationOutcome.mockRejectedValueOnce(new Error('primary D1 unavailable'));

        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toThrow('primary D1 unavailable');
        expect(remote.claimMutationOutcome).toHaveBeenCalledWith(staged, 'session-csrf');
        expect(remote.replayStoredClaim).not.toHaveBeenCalled();
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
        expect(await readLocal(owner)).toEqual(saved);
    });

    it('does not replay when another tab seals cancellation during the remote control read', async () => {
        const { previous, staged, saved } = await stagedReplacementWithLateOfflineEdits();
        const remote = transport(async revision => ({ revision, fenceEpoch: 5, consentRevision: 1, documents: [] }));
        remote.control.mockImplementationOnce(async () => {
            await updateArchiveRecord<unknown>(owner, raw => ({
                ...(raw as Record<string, unknown>), cloudflareReplicaCancellation: staged.mutationId,
            }));
            return { uid, revision: 0, fenceEpoch: 5, consentRevision: 1,
                replicas: { s00: { ...previous, status: 'active', lastSeq: 0, checkpointClock: {} } },
            };
        });

        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.replayStoredClaim).not.toHaveBeenCalled();
        const after = (await readLocal(owner))!;
        expect(after.cloudflareReplicaCancellation).toBe(staged.mutationId);
        expect(after.cloudflareReplicaClaim).toEqual(staged);
        expect(after.pending).toEqual(saved.pending);
    });

    it('keeps the encrypted archive intact when the first control names another owner', async () => {
        const verified = await readAuthenticatedCloudflareCheckpoint(
            async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] }),
            uid, key, 1, () => true,
        );
        const sealed = await get(storage);
        await expect(stageCloudflareReplicaClaim(owner, verified,
            { uid: 'other-owner', revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            'first-device', () => true,
        )).rejects.toThrow('Snapshot claim');
        expect(await get(storage)).toBe(sealed);
    });

    it('still stages the first replica with edits already committed to the local journal', async () => {
        await commitLocal(owner, data(171), data(170));
        const before = (await readLocal(owner))!;
        expect(before.replica).toBeNull();
        expect(before.pending.length).toBeGreaterThan(0);

        const verified = await readAuthenticatedCloudflareCheckpoint(
            async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] }),
            uid, key, 1, () => true,
        );
        const staged = await stageCloudflareReplicaClaim(owner, verified,
            { uid, revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            'first-device-with-offline-work', () => true,
        );

        const after = (await readLocal(owner))!;
        expect(staged.currentReplica).toBeNull();
        expect(after.pending).toEqual(before.pending);
        expect(after.data).toEqual(before.data);
        expect(after.cloudflareReplicaClaim).toEqual(staged);
    });

    it('persists the request before network and atomically adopts after a fresh AEAD scan', async () => {
        const { staged, snapshot } = await prepare();
        expect(staged.mutationId).toMatch(/^[0-9a-f-]{36}$/);
        const sealed = await get(storage);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(JSON.stringify(sealed)).not.toContain('durable-new-device');
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(staged);

        const remote = transport(snapshot);
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('adopted');
        expect(remote.replayStoredClaim).toHaveBeenCalledWith(staged, 'session-csrf');
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.control).toHaveBeenCalledTimes(2);
        const local = (await readLocal(owner))!;
        expect(local.cloudflareReplicaClaim).toBeUndefined();
        expect(local.replica).toEqual(remote.replica);
        expect(local.actorId).toBe(remote.replica.slot);
        expect(local.clock).toEqual({ s00: 1 });
        expect(await resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .toBe('idle');
    });

    it('does not seal a new claim after another tab changed the encrypted local revision', async () => {
        const before = await readLocal(owner);
        const verified = await readAuthenticatedCloudflareCheckpoint(
            async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] }),
            uid, key, 1, () => true,
        );
        await commitLocal(owner, data(171), data(170));
        const sealed = await get(storage);
        await expect(stageCloudflareReplicaClaim(
            owner, verified,
            { uid, revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            'new-synthetic-device', () => true, before!.revision,
        )).rejects.toThrow('Claim D1 non installabile');
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toBeUndefined();
        expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);
    });

    it('keeps the same mutation ID and all journal edits after a network timeout, then recovers', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(new Error('lost reply'));
        const saved = await get(storage);
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toThrow('lost reply');
        expect(await get(storage)).toBe(saved);
        const pending = (await readLocal(owner))!.pending;
        expect(pending.length).toBeGreaterThan(0);

        expect(await resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .toBe('adopted');
        expect(remote.replayStoredClaim).toHaveBeenCalledTimes(2);
        expect(remote.replayStoredClaim.mock.calls[0][0]).toEqual(staged);
        expect(remote.replayStoredClaim.mock.calls[1][0]).toEqual(staged);
        expect((await readLocal(owner))!.pending.length).toBeGreaterThan(0);
        expect((await readLocal(owner))!.pending.every(op => op.actorId === 's01')).toBe(true);
    });

    it('preserves the exact staged claim and journal on capacity without automatic reconciliation', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const sealed = await get(storage);
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaCapacityError());
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toBeInstanceOf(CloudReplicaCapacityError);
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(staged);
        expect(remote.claimMutationOutcome).not.toHaveBeenCalled();
        expect(remote.scanAll).not.toHaveBeenCalled();
    });

    it('cancels only the exact staged claim after proven non-commit and owner-bound control', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const before = (await readLocal(owner))!;
        const sealed = await get(storage);
        const remote = transport(snapshot);
        const cancel = vi.fn(async () => ({ outcome: 'inconclusive' as const, currentRevision: staged.expectedRevision }));
        const api = { cancelReplicaMutation: cancel, control: remote.control };
        await expect(cancelCloudflareReplicaMutation(owner, 'wrong-mutation-id', api, 'session-csrf', () => true)).resolves.toBe('reconciliation-required');
        expect(cancel).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
        await expect(cancelCloudflareReplicaMutation(owner, staged.mutationId, api, 'session-csrf', () => true)).resolves.toBe('reconciliation-required');
        const cancelSealed = await get(storage);
        expect(cancelSealed).not.toBe(sealed);
        expect((await readLocal(owner))!.cloudflareReplicaCancellation).toBe(staged.mutationId);
        expect((await readLocal(owner))!.pending).toEqual(before.pending);
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true)).resolves.toBe('reconciliation-required');
        expect(remote.replayStoredClaim).not.toHaveBeenCalled();
        const proved = { outcome: 'not-committed' as const, currentRevision: staged.expectedRevision + 1 };
        const confirm = vi.fn(async () => proved);
        const control = { uid, revision: proved.currentRevision, fenceEpoch: staged.expectedFenceEpoch, consentRevision: staged.consentRevision, replicas: {} };
        await expect(cancelCloudflareReplicaMutation(owner, staged.mutationId, { cancelReplicaMutation: confirm, control: async () => ({ ...control, uid: 'other' }) }, 'session-csrf', () => true)).resolves.toBe('reconciliation-required');
        expect(await get(storage)).toBe(cancelSealed);
        const lost = vi.fn(async () => { throw new Error('lost cancel reply'); });
        await expect(cancelCloudflareReplicaMutation(owner, staged.mutationId, { cancelReplicaMutation: lost, control: async () => control }, 'session-csrf', () => true)).rejects.toThrow('lost cancel reply');
        expect(await get(storage)).toBe(cancelSealed);
        lockAllVaults();
        await unlockVaultForOwner(owner);
        expect((await readLocal(owner))!.cloudflareReplicaCancellation).toBe(staged.mutationId);
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true)).resolves.toBe('reconciliation-required');
        await expect(adoptReplicaCheckpoint(owner, { identity: remote.replica, baseSeq: 0 },
            { clock: { s00: 1 }, syncMetaByDocument: {} }, () => true, staged.mutationId)).rejects.toThrow('Intento D1');
        expect(remote.replayStoredClaim).not.toHaveBeenCalled();
        await expect(cancelCloudflareReplicaMutation(owner, staged.mutationId, { cancelReplicaMutation: confirm, control: async () => control }, 'session-csrf', () => true)).resolves.toBe('cancelled');
        expect(confirm).toHaveBeenCalledWith(staged, 'session-csrf');
        const after = (await readLocal(owner))!;
        expect(after.cloudflareReplicaClaim).toBeUndefined();
        expect(after.cloudflareReplicaCancellation).toBeUndefined();
        expect(after.pending).toEqual(before.pending);
        expect(after.replica).toEqual(before.replica);
        expect(after.data).toEqual(before.data);
    });

    it('preserves the sealed claim and journal when the cloud key is missing', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const sealed = await get(storage);
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaCloudKeyRequiredError());
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toBeInstanceOf(CloudReplicaCloudKeyRequiredError);
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(staged);
        expect(remote.claimMutationOutcome).not.toHaveBeenCalled();
        expect(remote.scanAll).not.toHaveBeenCalled();
    });
});
