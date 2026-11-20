import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, expect, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { UserData, CachedGlobalCatalog } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import type { CloudReplicaClaimMutationOutcome, CloudReplicaControlSnapshot, CloudReplicaMutationResult } from '../../../src/lib/sync/cloudReplicaTransport';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

export const owner = 'user:a';
export const uid = 'a';
export const storage = 'logbook:v2:user:a';
export const key = new Uint8Array(32).fill(27);
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'claim-recovery-fixture', updatedAt: '2026-11-13T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
export const data = (height: number) =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
    } });
    localStorage.setItem('logbook:v2:user:a:health-consent-generation', '1');
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

export async function prepare() {
    const cloud = sealCloudDocument(key, uid, '', { profile: { height: '168' } }, {
        protocolVersion: 3, clock: { s00: 1 }, fields: {},
        writer: { slot: 's00', replicaId: 'existing-remote', generation: 1,
            seq: 1, consentRevision: 1 },
    });
    const snapshot = async (revision: number) => ({
        revision, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision, document: cloud }],
    });
    const verified = await readAuthenticatedCloudflareCheckpoint(
        () => snapshot(0), uid, key, 1, () => true,
    );
    const control = { revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} };
    const staged = await stageCloudflareReplicaClaim(owner, verified, control,
        'durable-new-device', () => true);
    return { snapshot, staged };
}

export function transport(snapshot: (revision: number) => Promise<{
    revision: number; fenceEpoch: number; consentRevision: number;
    documents: Array<{ path: string; revision: number; document: ReturnType<typeof sealCloudDocument> }>;
}>) {
    const now = Date.now();
    const replica = {
        slot: 's01', replicaId: 'durable-new-device', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 86400000,
    };
    const mutationResult: CloudReplicaMutationResult = {
        mutationId: '', action: 'register' as const, revision: 1, currentRevision: 1,
        reconciliationRequired: false, replayed: true, baseSeq: 0, replica,
    };
    return {
        replica,
        replayStoredClaim: vi.fn(async (claim: { mutationId: string }, csrf: string): Promise<CloudReplicaMutationResult> => {
            expect(csrf).toBe('session-csrf');
            return { ...mutationResult, mutationId: claim.mutationId };
        }),
        claimMutationOutcome: vi.fn(async (claim: { mutationId: string }, csrf: string): Promise<CloudReplicaClaimMutationOutcome> => {
            expect(claim.mutationId).toBeTruthy();
            expect(csrf).toBe('session-csrf');
            return { outcome: 'inconclusive', currentRevision: 0 };
        }),
        control: vi.fn(async (): Promise<CloudReplicaControlSnapshot> => ({
            revision: 1, fenceEpoch: 5, consentRevision: 1,
            replicas: {
                s01: { ...replica, lastSeq: 0, status: 'active' as const,
                    checkpointClock: { s00: 1 } },
            },
        })),
        scanAll: vi.fn(async () => snapshot(1)),
    };
}

