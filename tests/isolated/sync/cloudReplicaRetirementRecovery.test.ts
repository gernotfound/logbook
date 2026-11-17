import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { CachedGlobalCatalog, UserData } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaMutationReconciliationRequiredError, CloudReplicaTransportError } from '../../../src/lib/sync/cloudReplicaTransport';
import type { CloudReplicaClaimMutationOutcome, CloudReplicaControlSnapshot, CloudReplicaMutationResult, CloudReplicaRetirementRequest } from '../../../src/lib/sync/cloudReplicaTransport';
import {
    stageCloudflareReplicaRetirement, resumeCloudflareReplicaRetirement,
} from '../../../src/lib/sync/cloudReplicaRetirementRecovery';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';

const uid = 'a';
const owner = 'user:' + uid;
const storage = 'logbook:v2:' + owner;
const catalog: CachedGlobalCatalog = {
    manifest: { version: 'retirement-fixture', updatedAt: '2026-11-13T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};
const data = (height: number) =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
    } });
    localStorage.setItem('logbook:v2:' + owner + ':health-consent-generation', '1');
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function stagedRetirement() {
    const now = Date.now();
    const target = {
        slot: 's02', replicaId: 'expired-synthetic-device', generation: 1,
        leaseUntilMs: now - 600000, checkpointAtMs: now - 86400000,
    };
    const control = {
        revision: 0, fenceEpoch: 5, consentRevision: 1,
        replicas: {
            s02: { ...target, status: 'active' as const,
                lastSeq: 8, checkpointClock: { s00: 4 } },
        },
    };
    const intent = await stageCloudflareReplicaRetirement(owner, control, target, () => true);
    return { target, control, intent };
}

