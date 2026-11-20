import { describe, expect, it } from 'vitest';
import type { WorkoutSession } from '../../src/types';
import { applyDomainOperations } from '../../src/lib/sync/domainOperations';
import { base, compile } from './m8DomainFixture';

describe('M8 Domain Operations V4 — mutations, reordering and patch semantics', () => {
    it('compiles a profile patch only inside the profile root scope', () => {
        const before = base({ profile: { height: '170', gender: 'M' }, activePains: ['shoulder'] });
        const { after, operations, replay } = compile(before, { type: 'profile.patch', patch: { height: '171' } });

        expect(after.profile?.height).toBe('171');
        expect(operations.length).toBeGreaterThan(0);
        expect(operations.every(op => op.docPath === '' && op.path[0] === 'profile')).toBe(true);
        expect(replay.get('')).toBeDefined();
        expect((replay.get('')!.profile as any).height).toBe('171');
        expect(replay.get('')?.activePains).toEqual(['shoulder']);
    });

    it('adds a meal to one monthly shard and recomputes derived totals', () => {
        const before = base({ nutrition: {} });
        const meal = {
            id: 'meal-1', name: 'Riso', meal: 'pranzo', quantity: 100,
            kcal: 350, carbs: 75, pro: 7, fat: 1,
        };
        const { after, operations, replay } = compile(before, { type: 'nutrition-meal.upsert', date: '2026-09-15', meal });

        expect(after.nutrition?.['2026-09-15']?.meals).toEqual([meal]);
        expect(after.nutrition?.['2026-09-15']?.kcal).toBe(350);
        expect(operations.every(op => op.docPath === 'nutrition_months/2026-09')).toBe(true);
        expect(operations.some(op => op.path.join('/') === '2026-09-15/meals/meal-1')).toBe(true);
        expect(replay.get('nutrition_months/2026-09')).toBeDefined();
        expect((replay.get('nutrition_months/2026-09')!['2026-09-15'] as any).kcal).toBe(350);
    });

    it('moves a workout across months with an old-month tombstone and new-month upsert', () => {
        const oldWorkout: WorkoutSession = { id: 'w-1', date: '2026-08-31', exercises: [] };
        const movedWorkout: WorkoutSession = { ...oldWorkout, date: '2026-09-01', moodRating: 4 };
        const before = base({ history: [oldWorkout] });
        const { operations, replay } = compile(before, { type: 'history.upsert', workout: movedWorkout });

        expect(operations.some(op => op.docPath === 'history_months/2026-08' && op.path[0] === 'w-1' && op.isDelete)).toBe(true);
        expect(operations.some(op => op.docPath === 'history_months/2026-09' && op.path[0] === 'w-1' && !op.isDelete)).toBe(true);
        expect(replay.get('history_months/2026-08')?.['w-1']).toBeUndefined();
        expect(replay.get('history_months/2026-09')).toBeDefined();
        expect((replay.get('history_months/2026-09')!['w-1'] as any).date).toBe('2026-09-01');
    });

    it('completes a workout as one domain batch spanning history and root state', () => {
        const active: WorkoutSession = { id: 'w-2', date: '2026-09-15', globalStartTime: 100, exercises: [] };
        const finished: WorkoutSession = { ...active, globalEndTime: 200, globalDurationStr: '00:01:40' };
        const before = base({ activeWorkout: active, activePains: ['old'], history: [] });
        const { after, operations, replay } = compile(before, { type: 'workout.complete', workout: finished, expectedActiveWorkoutId: String(finished.id), activePains: ['new'] });

        expect(after.activeWorkout).toBeNull();
        expect(after.history?.[0]?.id).toBe('w-2');
        expect(after.activePains).toEqual(['new']);
        expect(new Set(operations.map(op => op.docPath))).toEqual(new Set(['', 'history_months/2026-09']));
        expect(replay.get('')?.activeWorkout).toBeNull();
        expect(replay.get('')?.activePains).toEqual(['new']);
        expect(replay.get('history_months/2026-09')).toBeDefined();
        expect((replay.get('history_months/2026-09')!['w-2'] as any).globalEndTime).toBe(200);
    });

    it('persists and semantically syncs structured training-cycle strategy', () => {
        const before = base({ trainingCycles: [] });
        const cycle = {
            id: 'cycle-strategy',
            name: 'Volume quadricipiti',
            durationWeeks: 6,
            strategy: {
                intent: 'development' as const,
                progressionFocus: 'volume' as const,
                primaryMuscles: ['quads'],
                secondaryMuscles: ['triceps'],
            },
            routines: [],
        };

        const { after, operations, replay } = compile(before, { type: 'training-cycle.upsert', cycle });

        expect(after.trainingCycles?.[0]?.strategy).toEqual(cycle.strategy);
        expect(operations.length).toBeGreaterThan(0);
        expect(operations.every(operation => operation.docPath === '')).toBe(true);
        const replayCycles = replay.get('')?.trainingCycles as Array<typeof cycle> | undefined;
        expect(replayCycles?.find(item => item.id === cycle.id)?.strategy).toEqual(cycle.strategy);
    });

    it('persists muscle priorities when the cycle objective is unspecified', () => {
        const before = base({ trainingCycles: [] });
        const cycle = {
            id: 'cycle-priorities',
            name: 'Priorità muscolari',
            durationWeeks: 6,
            strategy: {
                primaryMuscles: ['biceps_right'],
                secondaryMuscles: ['delts_rear_left'],
            },
            routines: [],
        };

        const { after, operations, replay } = compile(before, { type: 'training-cycle.upsert', cycle });

        expect(after.trainingCycles?.[0]?.strategy).toEqual(cycle.strategy);
        expect(operations.length).toBeGreaterThan(0);
        const replayCycles = replay.get('')?.trainingCycles as Array<typeof cycle> | undefined;
        expect(replayCycles?.find(item => item.id === cycle.id)?.strategy).toEqual(cycle.strategy);
    });

    it('emits ordered-keyed order intent for routine reorder', () => {
        const before = base({ routines: [
            { id: 'r1', name: 'A', exercises: [] },
            { id: 'r2', name: 'B', exercises: [] },
        ] });
        const { after, operations } = compile(before, { type: 'routine.reorder', ids: ['r2', 'r1'] });
        expect(after.routines?.map(item => item.id)).toEqual(['r2', 'r1']);
        expect(operations).toContainEqual(expect.objectContaining({ path: ['routines', '$order'], value: ['r2', 'r1'], isDelete: false }));
    });

    it('fails fast instead of degrading duplicate routine identities to an atomic array write', () => {
        const before = base({ routines: [] });
        expect(() => applyDomainOperations(before, {
            type: 'routine.upsert',
            routine: {
                id: 'r1',
                name: 'Duplicata',
                exercises: [
                    { exId: 'e1', setsCount: 3 },
                    { exId: 'e1', setsCount: 4 },
                ],
            },
        })).toThrow(/duplicato/i);
    });

    it('rejects cycle writes whose routine identities would be discarded by the tolerant read schema', () => {
        const before = base({ trainingCycles: [] });
        const original = structuredClone(before);
        const cycle = {
            id: 'cycle-routines',
            name: 'Ciclo con due routine',
            durationWeeks: 6,
            routines: [
                { routineId: 'r-1', frequencyPerWeek: 1 },
                { routineId: 'r-2', frequencyPerWeek: 2 },
            ],
        };

        const invalid = [
            { ...cycle, routines: [
                { routineId: 'r-1', frequencyPerWeek: 1 },
                { routineId: ' r-1 ', frequencyPerWeek: 2 },
            ] },
            { ...cycle, routines: [{ routineId: 'invalid/id', frequencyPerWeek: 1 }] },
            { ...cycle, routines: [null] },
            { ...cycle, routines: { routineId: 'r-1' } },
        ];
        for (const malformed of invalid) {
            expect(() => applyDomainOperations(before, {
                type: 'training-cycle.upsert',
                cycle: malformed as unknown as typeof cycle,
            })).toThrow();
            expect(before).toEqual(original);
        }

        const { after, operations, replay } = compile(before, { type: 'training-cycle.upsert', cycle });
        expect(after.trainingCycles?.[0]?.routines).toEqual(cycle.routines);
        expect(operations.some(operation => operation.path[0] === 'trainingCycles')).toBe(true);
        const persisted = replay.get('')?.trainingCycles as Array<{ routines: typeof cycle.routines }>;
        expect(persisted?.[0]?.routines).toEqual(cycle.routines);
    });

    it('rejects an incomplete reorder instead of silently dropping an entity', () => {
        const before = base({ supplements: [
            { id: 's1', name: 'A', unit: 'g' },
            { id: 's2', name: 'B', unit: 'g' },
        ] });
        expect(() => applyDomainOperations(before, { type: 'supplement.reorder', ids: ['s1'] })).toThrow(/esattamente/i);
    });

    it('treats undefined in a patch as property deletion and emits a semantic tombstone', () => {
        const before = base({ profile: { height: '170', waist: '80' } });
        const { after, operations, replay } = compile(before, { type: 'profile.patch', patch: { waist: undefined } });

        expect(Object.hasOwn(after.profile ?? {}, 'waist')).toBe(false);
        expect(operations).toContainEqual(expect.objectContaining({ path: ['profile', 'waist'], isDelete: true }));
        expect(Object.hasOwn((replay.get('')?.profile as Record<string, unknown>) ?? {}, 'waist')).toBe(false);
    });
});
