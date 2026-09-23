import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../src/lib/schema';
import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../src/types';
import {
    applyDomainOperations,
    compileDomainOperations,
    type DomainOperation,
} from '../src/lib/sync/domainOperations';
import { applySemanticOperations } from '../src/lib/sync/semanticProjection';
import { projectDocuments } from '../src/lib/sync/documentProjection';
import {
    CURRENT_BACKUP_SCHEMA,
    CURRENT_DATA_SCHEMA,
    CURRENT_LOCAL_ENVELOPE,
    CURRENT_SYNC_PROTOCOL,
} from '../src/lib/schemaEvolution';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'm8-test',
        updatedAt: '2026-09-15T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

const base = (overrides: Partial<UserData> = {}): UserData => UserDataSchema.parse(overrides) as unknown as UserData;
const compile = (before: UserData, operation: DomainOperation | DomainOperation[]) => {
    const after = applyDomainOperations(before, operation);
    const operations = compileDomainOperations(before, after, operation, catalog, 'actor-a', 1, { 'actor-a': 1 });
    const replay = applySemanticOperations(projectDocuments(before, catalog), operations).documents;
    return { after, operations, replay };
};

describe('M8 Domain Operations V4', () => {
    it('keeps all persisted version dimensions unchanged', () => {
        expect(CURRENT_DATA_SCHEMA).toBe(1);
        expect(CURRENT_SYNC_PROTOCOL).toBe(1);
        expect(CURRENT_LOCAL_ENVELOPE).toBe(4);
        expect(CURRENT_BACKUP_SCHEMA).toBe(3);
    });

    it('compiles a profile patch only inside the profile root scope', () => {
        const before = base({ profile: { height: '170', gender: 'M' }, activePains: ['shoulder'] });
        const { after, operations, replay } = compile(before, { type: 'profile.patch', patch: { height: '171' } });

        expect(after.profile?.height).toBe('171');
        expect(operations.length).toBeGreaterThan(0);
        expect(operations.every(op => op.docPath === '' && op.path[0] === 'profile')).toBe(true);
        expect((replay.get('')?.profile as any).height).toBe('171');
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
        expect((replay.get('nutrition_months/2026-09')?.['2026-09-15'] as any).kcal).toBe(350);
    });

    it('moves a workout across months with an old-month tombstone and new-month upsert', () => {
        const oldWorkout: WorkoutSession = { id: 'w-1', date: '2026-08-31', exercises: [] };
        const movedWorkout: WorkoutSession = { ...oldWorkout, date: '2026-09-01', moodRating: 4 };
        const before = base({ history: [oldWorkout] });
        const { operations, replay } = compile(before, { type: 'history.upsert', workout: movedWorkout });

        expect(operations.some(op => op.docPath === 'history_months/2026-08' && op.path[0] === 'w-1' && op.isDelete)).toBe(true);
        expect(operations.some(op => op.docPath === 'history_months/2026-09' && op.path[0] === 'w-1' && !op.isDelete)).toBe(true);
        expect(replay.get('history_months/2026-08')?.['w-1']).toBeUndefined();
        expect((replay.get('history_months/2026-09')?.['w-1'] as any).date).toBe('2026-09-01');
    });

    it('completes a workout as one domain batch spanning history and root state', () => {
        const active: WorkoutSession = { id: 'w-2', date: '2026-09-15', globalStartTime: 100, exercises: [] };
        const finished: WorkoutSession = { ...active, globalEndTime: 200, globalDurationStr: '00:01:40' };
        const before = base({ activeWorkout: active, activePains: ['old'], history: [] });
        const { after, operations, replay } = compile(before, { type: 'workout.complete', workout: finished, activePains: ['new'] });

        expect(after.activeWorkout).toBeNull();
        expect(after.history?.[0]?.id).toBe('w-2');
        expect(after.activePains).toEqual(['new']);
        expect(new Set(operations.map(op => op.docPath))).toEqual(new Set(['', 'history_months/2026-09']));
        expect(replay.get('')?.activeWorkout).toBeNull();
        expect(replay.get('')?.activePains).toEqual(['new']);
        expect((replay.get('history_months/2026-09')?.['w-2'] as any).globalEndTime).toBe(200);
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

    it('keeps the exercise archive deterministically sorted after an upsert', () => {
        const before = base({ library: [
            { id: 'e-z', name: 'Zeta', setsCount: 3, sets: [] },
        ] });
        const { after } = compile(before, {
            type: 'exercise.upsert',
            exercise: { id: 'e-a', name: 'Alfa', setsCount: 3, sets: [] },
        });

        expect(after.library?.map(item => item.id)).toEqual(['e-a', 'e-z']);
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

    it('rejects a non-null active workout without stable identity', () => {
        const before = base({ activeWorkout: null });
        expect(() => applyDomainOperations(before, {
            type: 'active-workout.set',
            workout: { date: '2026-09-15', exercises: [] },
        })).toThrow(/identificativo non valido/i);
    });
});
