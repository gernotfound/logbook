import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import { CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { adoptReplicaCheckpoint, commitLocal, readLocal } from '../../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../../src/lib/sync/localRepository';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from '../../../src/lib/sync/documentProjection';
import { parseSyncMeta, type SyncMeta, type VectorClock } from '../../../src/lib/sync/semanticProjection';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { readAccountCloudDocument } from '../../../src/lib/sync/cloudDocumentRead';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../../../src/types';

export const owner = 'user:a';
export const key = 'logbook:v2:' + owner;
export const accountKey = new Uint8Array(32).fill(27);
export const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'hydration-diagnostic', updatedAt: '2026-11-08T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
export const state = (
    height: string, nutrition: Record<string, { date: string; weight: number }> = {},
    history: WorkoutSession[] = [],
) => UserDataSchema.parse({ profile: { height }, nutrition, history }) as unknown as UserData;
export const workout = (id: string, date: string): WorkoutSession => ({ id, date, routineName: id, exercises: [] });


export function installLocalCloudHydrationFixture(resetCatalog: () => void) {
    beforeEach(async () => {
        await clear();
        lockAllVaults();
        localStorage.clear();
        vi.stubGlobal('navigator', { locks: {
            request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
        } });
        localStorage.setItem(key + ':health-consent-generation', '1');
        resetCatalog();
        await createAndMigrateVault(owner);
    });
    afterEach(() => {
        lockAllVaults();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
}

// Positive snapshots cross the real cloud codec before the local boundary.
// Empty monthly shells retain their writer, as required after terminal GC.
export function serverSnapshot(input: UserData, clocks: Record<string, VectorClock> = {}, emptyPaths: string[] = []) {
    const projected = projectDocuments(input, catalog);
    for (const path of emptyPaths) projected.set(path, {});
    const documents = new Map<string, DocumentData>();
    const business = new Map<string, DocumentData>();
    const metadata: Record<string, SyncMeta> = {};
    for (const [path, value] of projected) {
        const clock = clocks[path] ?? { s01: 1 };
        const writerDot = Object.entries(clock).find(([, seq]) => seq > 0);
        if (!writerDot) throw new Error('Missing diagnostic server writer');
        const sync: SyncMeta = {
            protocolVersion: CURRENT_SYNC_PROTOCOL, clock, fields: {},
            writer: { slot: writerDot[0], replicaId: `hydration-server-${writerDot[0]}`, generation: 1,
                seq: writerDot[1], consentRevision: 1 },
        };
        const sealed = sealCloudDocument(accountKey, 'a', path, value, sync);
        const decoded = readAccountCloudDocument(sealed, 'diagnostic server snapshot', 'a', path, accountKey);
        const verifiedMeta = parseSyncMeta(decoded.sync);
        documents.set(path, { ...decoded.business, _sync: verifiedMeta });
        business.set(path, decoded.business);
        metadata[path] = verifiedMeta;
    }
    const empty = UserDataSchema.parse({}) as unknown as UserData;
    return { data: applyRemoteDocuments(empty, business, catalog), documents, metadata };
}

export async function snapshot(): Promise<LocalEnvelope> {
    const envelope = await readLocal(owner);
    if (!envelope) throw new Error('Missing diagnostic local envelope');
    return envelope;
}

export async function registerAndEdit(): Promise<LocalEnvelope> {
    const base = await snapshot();
    const now = Date.now();
    await adoptReplicaCheckpoint(owner, {
        identity: { slot: 's00', replicaId: 'hydration-local', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000 },
        baseSeq: 0,
    }, { clock: base.clock, syncMetaByDocument: base.syncMetaByDocument });
    const current = await snapshot();
    const edited = structuredClone(current.data);
    if (!edited.profile) throw new Error('Missing diagnostic profile');
    edited.profile.height = '181';
    edited.pendingConflicts = { nutritionPlanning: { weight: 78 } };
    await commitLocal(owner, edited, current.data, undefined, current.revision,
        { pendingConflicts: edited.pendingConflicts });
    const pending = await snapshot();
    expect(pending.pending.length).toBeGreaterThan(0);
    return pending;
}

export function expectFencedArchive(after: LocalEnvelope, before: LocalEnvelope) {
    if (!before.replica) throw new Error('Missing diagnostic registered replica');
    expect(after).toEqual({
        ...before, cloudIntegrityFence: expect.any(String), revision: before.revision + 1,
        replica: { ...before.replica, checkpointAtMs: 1, leaseUntilMs: 1 },
    });
}

