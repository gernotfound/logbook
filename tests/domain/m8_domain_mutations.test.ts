import { describe, expect, it } from 'vitest';
import type { WorkoutSession } from '../../src/types';
import { applyDomainOperations } from '../../src/lib/sync/domainOperations';
import { captureMeasurement } from '../../src/lib/nutrition/measurementHistory';
import { base, compile } from './m8DomainFixture';

describe('M8 Domain Operations V4 — mutations, reordering and patch semantics', () => {
    it('edits only authorable fields of an existing personal exercise', () => {
        const before = base({
            library: [
                { id: 'custom', name: 'Rematore', setsCount: 5, sets: [] },
                { id: 'catalog', name: 'Pressa', setsCount: 3, sets: [], isDefault: true },
            ],
        });
        const edit = { type: 'exercise.edit', id: 'custom', fields: { name: 'Rematore con manubri', notes: 'Presa neutra' } } as const;
        const { after, operations } = compile(before, edit);
        expect(after.library?.find(item => item.id === 'custom')).toMatchObject({
            id: 'custom', setsCount: 5, sets: [], name: 'Rematore con manubri', notes: 'Presa neutra',
        });
        expect(operations.length).toBeGreaterThan(0);
        expect(operations.every(item => item.docPath === '' && item.path.includes('custom'))).toBe(true);
        expect(() => applyDomainOperations(before, { ...edit, id: 'missing' })).toThrow('Esercizio personale');
        expect(() => applyDomainOperations(before, { ...edit, id: 'catalog' })).toThrow('Esercizio personale');
    });

    it('rejects a stale delete confirmation and removes only the observed routine references when retried', () => {
        const before = base({
            library: [
                { id: 'custom', name: 'Rematore', setsCount: 3, sets: [] },
                { id: 'another', name: 'Panca', setsCount: 3, sets: [] },
            ],
            routines: [
                { id: 'r1', name: 'Prima', exercises: [{ exId: 'custom', setsCount: 5 }] },
                { id: 'r2', name: 'Seconda', exercises: [{ exId: 'custom', setsCount: 2 }, { exId: 'another', setsCount: 4 }] },
            ],
            history: [{ id: 'sample', date: '2026-10-12', exercises: [] }],
        });
        const remove = { type: 'exercise.delete', id: 'custom', expectedRoutineIds: ['r1'] } as const;
        expect(() => applyDomainOperations(before, remove)).toThrow('schede collegate cambiati');
        expect(before.routines?.map(routine => routine.exercises.length)).toEqual([1, 2]);
        const { after, operations } = compile(before, { ...remove, expectedRoutineIds: ['r2', 'r1'] });
        expect(after.library?.map(item => item.id)).toEqual(['another']);
        expect(after.routines?.map(routine => routine.exercises)).toEqual([[], [{ exId: 'another', setsCount: 4 }]]);
        expect(after.history).toEqual(before.history);
        expect(operations.every(operation => operation.docPath === '')).toBe(true);
    });

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

    it('compares the exact measurement before clearing and preserves unrelated same-day data', () => {
        const date = '2026-10-17';
        const before = base({ nutrition: { [date]: {
            date, kcal: 120, carbs: 20, pro: 6, fat: 2,
            weight: 77.5, waist: 86, bf: 19.5,
            bfProvenance: { method: 'us_navy', inputs: { waistCm: 86 } },
            measurementTime: '07:50',
            meals: [{ id: 'meal-preserved', meal: 'breakfast', name: 'Avena', quantity: 50, kcal: 240, carbs: 40, pro: 12, fat: 4 }],
            sleepHours: '07:20', steps: 4200, stepsSource: 'manual',
        } } });
        const observedDay = before.nutrition![date];
        const operation = { type: 'measurement.delete', date, expected: captureMeasurement(observedDay) } as const;
        const { after, operations } = compile(before, operation);
        const remaining = after.nutrition?.[date];
        expect(remaining).toMatchObject({ meals: observedDay.meals, sleepHours: '07:20', steps: 4200, stepsSource: 'manual' });
        expect(captureMeasurement(remaining!)).toEqual({});
        expect(operations).toHaveLength(5);
        expect(operations.map(item => item.path[1]).sort()).toEqual(['bf', 'bfProvenance', 'measurementTime', 'waist', 'weight']);
        expect(operations.every(item => item.docPath === 'nutrition_months/2026-10' && item.path[0] === date && item.isDelete)).toBe(true);

        const changed = applyDomainOperations(before, { type: 'nutrition-day.patch', date, patch: { measurementTime: '08:10' } });
        expect(() => applyDomainOperations(changed, operation)).toThrow('Misurazione cambiata');
        expect(() => applyDomainOperations(after, operation)).toThrow('Misurazione cambiata');
    });
});
