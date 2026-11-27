import { describe, expect, it, vi } from 'vitest';
import { cancelCloudflareReplicaMutation } from '../../../src/lib/sync/cloudReplicaMutationCancellation';
import { lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { owner, uid, storage, key, data, prepare, transport } from './cloudReplicaClaimRecoveryFixture';
import { get } from 'idb-keyval';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim, resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaCapacityError, CloudReplicaCloudKeyRequiredError } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal, commitLocal, adoptReplicaCheckpoint } from '../../../src/lib/sync/localRepository';

describe('D1 claim: durable staging and first replay', () => {
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
            { revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
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
            { revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
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
