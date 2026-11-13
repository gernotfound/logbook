import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { CachedGlobalCatalog, UserData } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaMutationReconciliationRequiredError } from '../../../src/lib/sync/cloudReplicaTransport';
import type { CloudReplicaControlSnapshot, CloudReplicaMutationResult, CloudReplicaRetirementRequest } from '../../../src/lib/sync/cloudReplicaTransport';
import {
    stageCloudflareReplicaRetirement, resumeCloudflareReplicaRetirement,
} from '../../../src/lib/sync/cloudReplicaRetirementRecovery';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
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
    const control = vi.fn(async (): Promise<CloudReplicaControlSnapshot> => structuredClone(retired));
    return { replayStoredRetirement, control };
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

    it('reuses exactly the saved mutation after a timeout rather than inventing another retirement', async () => {
        const { target, intent } = await stagedRetirement();
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(new Error('response lost'));
        const sealed = await get(storage);
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .rejects.toThrow('response lost');
        expect(await get(storage)).toBe(sealed);
        lockAllVaults();
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('retired');
        expect(transport.replayStoredRetirement).toHaveBeenCalledTimes(2);
        expect(transport.replayStoredRetirement.mock.calls[0][0]).toEqual(intent);
        expect(transport.replayStoredRetirement.mock.calls[1][0]).toEqual(intent);
    });

    it('retains the original encrypted request when the historical receipt is no longer current', async () => {
        const { target, intent } = await stagedRetirement();
        const sealed = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        expect(await resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .toBe('reconciliation-required');
        expect(transport.control).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
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
