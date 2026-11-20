import { clear } from 'idb-keyval';
import { expect, vi } from 'vitest';
import type { CachedGlobalCatalog, UserData } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { stageCloudflareReplicaRetirement } from '../../../src/lib/sync/cloudReplicaRetirementRecovery';
import type { CloudReplicaClaimMutationOutcome, CloudReplicaControlSnapshot, CloudReplicaMutationResult, CloudReplicaRetirementRequest } from '../../../src/lib/sync/cloudReplicaTransport';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

export const uid = 'a';
export const owner = 'user:' + uid;
export const storage = 'logbook:v2:' + owner;
export const catalog: CachedGlobalCatalog = {
    manifest: { version: 'retirement-fixture', updatedAt: '2026-11-13T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};
export const data = (height: number) =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

export async function resetRetirementFixture(catalogRead: ReturnType<typeof vi.fn>): Promise<void> {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
    } });
    localStorage.setItem('logbook:v2:' + owner + ':health-consent-generation', '1');
    catalogRead.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
}
export function cleanupRetirementFixture(): void {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
}

export async function stagedRetirement() {
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

export function remoteRetirement(target: Awaited<ReturnType<typeof stagedRetirement>>['target']) {
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

