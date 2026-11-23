import { describe, expect, it } from 'vitest';
import type { WorkoutSession } from '../../src/types';
import { applyDomainOperations } from '../../src/lib/sync/domainOperations';
import { projectDocuments } from '../../src/lib/sync/documentProjection';
import { base, catalog, compile } from './m8DomainFixture';

describe('M8 Domain Operations V4 — exercise archive and active workout invariants', () => {
    it('keeps the exercise archive deterministically sorted after an upsert', () => {
        const before = base({ library: [
            { id: 'e-z', name: 'Zeta', setsCount: 3, sets: [] },
        ] });
        const { after, operations, replay } = compile(before, {
            type: 'exercise.upsert',
            exercise: { id: 'e-a', name: 'Alfa', setsCount: 3, sets: [] },
        });

        expect(after.library?.map(item => item.id)).toEqual(['e-a', 'e-z']);
        expect(operations.some(operation => operation.docPath === '' && operation.path[0] === 'library')).toBe(true);
        // The library is causally keyed, not ordered-keyed: the reducer sorts for
        // local presentation, while replay guarantees entity identity, not array order.
        const replayIds = (replay.get('')?.library as Array<{ id: string }> | undefined)?.map(item => item.id);
        expect(replayIds?.slice().sort()).toEqual(['e-a', 'e-z']);
    });

    it('cascades explicit exercise deletion through every routine while preserving workout history', () => {
        const deletedExercise = { id: 'e-delete', name: 'Da eliminare', setsCount: 3, sets: [] };
        const keptExercise = { id: 'e-keep', name: 'Da mantenere', setsCount: 3, sets: [] };
        const historical: WorkoutSession = {
            id: 'w-delete-regression',
            date: '2026-09-20',
            exercises: [{ id: 'se-delete-history', exId: 'e-delete', sessionNote: '', sets: [] }],
        };
        const before = base({
            library: [deletedExercise, keptExercise],
            routines: [
                {
                    id: 'r1',
                    name: 'Upper',
                    exercises: [
                        { exId: 'e-delete', setsCount: 3 },
                        { exId: 'e-keep', setsCount: 4 },
                    ],
                },
                {
                    id: 'r2',
                    name: 'Full body',
                    exercises: [{ exId: 'e-delete', setsCount: 2 }],
                },
            ],
            history: [historical],
        });

        const { after, operations, replay } = compile(before, { type: 'exercise.delete', id: 'e-delete' });

        expect(after.library?.map(item => item.id)).toEqual(['e-keep']);
        expect(after.routines?.map(routine => routine.exercises.map(exercise => exercise.exId))).toEqual([['e-keep'], []]);
        // Removing an exercise from the catalog must not edit historical
        // workouts, including fields beyond the exercise reference itself.
        expect(after.history).toEqual(before.history);
        expect(operations.some(operation => operation.docPath === '' && operation.path[0] === 'library')).toBe(true);
        expect(operations.some(operation => operation.docPath === '' && operation.path[0] === 'routines')).toBe(true);
        expect(operations.every(operation => operation.docPath === '')).toBe(true);

        const replayRoot = replay.get('');
        expect((replayRoot?.library as Array<{ id: string }> | undefined)?.map(item => item.id)).toEqual(['e-keep']);
        expect(
            (replayRoot?.routines as Array<{ exercises: Array<{ exId: string }> }> | undefined)
                ?.map(routine => routine.exercises.map(exercise => exercise.exId)),
        ).toEqual([['e-keep'], []]);
        expect(projectDocuments(after, catalog).get('history_months/2026-09'))
            .toEqual(projectDocuments(before, catalog).get('history_months/2026-09'));
        expect((projectDocuments(after, catalog).get('history_months/2026-09')!['w-delete-regression'] as WorkoutSession).exercises[0].exId)
            .toBe('e-delete');
    });

    it('keeps an unreferenced exercise deletion scoped to the archive', () => {
        const before = base({
            library: [
                { id: 'e-delete', name: 'Da eliminare', setsCount: 3, sets: [] },
                { id: 'e-keep', name: 'Da mantenere', setsCount: 3, sets: [] },
            ],
            routines: [{ id: 'r1', name: 'Upper', exercises: [{ exId: 'e-keep', setsCount: 4 }] }],
        });

        const { after, operations, replay } = compile(before, { type: 'exercise.delete', id: 'e-delete' });

        expect(after.library?.map(item => item.id)).toEqual(['e-keep']);
        expect(after.routines).toEqual(before.routines);
        expect(operations.some(operation => operation.docPath === '' && operation.path[0] === 'library')).toBe(true);
        expect(operations.some(operation => operation.path[0] === 'routines')).toBe(false);
        expect((replay.get('')?.library as Array<{ id: string }> | undefined)?.map(item => item.id))
            .toEqual(['e-keep']);
        expect((replay.get('')?.routines as Array<{ exercises: Array<{ exId: string }> }> | undefined)
            ?.[0]?.exercises.map(exercise => exercise.exId)).toEqual(['e-keep']);
    });

    it('guards child mutations of the same active workout by session id', () => {
        const active: WorkoutSession = { id: 'live-1', date: '2026-09-15', moodRating: 1, exercises: [] };
        const before = base({ activeWorkout: active });
        const next = { ...active, moodRating: 4 };
        const { operations } = compile(before, { type: 'active-workout.set', workout: next });

        expect(operations).toContainEqual(expect.objectContaining({
            path: ['activeWorkout', 'moodRating'],
            guard: { path: ['activeWorkout', 'id'], equals: 'live-1' },
        }));
        expect(operations.filter(op => op.path[0] === 'activeWorkout' && op.path.length > 1)
            .every(op => op.guard?.equals === 'live-1')).toBe(true);
    });

    it('projects readiness with the active workout and preserves it on completion/history edits', () => {
        const active: WorkoutSession = {
            id: 'live-ready', date: '2026-09-24', globalStartTime: 100,
            exercises: [{ id: 'se-bench', exId: 'bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '8', rir: 0 }] }],
            readiness: { capturedAt: 100, energy: 2, stress: 5 },
        };
        const before = base({ activeWorkout: null });
        const activeResult = compile(before, { type: 'active-workout.set', workout: active });
        expect((activeResult.after.activeWorkout as WorkoutSession).readiness).toEqual(active.readiness);
        expect((activeResult.after.activeWorkout as WorkoutSession).exercises[0].sets[0].rir).toBe(0);
        expect(activeResult.operations).toContainEqual(expect.objectContaining({ path: ['activeWorkout'] }));

        const completed = compile(activeResult.after, { type: 'workout.complete', workout: active, expectedActiveWorkoutId: String(active.id), activePains: [] });
        expect(completed.after.history?.[0].readiness).toEqual(active.readiness);
        expect(completed.after.history?.[0].exercises[0].sets[0].rir).toBe(0);
        expect(completed.replay.get('history_months/2026-09')).toBeDefined();
        expect((completed.replay.get('history_months/2026-09')!['live-ready'] as WorkoutSession).exercises[0].sets[0].rir).toBe(0);
        expect(completed.after.activeWorkout).toBeNull();

        const edited = { ...completed.after.history![0], moodRating: 8 };
        const historyResult = compile(completed.after, { type: 'history.upsert', workout: edited });
        expect(historyResult.after.history?.[0].readiness).toEqual(active.readiness);
    });

    it('rejects a non-null active workout without stable identity', () => {
        const before = base({ activeWorkout: null });
        expect(() => applyDomainOperations(before, {
            type: 'active-workout.set',
            workout: { date: '2026-09-15', exercises: [] },
        })).toThrow(/identificativo non valido/i);
    });
});
