import { describe, it, expect } from 'vitest';
import { applySemanticOperations, diffDocuments, type SemanticOperation } from '../src/lib/sync/semanticProjection';

describe('activeWorkout lifecycle guard', () => {
    it('generates a session guard for child operations', () => {
        const base = new Map();
        base.set('', {
            activeWorkout: { id: 'w-1', date: '2026-09-01', exercises: [] }
        });

        const desired = new Map();
        desired.set('', {
            activeWorkout: { id: 'w-1', date: '2026-09-01', exercises: [{ id: 'ex-1', name: 'Bench' }] }
        });

        const ops = diffDocuments(base, desired, 'actor1', 1, { actor1: 1 });
        const op = ops.find(o => o.path.includes('exercises'));

        expect(op).toBeDefined();
        expect(op?.guard).toEqual({
            path: ['activeWorkout', 'id'],
            equals: 'w-1'
        });
    });

    it('falls back to an atomic activeWorkout operation when no stable session id exists', () => {
        const base = new Map();
        base.set('', {
            activeWorkout: { date: '2026-09-01', exercises: [] }
        });

        const desiredWorkout = { date: '2026-09-01', exercises: [{ id: 'ex-1', name: 'Bench' }] };
        const desired = new Map();
        desired.set('', { activeWorkout: desiredWorkout });

        const ops = diffDocuments(base, desired, 'actor1', 1, { actor1: 1 });

        expect(ops).toEqual([expect.objectContaining({
            path: ['activeWorkout'],
            value: desiredWorkout,
            isDelete: false
        })]);
        expect(ops[0].guard).toBeUndefined();
    });

    it('does not let a stale child from session A mutate replacement session B', () => {
        const base = new Map();
        base.set('', {
            activeWorkout: { id: 'w-1', date: '2026-09-01', exercises: [] }
        });

        const replacement: SemanticOperation = {
            docPath: '',
            path: ['activeWorkout'],
            value: { id: 'w-2', date: '2026-09-02', exercises: [] },
            isDelete: false,
            actorId: 'B',
            seq: 1,
            clock: { B: 1 }
        };
        const replaced = applySemanticOperations(base, [replacement]);

        // Actor Z would win the deterministic concurrent tie-break against actor B.
        // The lifecycle guard must still reject it because it belongs to w-1.
        const staleChild: SemanticOperation = {
            docPath: '',
            path: ['activeWorkout', 'exercises', 'ex-1', 'name'],
            value: 'Stale bench',
            isDelete: false,
            actorId: 'Z',
            seq: 1,
            clock: { Z: 1 },
            guard: { path: ['activeWorkout', 'id'], equals: 'w-1' }
        };

        const afterStale = applySemanticOperations(replaced.documents, [staleChild], replaced.syncMetas);
        expect(afterStale.documents.get('')?.activeWorkout).toEqual({
            id: 'w-2',
            date: '2026-09-02',
            exercises: []
        });
        expect(afterStale.syncMetas[''].fields['activeWorkout/exercises/ex-1/name']).toBeUndefined();
        expect(afterStale.syncMetas[''].clock.Z).toBe(1);
    });

    it('accepts a child operation guarded by the current session id', () => {
        const base = new Map();
        base.set('', {
            activeWorkout: { id: 'w-2', date: '2026-09-02', exercises: [] }
        });

        const child: SemanticOperation = {
            docPath: '',
            path: ['activeWorkout', 'exercises', 'ex-1'],
            value: { id: 'ex-1', name: 'Bench' },
            isDelete: false,
            actorId: 'C',
            seq: 1,
            clock: { C: 1 },
            guard: { path: ['activeWorkout', 'id'], equals: 'w-2' }
        };

        const result = applySemanticOperations(base, [child]);
        expect(result.documents.get('')?.activeWorkout.exercises).toEqual([{ id: 'ex-1', name: 'Bench' }]);
    });
});
