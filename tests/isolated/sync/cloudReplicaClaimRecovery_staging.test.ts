import { describe, expect, it } from 'vitest';
import { owner, uid, storage, key, data, prepare, transport } from './cloudReplicaClaimRecoveryFixture';
import { get } from 'idb-keyval';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim, resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaCapacityError, CloudReplicaCloudKeyRequiredError } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal, commitLocal } from '../../../src/lib/sync/localRepository';

describe('D1 claim: durable staging and first replay', () => {
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
