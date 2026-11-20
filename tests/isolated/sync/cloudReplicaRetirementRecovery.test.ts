import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { get } from 'idb-keyval';
import { CloudReplicaTransportError } from '../../../src/lib/sync/cloudReplicaTransport';
import { stageCloudflareReplicaRetirement, resumeCloudflareReplicaRetirement } from '../../../src/lib/sync/cloudReplicaRetirementRecovery';
import { adoptReplicaCheckpoint, commitLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { data, owner, storage, stagedRetirement, remoteRetirement } from './cloudReplicaRetirementFixture';

import { resetRetirementFixture, cleanupRetirementFixture } from './cloudReplicaRetirementFixture';

beforeEach(() => resetRetirementFixture(catalogSource.read));
afterEach(cleanupRetirementFixture);

describe('candidate D1 durable expired-replica retirement', () => {
    it('stages encrypted intent before network and clears only that intent after stable remote proof', async () => {
        await commitLocal(owner, data(171), data(170));
        const beforeJournal = (await readLocal(owner))!.pending;
        const { target, intent } = await stagedRetirement();
        expect(intent.mutationId).toMatch(/^[0-9a-f-]{36}$/);
        const encrypted = await get(storage);
        expect(encrypted).toMatch(/^tlb-sealed:v1:/);
        expect(JSON.stringify(encrypted)).not.toContain(target.replicaId);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toEqual(intent);

        const transport = remoteRetirement(target);
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('retired');
        expect(transport.replayStoredRetirement).toHaveBeenCalledWith(intent, 'session-csrf');
        expect(transport.control).toHaveBeenCalledTimes(2);
        const after = (await readLocal(owner))!;
        expect(after.cloudflareReplicaRetirement).toBeUndefined();
        expect(after.pending).toEqual(beforeJournal);
        expect(after.replica).toBeNull();
        expect(await resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .toBe('idle');
    });

    it('rebases only a proven-uncommitted expired retirement and persists before retry', async () => {
        await commitLocal(owner, data(171), data(170));
        const { target, intent } = await stagedRetirement();
        const journal = (await readLocal(owner))!.pending;
        const remote = remoteRetirement(target);
        remote.replayStoredRetirement.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.retirementMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        const active = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active' as const,
                lastSeq: 8, checkpointClock: { s00: 4 } } } };
        const retired = { revision: 3, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const,
                lastSeq: 8, checkpointClock: { s00: 4 } } } };
        remote.control.mockResolvedValueOnce(active).mockResolvedValueOnce(active)
            .mockResolvedValueOnce(retired).mockResolvedValueOnce(retired);
        await expect(resumeCloudflareReplicaRetirement(owner, remote, 'session-csrf', () => true))
            .resolves.toBe('retry-staged');
        expect(remote.retirementMutationOutcome).toHaveBeenCalledWith(intent, 'session-csrf');
        expect(remote.replayStoredRetirement).toHaveBeenCalledTimes(1);
        const sealed = await get(storage);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(JSON.stringify(sealed)).not.toContain(target.replicaId);
        const staged = (await readLocal(owner))!;
        const replacement = staged.cloudflareReplicaRetirement!;
        expect(replacement.mutationId).not.toBe(intent.mutationId);
        expect(replacement).toEqual({ ...intent, mutationId: replacement.mutationId,
            expectedRevision: 2 });
        expect(staged.pending).toEqual(journal);

        remote.replayStoredRetirement.mockResolvedValueOnce({
            mutationId: replacement.mutationId, action: 'retire', revision: 3,
            currentRevision: 3, reconciliationRequired: false, replayed: false,
            baseSeq: 8, replica: target,
        });
        await expect(resumeCloudflareReplicaRetirement(owner, remote, 'session-csrf', () => true))
            .resolves.toBe('retired');
        expect(remote.replayStoredRetirement.mock.calls[1][0]).toEqual(replacement);
        expect(remote.control).toHaveBeenCalledTimes(4);
        const after = (await readLocal(owner))!;
        expect(after.cloudflareReplicaRetirement).toBeUndefined();
        expect(after.pending).toEqual(journal);
    });

    it('never changes an old retirement when primary proof is committed or inconclusive', async () => {
        const { target, intent } = await stagedRetirement();
        const remote = remoteRetirement(target);
        const sealed = await get(storage);
        remote.replayStoredRetirement.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.retirementMutationOutcome.mockResolvedValueOnce({
            outcome: 'committed', currentRevision: 1,
        }).mockResolvedValueOnce({ outcome: 'inconclusive', currentRevision: 0 });
        await expect(resumeCloudflareReplicaRetirement(owner, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        await expect(resumeCloudflareReplicaRetirement(owner, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.cloudflareReplicaRetirement).toEqual(intent);
    });

    it('keeps the old intent if the expired incarnation was renewed or reused', async () => {
        const { target, intent } = await stagedRetirement();
        const remote = remoteRetirement(target);
        const sealed = await get(storage);
        remote.replayStoredRetirement.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.retirementMutationOutcome.mockResolvedValue({
            outcome: 'not-committed', currentRevision: 2,
        });
        const renewed = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, leaseUntilMs: Date.now() + 86400000,
                status: 'active' as const, lastSeq: 9, checkpointClock: { s00: 4 } } } };
        const reused = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, replicaId: 'replacement-device', generation: 2,
                status: 'active' as const, lastSeq: 8, checkpointClock: { s00: 4 } } } };
        remote.control.mockResolvedValueOnce(renewed).mockResolvedValueOnce(reused);
        await expect(resumeCloudflareReplicaRetirement(owner, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        await expect(resumeCloudflareReplicaRetirement(owner, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.cloudflareReplicaRetirement).toEqual(intent);
    });

    it('preserves ciphertext when the retirement control moves between proof reads', async () => {
        const { target, intent } = await stagedRetirement();
        const remote = remoteRetirement(target);
        const sealed = await get(storage);
        remote.replayStoredRetirement.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.retirementMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        const control = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active' as const, lastSeq: 8,
                checkpointClock: { s00: 4 } } } };
        remote.control.mockResolvedValueOnce(control)
            .mockResolvedValueOnce({ ...control, revision: 3 });
        await expect(resumeCloudflareReplicaRetirement(owner, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.cloudflareReplicaRetirement).toEqual(intent);
    });

    it('cannot replace a concurrent retirement intent after a successful remote absence proof', async () => {
        const { target, intent } = await stagedRetirement();
        const remote = remoteRetirement(target);
        remote.replayStoredRetirement.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.retirementMutationOutcome.mockResolvedValueOnce({
            outcome: 'not-committed', currentRevision: 2,
        });
        const control = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active' as const, lastSeq: 8,
                checkpointClock: { s00: 4 } } } };
        remote.control.mockResolvedValueOnce(control).mockImplementationOnce(async () => {
            await updateArchiveRecord<unknown>(owner, raw => ({
                ...(raw as Record<string, unknown>),
                cloudflareReplicaRetirement: { ...intent, mutationId: 'concurrent000000000001' },
            }));
            return control;
        });
        await expect(resumeCloudflareReplicaRetirement(owner, remote, 'session-csrf', () => true))
            .rejects.toThrow('Rebase retirement D1 concorrente');
        expect((await readLocal(owner))!.cloudflareReplicaRetirement?.mutationId)
            .toBe('concurrent000000000001');
    });

    it('does not stage retirement of the local writer with possible unsent journal', async () => {
        const now = Date.now();
        const target = { slot: 's02', replicaId: 'current-local-writer',
            generation: 1, checkpointAtMs: now - 86400000, leaseUntilMs: now - 600000 };
        const control = { revision: 0, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active' as const, lastSeq: 0,
                checkpointClock: {} } } };
        await adoptReplicaCheckpoint(owner, {
            identity: target, baseSeq: 0,
        }, { clock: {}, syncMetaByDocument: {} });
        await commitLocal(owner, data(171), data(170));
        const sealed = await get(storage);
        const journal = (await readLocal(owner))!.pending;
        await expect(stageCloudflareReplicaRetirement(owner, control, target, () => true))
            .rejects.toThrow('Retirement D1 non installabile');
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))!.pending).toEqual(journal);
    });

    it('reuses exactly the saved mutation after a timeout rather than inventing another retirement', async () => {
        const { target, intent } = await stagedRetirement();
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(new Error('response lost'));
        const sealed = await get(storage);
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .rejects.toThrow('response lost');
        expect(await get(storage)).toBe(sealed);
        lockAllVaults();
        // Account identity must reopen the real local vault after process restart.
        await unlockVaultForOwner(owner);
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('retired');
        expect(transport.replayStoredRetirement).toHaveBeenCalledTimes(2);
        expect(transport.replayStoredRetirement.mock.calls[0][0]).toEqual(intent);
        expect(transport.replayStoredRetirement.mock.calls[1][0]).toEqual(intent);
    });
});
