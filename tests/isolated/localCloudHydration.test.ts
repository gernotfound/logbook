import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { UserDataSchema } from '../../src/lib/schema';
import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../../src/lib/schemaEvolution';
import {
    adoptReplicaCheckpoint, commitLocal, hydrateLocal, IncompleteCloudSnapshotError, readLocal,
} from '../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../src/lib/sync/localRepository';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from '../../src/lib/sync/documentProjection';
import { parseSyncMeta, type SyncMeta, type VectorClock } from '../../src/lib/sync/semanticProjection';
import { sealCloudDocument } from '../../src/lib/sync/cloudDocumentCipher';
import { readAccountCloudDocument } from '../../src/lib/sync/cloudDocumentRead';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../../src/types';

const owner = 'user:a';
const key = 'logbook:v2:' + owner;
const accountKey = new Uint8Array(32).fill(27);
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'hydration-diagnostic', updatedAt: '2026-11-08T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const state = (
    height: string, nutrition: Record<string, { date: string; weight: number }> = {},
    history: WorkoutSession[] = [],
) => UserDataSchema.parse({ profile: { height }, nutrition, history }) as unknown as UserData;
const workout = (id: string, date: string): WorkoutSession => ({ id, date, routineName: id, exercises: [] });

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    localStorage.setItem(key + ':health-consent-generation', '1');
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// Positive snapshots cross the real cloud codec before the local boundary.
// Empty monthly shells retain their writer, as required after terminal GC.
function serverSnapshot(input: UserData, clocks: Record<string, VectorClock> = {}, emptyPaths: string[] = []) {
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
            writer: { slot: writerDot[0], replicaId: 'hydration-server', generation: 1,
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

async function snapshot(): Promise<LocalEnvelope> {
    const envelope = await readLocal(owner);
    if (!envelope) throw new Error('Missing diagnostic local envelope');
    return envelope;
}

async function registerAndEdit(): Promise<LocalEnvelope> {
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
    await commitLocal(owner, edited, current.data);
    const pending = await snapshot();
    expect(pending.pending.length).toBeGreaterThan(0);
    return pending;
}

function expectFencedArchive(after: LocalEnvelope, before: LocalEnvelope) {
    if (!before.replica) throw new Error('Missing diagnostic registered replica');
    expect(after).toEqual({
        ...before, cloudIntegrityFence: expect.any(String), revision: before.revision + 1,
        replica: { ...before.replica, checkpointAtMs: 1, leaseUntilMs: 1 },
    });
}

describe('diagnostic cloud hydration through the encrypted local archive', () => {
    it('creates the first envelope with current versions, consent and the joined server frontier', async () => {
        const remote = serverSnapshot(state('170',
            { '2026-09-01': { date: '2026-09-01', weight: 80 } },
            [workout('january', '2026-01-01')]), {
            '': { s01: 7 },
            'history_months/2026-01': { s01: 3, s02: 4 },
            'nutrition_months/2026-09': { s01: 5 },
        });
        const inputImage = structuredClone(remote);

        const result = await hydrateLocal(owner, remote.data, ['2026-01', '2026-09'], remote.documents, 'all');
        expect(result).toMatchObject({
            version: CURRENT_LOCAL_ENVELOPE, dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL, owner, actorSeq: 0, consentRevision: 1,
            clock: { s01: 7, s02: 4 }, replica: null, revision: 0, pending: [],
            completeMonths: ['2026-01', '2026-09'],
        });
        expect(result.actorId).toEqual(expect.any(String));
        expect(result.actorId.length).toBeGreaterThan(0);
        expect(result.data).toEqual(remote.data);
        expect(result.baseline).toEqual(remote.data);
        expect(result.syncMetaByDocument).toEqual(remote.metadata);
        expect(await snapshot()).toEqual(result);
        expect(await get(key)).toMatch(/^tlb-sealed:v1:/);
        expect(remote).toEqual(inputImage);
    });

    it('keeps exact ciphertext and revision when the confirmed snapshot is unchanged', async () => {
        const remote = serverSnapshot(state('170'));
        await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        const before = await snapshot();
        const ciphertext = await get(key);

        const returned = await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        expect(returned).toEqual(before);
        expect(await snapshot()).toEqual(before);
        expect(await get(key)).toBe(ciphertext);
    });

    it('uses default window coverage for both monthly collections and retains older confirmed metadata', async () => {
        const old = state('170', {
            '2026-01-01': { date: '2026-01-01', weight: 70 },
            '2026-09-01': { date: '2026-09-01', weight: 80 },
        }, [workout('old-january', '2026-01-01'), workout('removed-september', '2026-09-01')]);
        const initial = serverSnapshot(old, { '': { s01: 7 } });
        await hydrateLocal(owner, initial.data, ['2026-01', '2026-09'], initial.documents, 'all');
        const before = await snapshot();
        const remote = serverSnapshot(state('175'), {
            '': { s01: 9 }, 'history_months/2026-09': { s01: 4 },
            'nutrition_months/2026-09': { s01: 4 },
        }, ['history_months/2026-09', 'nutrition_months/2026-09']);

        const result = await hydrateLocal(owner, remote.data, ['2026-11', '2026-10', '2026-09'], remote.documents);
        expect(result.data.history?.map(item => item.id)).toEqual(['old-january']);
        expect(result.baseline.history?.map(item => item.id)).toEqual(['old-january']);
        expect(result.data.nutrition?.['2026-01-01']?.weight).toBe(70);
        expect(result.data.nutrition?.['2026-09-01']).toBeUndefined();
        expect(result.baseline.nutrition?.['2026-09-01']).toBeUndefined();
        expect(result.data.profile?.height).toBe('175');
        expect(result.clock).toEqual({ s01: 9 });
        expect(result.completeMonths).toEqual(['2026-01', '2026-09', '2026-11', '2026-10']);
        expect(result.syncMetaByDocument['history_months/2026-01'])
            .toEqual(before.syncMetaByDocument['history_months/2026-01']);
        expect(result.syncMetaByDocument['nutrition_months/2026-01'])
            .toEqual(before.syncMetaByDocument['nutrition_months/2026-01']);
        expect(await snapshot()).toEqual(result);
    });

    it('replaces full history coverage, installs a new month and keeps the fresh root', async () => {
        const initial = serverSnapshot(state('170',
            { '2026-01-01': { date: '2026-01-01', weight: 70 } },
            [workout('removed-january', '2026-01-01')]));
        await hydrateLocal(owner, initial.data, ['2026-01'], initial.documents, 'all');
        const window = serverSnapshot(state('170'));
        await hydrateLocal(owner, window.data, ['2026-11', '2026-10', '2026-09'], window.documents, 'window');
        const remote = serverSnapshot(state('175', {}, [workout('new-october', '2026-10-01')]), {
            '': { s01: 3 }, 'history_months/2026-01': { s01: 2 },
            'nutrition_months/2026-01': { s01: 2 }, 'history_months/2026-10': { s01: 4 },
        }, ['history_months/2026-01', 'nutrition_months/2026-01']);

        const result = await hydrateLocal(owner, remote.data, ['2026-01', '2026-10'], remote.documents, 'all');
        expect(result.data.history?.map(item => item.id)).toEqual(['new-october']);
        expect(result.baseline.history?.map(item => item.id)).toEqual(['new-october']);
        expect(result.data.nutrition).toEqual({});
        expect(result.baseline.nutrition).toEqual({});
        expect(result.data.profile?.height).toBe('175');
        expect(result.baseline.profile?.height).toBe('175');
        expect(result.completeMonths).toEqual(['2026-01', '2026-10']);
        expect(result.syncMetaByDocument).toEqual(remote.metadata);
        expect(await snapshot()).toEqual(result);
    });

    it('replays pending intent without promoting its causal dot to confirmed cloud metadata', async () => {
        const initial = serverSnapshot(state('170'));
        await hydrateLocal(owner, initial.data, [], initial.documents, 'all');
        const before = await registerAndEdit();
        const remote = serverSnapshot(state('170',
            { '2026-09-01': { date: '2026-09-01', weight: 80 } }), {
            '': { s01: 1 }, 'nutrition_months/2026-09': { s02: 4 },
        });

        const result = await hydrateLocal(owner, remote.data, ['2026-11', '2026-10', '2026-09'], remote.documents, 'window');
        expect(result.pending).toEqual(before.pending);
        expect(result.data.pendingConflicts).toEqual(before.data.pendingConflicts);
        expect(result.data.pendingConflicts?.nutritionPlanning?.weight).toBe(78);
        expect(result.actorId).toBe(before.actorId);
        expect(result.actorSeq).toBe(before.actorSeq);
        expect(result.clock).toEqual({ s01: 1, s00: 1, s02: 4 });
        expect(result.data.profile?.height).toBe('181');
        expect(result.baseline.profile?.height).toBe('170');
        expect(result.data.nutrition?.['2026-09-01']?.weight).toBe(80);
        expect(result.syncMetaByDocument).toEqual(remote.metadata);
        expect(result.syncMetaByDocument[''].clock).not.toHaveProperty('s00');
        expect(result.revision).toBe(before.revision + 1);
        expect(await snapshot()).toEqual(result);
    });

    it.each(['history_months/2026-09', 'nutrition_months/2026-09'])(
        'fences a missing covered %s while retaining the entire pending archive', async path => {
            const business = path.startsWith('history_months/')
                ? state('170', {}, [workout('covered', '2026-09-01')])
                : state('170', { '2026-09-01': { date: '2026-09-01', weight: 80 } });
            const initial = serverSnapshot(business);
            await hydrateLocal(owner, initial.data, ['2026-09'], initial.documents, 'all');
            const before = await registerAndEdit();
            const remote = serverSnapshot(state('170'));
            const pending = hydrateLocal(owner, remote.data, ['2026-11', '2026-10', '2026-09'], remote.documents, 'window');

            await expect(pending).rejects.toBeInstanceOf(IncompleteCloudSnapshotError);
            await expect(pending).rejects.toMatchObject({
                causeKind: 'missing-document', documentPaths: [path],
                message: expect.stringContaining('Snapshot cloud incompleto'),
            });
            expectFencedArchive(await snapshot(), before);
        },
    );

    it.each(['history_months/2026-09', 'nutrition_months/2026-09'])(
        'rejects delayed causal evidence for %s before certifying a checkpoint', async path => {
            const business = path.startsWith('history_months/')
                ? state('170', {}, [workout('covered', '2026-09-01')])
                : state('170', { '2026-09-01': { date: '2026-09-01', weight: 80 } });
            const initial = serverSnapshot(business, { '': { s01: 7 }, [path]: { s01: 14 } });
            await hydrateLocal(owner, initial.data, ['2026-09'], initial.documents, 'all');
            const before = await registerAndEdit();
            const delayed = serverSnapshot(business, { '': { s01: 7 }, [path]: { s01: 13 } });
            const pending = hydrateLocal(owner, delayed.data, ['2026-09'], delayed.documents, 'all');

            await expect(pending).rejects.toBeInstanceOf(IncompleteCloudSnapshotError);
            await expect(pending).rejects.toMatchObject({
                causeKind: 'stale-document', documentPaths: [path],
                message: expect.stringContaining('Snapshot cloud non aggiornato'),
            });
            expectFencedArchive(await snapshot(), before);
        },
    );

    it.each([{ existing: false, path: '' }, { existing: true, path: 'nutrition_months/2026-09' }])(
        'preserves the local error contract for invalid metadata (existing=$existing, path=$path)', async scenario => {
            const remote = serverSnapshot(state('170'));
            if (scenario.existing) {
                await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
                await registerAndEdit();
            }
            const before = await readLocal(owner);
            const ciphertext = await get(key);
            // Deliberately malformed metadata tests this defensive boundary.
            // The ordinary cloud reader rejects such documents before hydration.
            const invalid = new Map(remote.documents);
            invalid.set(scenario.path, {
                _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL + 1, clock: {}, fields: {} },
            });
            const pending = hydrateLocal(owner, remote.data, ['2026-09'], invalid, 'all');
            await expect(pending).rejects.toMatchObject({
                code: 'invalid-cloud-sync-metadata', name: 'InvalidCloudSyncMetadataError',
                documentPath: scenario.path, originalError: expect.any(Error),
                message: expect.stringContaining(scenario.path || 'root'),
            });
            expect(await get(key)).toBe(ciphertext);
            expect(await readLocal(owner)).toEqual(before);
        },
    );

    it.each([false, true])('checks the guard after the catalog wait even for creation or a no-op (existing=%s)', async existing => {
        const remote = serverSnapshot(state('170'));
        if (existing) await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        const before = await readLocal(owner);
        const ciphertext = await get(key);
        let finishCatalog!: (value: CachedGlobalCatalog) => void;
        const catalogWait = new Promise<CachedGlobalCatalog>(resolve => { finishCatalog = resolve; });
        catalogSource.read.mockReturnValueOnce(catalogWait);
        let current = true;
        const pending = hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => current);
        current = false;
        finishCatalog(catalog);

        await expect(pending).rejects.toThrow('Hydration locale invalidata dal cambio sessione');
        expect(await get(key)).toBe(ciphertext);
        expect(await readLocal(owner)).toEqual(before);
    });

    it('preserves ciphertext when the integrity fence cannot commit, then fences the retained journal on retry', async () => {
        const initial = serverSnapshot(state('170', {}, [workout('covered', '2026-09-01')]));
        await hydrateLocal(owner, initial.data, ['2026-09'], initial.documents, 'all');
        const before = await registerAndEdit();
        const ciphertext = await get(key);
        const incomplete = serverSnapshot(state('170'));
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });

        await expect(hydrateLocal(owner, incomplete.data, ['2026-09'], incomplete.documents, 'window'))
            .rejects.toThrow('Quota exceeded');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
        put.mockRestore();

        await expect(hydrateLocal(owner, incomplete.data, ['2026-09'], incomplete.documents, 'window'))
            .rejects.toMatchObject({ causeKind: 'missing-document', documentPaths: ['history_months/2026-09'] });
        expectFencedArchive(await snapshot(), before);
    });
});
