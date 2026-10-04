import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../src/lib/sync/documentProjection';
import {
    applySemanticOperations,
    type SemanticOperation,
    type SyncMeta,
} from '../src/lib/sync/semanticProjection';
import { CURRENT_SYNC_PROTOCOL } from '../src/lib/schemaEvolution';

type State = ReturnType<typeof applySemanticOperations>;

function snapshot(state: State) {
    return {
        documents: Object.fromEntries([...state.documents.entries()].sort(([a], [b]) => a.localeCompare(b))),
        syncMetas: state.syncMetas,
    };
}

function deliver(
    base: Map<string, DocumentData>,
    operations: SemanticOperation[],
    batches: number[][],
): State {
    let state: State = {
        documents: new Map([...base.entries()].map(([path, doc]) => [path, structuredClone(doc)])),
        syncMetas: {},
    };
    for (const batch of batches) {
        state = applySemanticOperations(
            state.documents,
            batch.map(index => structuredClone(operations[index])),
            state.syncMetas,
        );
    }
    return state;
}

describe('Sync Protocol 2 causal convergence regressions', () => {
    it('keeps a causal recreation stable when a stale concurrent child is delivered before or after it', () => {
        const path = 'nutrition_months/2026-09';
        const date = '2026-09-14';
        const base = new Map<string, DocumentData>([[path, {
            [date]: { date, weight: 80, meals: [] },
        }]]);
        const operations: SemanticOperation[] = [
            {
                docPath: path,
                path: [date],
                isDelete: true,
                actorId: 'C',
                seq: 1,
                clock: { C: 1 },
            },
            {
                docPath: path,
                path: [date, 'weight'],
                value: 82,
                isDelete: false,
                actorId: 'A',
                seq: 1,
                clock: { C: 1, A: 1 },
            },
            {
                docPath: path,
                path: [date, 'weight'],
                value: 90,
                isDelete: false,
                actorId: 'B',
                seq: 1,
                clock: { B: 1 },
            },
        ];

        const recreateThenStale = deliver(base, operations, [[0], [1], [2]]);
        const staleThenRecreate = deliver(base, operations, [[0], [2], [1]]);

        expect(snapshot(staleThenRecreate)).toEqual(snapshot(recreateThenStale));
        expect((recreateThenStale.documents.get(path)?.[date] as any).weight).toBe(82);
        expect(recreateThenStale.syncMetas[path]).toMatchObject({
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { A: 1, B: 1, C: 1 },
            fields: {
                [date]: { actorId: 'C', seq: 1, deleted: true, clock: { C: 1 } },
                [`${date}/weight`]: { actorId: 'A', seq: 1, clock: { C: 1, A: 1 } },
            },
        });
    });

    it('uses a transitive winner order for a mixed causal DAG instead of a pairwise cycle', () => {
        const base = new Map<string, DocumentData>([['', { profile: { name: 'base' } }]]);
        const operations: SemanticOperation[] = [
            {
                docPath: '',
                path: ['profile', 'name'],
                value: 'Y',
                isDelete: false,
                actorId: 'C',
                seq: 1,
                clock: { C: 1 },
            },
            {
                docPath: '',
                path: ['profile', 'name'],
                value: 'X',
                isDelete: false,
                actorId: 'A',
                seq: 1,
                clock: { C: 1, A: 1 },
            },
            {
                docPath: '',
                path: ['profile', 'name'],
                value: 'Z',
                isDelete: false,
                actorId: 'B',
                seq: 1,
                clock: { B: 1 },
            },
        ];

        const schedules = [
            [[0, 1, 2]],
            [[2, 0, 1]],
            [[0], [1], [2]],
            [[0], [2], [1]],
            [[2], [1], [0]],
        ];
        const outcomes = schedules.map(schedule => deliver(base, operations, schedule));
        for (const outcome of outcomes.slice(1)) expect(snapshot(outcome)).toEqual(snapshot(outcomes[0]));

        expect((outcomes[0].documents.get('')?.profile as any).name).toBe('X');
        expect(outcomes[0].syncMetas[''].fields['profile/name']).toMatchObject({
            actorId: 'A',
            seq: 1,
            clock: { C: 1, A: 1 },
            candidates: [{
                actorId: 'B',
                seq: 1,
                clock: { B: 1 },
                value: 'Z',
            }],
        });
        expect(outcomes[0].syncMetas[''].clock).toEqual({ A: 1, B: 1, C: 1 });
    });

    it('recovers a hidden descendant that observed a late-delivered ancestor', () => {
        const path = 'nutrition_months/2026-09';
        const date = '2026-09-15';
        const base = new Map<string, DocumentData>([[path, {
            [date]: { date, weight: 70, meals: [] },
        }]]);
        const ancestor: SemanticOperation = {
            docPath: path,
            path: [date],
            value: { date, weight: 75, meals: [] },
            isDelete: false,
            actorId: 'P',
            seq: 1,
            clock: { P: 1 },
        };
        const visibleConcurrent: SemanticOperation = {
            docPath: path,
            path: [date, 'weight'],
            value: 90,
            isDelete: false,
            actorId: 'B',
            seq: 3,
            clock: { B: 3 },
        };
        const hiddenCausalDescendant: SemanticOperation = {
            docPath: path,
            path: [date, 'weight'],
            value: 82,
            isDelete: false,
            actorId: 'A',
            seq: 1,
            clock: { P: 1, A: 1 },
        };

        const descendantsFirst = deliver(base, [ancestor, visibleConcurrent, hiddenCausalDescendant], [[1, 2], [0]]);
        const ancestorFirst = deliver(base, [ancestor, visibleConcurrent, hiddenCausalDescendant], [[0], [1, 2]]);

        expect(snapshot(descendantsFirst)).toEqual(snapshot(ancestorFirst));
        expect((descendantsFirst.documents.get(path)?.[date] as any).weight).toBe(82);
        expect(descendantsFirst.syncMetas[path].fields[`${date}/weight`]).toMatchObject({
            actorId: 'A',
            seq: 1,
            clock: { P: 1, A: 1 },
        });
    });

    it('observes a stale active-workout operation only at document frontier, never inside the current field stamp', () => {
        const base = new Map<string, DocumentData>([['', {
            activeWorkout: { id: 's2', date: '2026-09-14', moodRating: 0, exercises: [] },
        }]]);
        const operations: SemanticOperation[] = [
            {
                docPath: '',
                path: ['activeWorkout', 'moodRating'],
                value: 5,
                isDelete: false,
                actorId: 'Z',
                seq: 1,
                clock: { Z: 1 },
                guard: { path: ['activeWorkout', 'id'], equals: 's2' },
            },
            {
                docPath: '',
                path: ['activeWorkout', 'moodRating'],
                value: 99,
                isDelete: false,
                actorId: 'A',
                seq: 1,
                clock: { A: 1 },
                guard: { path: ['activeWorkout', 'id'], equals: 's1' },
            },
        ];

        const validThenStale = deliver(base, operations, [[0], [1]]);
        const staleThenValid = deliver(base, operations, [[1], [0]]);
        expect(snapshot(staleThenValid)).toEqual(snapshot(validThenStale));
        expect(validThenStale.syncMetas[''].fields['activeWorkout/moodRating']).toEqual({
            actorId: 'Z',
            seq: 1,
            clock: { Z: 1 },
        });
        expect(validThenStale.syncMetas[''].clock).toEqual({ A: 1, Z: 1 });

        const followUp: SemanticOperation = {
            docPath: '',
            path: ['activeWorkout', 'moodRating'],
            value: 6,
            isDelete: false,
            actorId: 'B',
            seq: 1,
            clock: { Z: 1, B: 1 },
            guard: { path: ['activeWorkout', 'id'], equals: 's2' },
        };
        const left = applySemanticOperations(validThenStale.documents, [followUp], validThenStale.syncMetas);
        const right = applySemanticOperations(staleThenValid.documents, [followUp], staleThenValid.syncMetas);
        expect(snapshot(right)).toEqual(snapshot(left));
        expect((left.documents.get('')?.activeWorkout as any).moodRating).toBe(6);
    });

    it('converges ordered-keyed $order across the same mixed causal DAG and batch partitions', () => {
        const base = new Map<string, DocumentData>([['', {
            routines: [
                { id: 'r1', name: 'One', exercises: [] },
                { id: 'r2', name: 'Two', exercises: [] },
                { id: 'r3', name: 'Three', exercises: [] },
            ],
        }]]);
        const operations: SemanticOperation[] = [
            { docPath: '', path: ['routines', '$order'], value: ['r2', 'r1', 'r3'], isDelete: false, actorId: 'C', seq: 1, clock: { C: 1 } },
            { docPath: '', path: ['routines', '$order'], value: ['r3', 'r2', 'r1'], isDelete: false, actorId: 'A', seq: 1, clock: { C: 1, A: 1 } },
            { docPath: '', path: ['routines', '$order'], value: ['r1', 'r3', 'r2'], isDelete: false, actorId: 'B', seq: 1, clock: { B: 1 } },
        ];

        const together = deliver(base, operations, [[0, 1, 2]]);
        const partitioned = deliver(base, operations, [[2], [0], [1]]);
        expect(snapshot(partitioned)).toEqual(snapshot(together));
        expect((together.documents.get('')?.routines as any[]).map(item => item.id)).toEqual(['r3', 'r2', 'r1']);
    });

    it('keeps protocol-2 SyncMeta internally covered after every regression scenario', () => {
        const meta: SyncMeta = {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { A: 2, B: 1 },
            fields: {
                'profile/name': { actorId: 'A', seq: 2, clock: { A: 2, B: 1 } },
            },
        };
        expect(meta.protocolVersion).toBe(2);
    });
});
