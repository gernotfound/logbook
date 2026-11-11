import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: vi.fn() }));

import { getCachedCatalog } from '../../../src/lib/catalog/catalogService';
import { UserDataSchema } from '../../../src/lib/schema';
import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../../../src/types';
import type { DocumentData } from '../../../src/lib/sync/documentProjection';
import type { SemanticOperation, VectorClock } from '../../../src/lib/sync/semanticProjection';
import { projectDocuments, applyRemoteDocuments } from '../../../src/lib/sync/documentProjection';
import { applySemanticOperations, diffDocuments, parseSemanticOperation } from '../../../src/lib/sync/semanticProjection';
import { checkpointFromCloudDocuments } from '../../../src/lib/sync/replicaProtocol';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'monthly-tombstone-fixture', schemaVersion: 1, updatedAt: '2026-11-07T00:00:00.000Z',
        docRefs: { exercises: 'exercises_fixture', foods: 'foods_fixture' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: Date.UTC(2026, 10, 7),
};
const parseData = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;
const session = (id: string, date: string): WorkoutSession => ({
    id, date,
    exercises: [{
        id: 'exercise-row', exId: 'bench', sessionNote: '',
        sets: [{ id: 'first-set', kg: '40', reps: '8' }],
    }],
});

async function seedReplica(data: UserData) {
    await initializeLocal('a', data, ['2026-10', '2026-11']);
    const documents = projectDocuments(data, catalog);
    const baselineClock: VectorClock = { s00: 7, s01: 5 };
    const empty = new Map<string, DocumentData>();
    const replay = applySemanticOperations(empty, diffDocuments(empty, documents, 's00', 7, baselineClock));
    const cloud = new Map<string, DocumentData>();
    // Real replay metadata keeps the adopted replica's baseline causally coherent.
    for (const [path, business] of documents) {
        cloud.set(path, {
            ...business,
            _sync: { ...replay.syncMetas[path], writer: {
                slot: 's00', replicaId: 'monthly-tombstone-test', generation: 1, seq: 7,
            } },
        });
    }
    const now = Date.now();
    return adoptReplicaCheckpoint('a', { identity: {
        slot: 's00', replicaId: 'monthly-tombstone-test', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 86_400_000,
    }, baseSeq: 7 }, checkpointFromCloudDocuments(cloud));
}