function remoteRetirement(target: Awaited<ReturnType<typeof stagedRetirement>>['target']) {
    const retired = {
        revision: 1, fenceEpoch: 5, consentRevision: 1,
        replicas: {
            s02: { ...target, status: 'retired' as const,
                lastSeq: 8, checkpointClock: { s00: 4 } },
        },
    };
    const replayStoredRetirement = vi.fn(async (request: CloudReplicaRetirementRequest, csrf: string): Promise<CloudReplicaMutationResult> => {
        expect(csrf).toBe('session-csrf');
        return {
            mutationId: request.mutationId, action: 'retire' as const,
            revision: 1, currentRevision: 1, reconciliationRequired: false,
            replayed: true, baseSeq: 8, replica: target,
        };
    });
    const retirementMutationOutcome = vi.fn(async (_request: CloudReplicaRetirementRequest, csrf: string): Promise<CloudReplicaClaimMutationOutcome> => {
        expect(csrf).toBe('session-csrf');
        return { outcome: 'inconclusive', currentRevision: 0 };
    });
    const control = vi.fn(async (): Promise<CloudReplicaControlSnapshot> => structuredClone(retired));
    return { replayStoredRetirement, retirementMutationOutcome, control };
}

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

    it('reconciles a historical retirement after unrelated writes without acknowledging journal data', async () => {
        await commitLocal(owner, data(171), data(170));
        const { target, intent } = await stagedRetirement();
        const beforeJournal = (await readLocal(owner))!.pending;
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockImplementation(async () => ({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const, lastSeq: 8,
                checkpointClock: { s00: 4 } } },
        }));
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('retired');
        expect(transport.replayStoredRetirement).toHaveBeenCalledWith(intent, 'session-csrf');
        expect(transport.control).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toBeUndefined();
        expect((await readLocal(owner))?.pending).toEqual(beforeJournal);
    });

    it('closes proven retired membership superseded by a higher generation, without ACK', async () => {
        await commitLocal(owner, data(171), data(170));
        const { target, intent } = await stagedRetirement();
        const journal = (await readLocal(owner))!.pending;
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValue({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, generation: 2, replicaId: 'new-replica',
                status: 'active', lastSeq: 8, checkpointClock: {} } },
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('superseded');
        expect(transport.control).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toBeUndefined();
        expect((await readLocal(owner))?.pending).toEqual(journal);
    });

    it('preserves a historical retirement when identity changes without a higher generation', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValue({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, replicaId: 'unexpected-id',
                status: 'active', lastSeq: 8, checkpointClock: {} } },
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(transport.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(saved);
    });

    it('preserves superseded retirement if remote controls diverge', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        const successor = { revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, generation: 2, replicaId: 'successor',
                status: 'active' as const, lastSeq: 8, checkpointClock: {} } } };
        transport.control.mockResolvedValueOnce(successor)
            .mockResolvedValueOnce({ ...successor, revision: 3 });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(await get(storage)).toBe(saved);
    });

    it('keeps historical intent if the control moves during confirmation', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const, lastSeq: 8,
                checkpointClock: { s00: 4 } } },
        }).mockResolvedValueOnce({
            revision: 3, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const, lastSeq: 8,
                checkpointClock: { s00: 4 } } },
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(transport.control).toHaveBeenCalledTimes(2);
        expect(await get(storage)).toBe(saved);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toEqual(intent);
    });

    it('does not clear a historical intent if the control revision is older than the receipt', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(transport.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(saved);
    });

    it('does not clear historical retirement if receipt membership metadata differs from D1', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValue({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const,
                lastSeq: 9, checkpointClock: { s00: 4 } } },
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(transport.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(saved);
    });

    it('preserves historical retirement when session guard expires after remote confirmation', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValue({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const,
                lastSeq: 8, checkpointClock: { s00: 4 } } },
        });
        let current = true;
        transport.control.mockImplementationOnce(async () => {
            current = false;
            return { revision: 2, fenceEpoch: 5, consentRevision: 1,
                replicas: { s02: { ...target, status: 'retired' as const,
                    lastSeq: 8, checkpointClock: { s00: 4 } } } };
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => current))
            .rejects.toThrow('sessione');
        expect(await get(storage)).toBe(saved);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toEqual(intent);
    });

    it('rejects a moved or inconsistent replica register without clearing retirement or journal', async () => {
        const { target } = await stagedRetirement();
        const sealed = await get(storage);
        const transport = remoteRetirement(target);
        transport.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active' as const,
                lastSeq: 8, checkpointClock: { s00: 4 } } },
        });
        expect(await resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .toBe('reconciliation-required');
        expect(await get(storage)).toBe(sealed);
    });

    it('preserves the ciphertext when session or consent changes before replay', async () => {
        const { target } = await stagedRetirement();
        await updateArchiveRecord<unknown>(owner, raw => ({ ...(raw as object), consentRevision: 2 }));
        const sealed = await get(storage);
        const transport = remoteRetirement(target);
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .rejects.toThrow('Barriera integrità D1');
        expect(transport.replayStoredRetirement).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);

        await expect(stageCloudflareReplicaRetirement(owner, {
            revision: 0, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active' as const,
                lastSeq: 8, checkpointClock: {} } },
        }, target, () => false)).rejects.toThrow('sessione');
    });

    it('blocks simultaneous claim and checkpoint mutation while retirement is unresolved', async () => {
        const { control } = await stagedRetirement();
        const sealed = await get(storage);
        const verified = await readAuthenticatedCloudflareCheckpoint(
            async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] }),
            uid, new Uint8Array(32).fill(5), 1, () => true,
        );
        await expect(stageCloudflareReplicaClaim(owner, verified, control, 'new-device-id', () => true))
            .rejects.toThrow('Claim D1 non installabile');
        await expect(adoptReplicaCheckpoint(owner, {
            identity: { slot: 's00', replicaId: 'new-device-id', generation: 1,
                leaseUntilMs: Date.now() + 86400000, checkpointAtMs: Date.now() },
            baseSeq: 0,
        }, { clock: {}, syncMetaByDocument: {} }))
            .rejects.toThrow('Intento D1');
        expect(await get(storage)).toBe(sealed);
    });

    it('rejects invalid retirement intent from the encrypted archive without erasing the original', async () => {
        await stagedRetirement();
        const original = await get(storage);
        await updateArchiveRecord<unknown>(owner, raw => {
            const saved = raw as { cloudflareReplicaRetirement: {
                replica: { slot: string; replicaId: string; generation: number };
            } };
            return { ...saved, cloudflareReplicaRetirement: { ...saved.cloudflareReplicaRetirement,
                replica: { ...saved.cloudflareReplicaRetirement.replica, slot: 's99' } } };
        });
        await expect(readLocal(owner)).rejects.toThrow('Intento retirement D1 non valido');
        expect(await get(storage)).not.toBe(original);
    });
});