describe('monthly tombstones through the encrypted local journal and causal replay', () => {
    beforeEach(async () => {
        vi.mocked(getCachedCatalog).mockReset().mockResolvedValue(structuredClone(catalog));
        lockAllVaults();
        localStorage.clear();
        await clear();
        vi.stubGlobal('navigator', { locks: {
            request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
        } });
        await createAndMigrateVault('user:a');
    });

    afterEach(() => {
        lockAllVaults();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(['history', 'nutrition'] as const)(
        'persists a parent delete for %s and blocks old or concurrent child resurrection', async kind => {
            const day = '2026-11-07';
            const entity = kind === 'history' ? 'deleted-workout' : day;
            const path = kind === 'history' ? 'history_months/2026-11' : 'nutrition_months/2026-11';
            const data = parseData(kind === 'history'
                ? { history: [session(entity, day)] }
                : { nutrition: { [day]: { date: day, weight: 80 } } });
            const before = await seedReplica(data);
            const desired = structuredClone(before.data);
            if (kind === 'history') desired.history = [];
            else desired.nutrition = {};
            const expectedClock = { s00: 8, s01: 5 };

            const operations = await commitLocal('a', desired, before.data, () => true);
            const stored = (await readLocal('a'))!;
            expect(stored.pending).toEqual(operations);
            expect(stored.actorSeq).toBe(8);
            expect(stored.data.history).toEqual(desired.history);
            expect(stored.data.nutrition).toEqual(desired.nutrition);
            expect(stored.syncMetaByDocument).toEqual(before.syncMetaByDocument);
            expect(operations.filter(op => op.docPath === path)).toEqual([{
                docPath: path, path: [entity], isDelete: true,
                actorId: 's00', seq: 8, clock: expectedClock,
            }]);
            for (const operation of operations) expect(parseSemanticOperation(operation)).toEqual(operation);

            const baseDocs = projectDocuments(before.data, catalog);
            const deleted = applySemanticOperations(baseDocs, operations, before.syncMetaByDocument);
            const oldEvents: Array<{ seq: number; clock: VectorClock }> = [
                { seq: 5, clock: { s01: 5 } },
                { seq: 100, clock: { s00: 7, s01: 100 } },
            ];
            for (const event of oldEvents) {
                const stale: SemanticOperation = {
                    docPath: path, path: [entity, kind === 'history' ? 'date' : 'weight'],
                    value: kind === 'history' ? '2026-11-06' : 79,
                    actorId: 's01', seq: event.seq, clock: event.clock, isDelete: false,
                };
                const first = applySemanticOperations(structuredClone(baseDocs), [stale], structuredClone(before.syncMetaByDocument));
                const orders = [
                    applySemanticOperations(structuredClone(deleted.documents), [stale], structuredClone(deleted.syncMetas)),
                    applySemanticOperations(first.documents, operations, first.syncMetas),
                ];
                for (const result of orders) {
                    expect(result.documents.has(path)).toBe(true);
                    expect(Object.hasOwn(result.documents.get(path)!, entity)).toBe(false);
                    expect(result.syncMetas[path].fields[entity]).toMatchObject({
                        deleted: true, actorId: 's00', seq: 8, clock: expectedClock,
                    });
                }
                const expectedEntity = structuredClone(baseDocs.get(path)![entity]);
                const recreated = applySemanticOperations(orders[0].documents, [{
                    docPath: path, path: [entity], value: structuredClone(expectedEntity),
                    actorId: 's01', seq: 101, clock: { s00: 8, s01: 101 }, isDelete: false,
                }], orders[0].syncMetas);
                expect(recreated.documents.get(path)![entity]).toEqual(expectedEntity);
                expect(recreated.syncMetas[path].fields[entity].deleteClock?.s00).toBeGreaterThanOrEqual(8);
            }
        },
    );

    it('moves a workout to another month without deleting its new occurrence', async () => {
        const before = await seedReplica(parseData({ history: [session('moved-workout', '2026-10-31')] }));
        const desired = structuredClone(before.data);
        desired.history![0].date = '2026-11-01';

        const operations = await commitLocal('a', desired, before.data, () => true);
        const stored = (await readLocal('a'))!;
        expect(stored.pending).toEqual(operations);
        expect(operations.filter(op => op.docPath === 'history_months/2026-10')).toEqual([{
            docPath: 'history_months/2026-10', path: ['moved-workout'], isDelete: true,
            actorId: 's00', seq: 8, clock: { s00: 8, s01: 5 },
        }]);
        expect(operations.some(op => op.docPath === 'history_months/2026-11' && !op.isDelete)).toBe(true);
        const replay = applySemanticOperations(projectDocuments(before.data, catalog), operations, before.syncMetaByDocument);
        expect(Object.hasOwn(replay.documents.get('history_months/2026-10')!, 'moved-workout')).toBe(false);
        expect(replay.documents.get('history_months/2026-11')!['moved-workout']).toEqual(
            projectDocuments(desired, catalog).get('history_months/2026-11')!['moved-workout'],
        );
        const reconciled = applyRemoteDocuments(before.data, replay.documents, catalog);
        expect(reconciled.history!.map(workout => [workout.id, workout.date]))
            .toEqual([['moved-workout', '2026-11-01']]);
        expect(stored.data.history).toEqual(reconciled.history);
    });

    it('keeps a nutrition edit when a removed workout uses the same entity key', async () => {
        const day = '2026-11-07';
        const before = await seedReplica(parseData({
            history: [session(day, day)], nutrition: { [day]: { date: day, weight: 80 } },
        }));
        const desired = structuredClone(before.data);
        desired.history = [];
        desired.nutrition![day].weight = '82';

        const operations = await commitLocal('a', desired, before.data, () => true);
        expect(operations.some(op => op.docPath === 'nutrition_months/2026-11'
            && op.path[0] === day && op.path[1] === 'weight' && op.value === 82 && !op.isDelete)).toBe(true);
        const replay = applySemanticOperations(projectDocuments(before.data, catalog), operations, before.syncMetaByDocument);
        expect(Object.hasOwn(replay.documents.get('history_months/2026-11')!, day)).toBe(false);
        const restored = applyRemoteDocuments(before.data, replay.documents, catalog);
        expect(restored.history).toEqual([]);
        expect(restored.nutrition![day].weight).toBe(82);
        expect((await readLocal('a'))!.data.nutrition![day].weight).toBe(82);
    });

    it('preserves the encrypted envelope when the monthly projection is unchanged', async () => {
        const before = await seedReplica(parseData({
            history: [session('unchanged-workout', '2026-11-07')],
            nutrition: { '2026-11-07': { date: '2026-11-07', weight: 80 } },
        }));
        const ciphertext = await get('logbook:v2:user:a');
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);

        expect(await commitLocal('a', before.data, before.data, () => true)).toEqual([]);
        expect(await get('logbook:v2:user:a')).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });
});
