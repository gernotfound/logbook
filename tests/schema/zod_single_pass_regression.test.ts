import { describe, expect, it, vi } from 'vitest';
import type { CachedGlobalCatalog, UserData } from '../../src/types';
import { DomainParsers, UserDataSchema, WorkoutSessionSchema } from '../../src/lib/schema';
import { hasUserData } from '../../src/lib/merge';
import { assertCloudBusinessPreserved, CloudDataIntegrityError } from '../../src/lib/sync/cloudBusinessIntegrity';
import { projectDocuments, projectValidatedDomainDocuments, type DocumentProjectionScope } from '../../src/lib/sync/documentProjection';
import { applyDomainOperations, compileDomainOperations, type DomainOperation } from '../../src/lib/sync/domainOperations';
import { diffDocuments } from '../../src/lib/sync/semanticProjection';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'single-pass-test',
        updatedAt: '2026-11-11T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

describe('Zod single-pass parsing with preserved business invariants', () => {
    it('normalizes once, drops invalid/duplicate identities and retains supported fields', () => {
        const meal = {
            id: 'meal-1', name: 'Pasta', meal: 'pranzo', quantity: '100',
            kcal: '200', carbs: '30', pro: '6', fat: '3', customNote: 'retained',
        };
        const input = {
            library: [
                { id: 'ex-1', name: 'Squat', setsCount: '3', customNote: 'retained' },
                { id: 'ex-1', name: 'duplicate' },
                { name: 'no id' },
            ],
            routines: [{
                id: 'routine-1', name: 'Routine', exercises: [
                    { exId: 'ex-1', setsCount: '3' },
                    { exId: 'ex-1', setsCount: 2 },
                    { setsCount: 4 },
                ],
            }],
            trainingCycles: [{
                id: 'cycle-1', name: 'Blocco', durationWeeks: '4', routines: [
                    { routineId: 'routine-1', frequencyPerWeek: '2' },
                    { routineId: 'routine-1', frequencyPerWeek: 1 },
                    { frequencyPerWeek: 1 },
                ],
            }],
            nutrition: {
                '2026-11-11': {
                    date: '2026-11-11', kcal: '200', carbs: '30', pro: '6', fat: '3',
                    meals: [meal, { ...meal, name: 'duplicate' }, { ...meal, id: 42 }],
                    supplementsIntake: [
                        { id: 'intake-1', supplementId: 'supp-1', amount: '1', time: '123' },
                        { id: 'intake-1', supplementId: 'supp-1', amount: 2, time: 123 },
                        { id: 'intake-invalid', supplementId: '', amount: 1, time: 123 },
                    ],
                    cardioSessions: [
                        { id: 'cardio-1', modality: 'run', durationMinutes: 30 },
                        { id: 'cardio-1', modality: 'walk', durationMinutes: 60 },
                        { id: '', modality: 'run', durationMinutes: 30 },
                    ],
                },
            },
        };
        const original = structuredClone(input);
        const result = UserDataSchema.parse(input);
        const day = result.nutrition['2026-11-11'];

        expect(result.library.map(item => item.id)).toEqual(['ex-1']);
        expect(result.library[0]).toMatchObject({ setsCount: 3, customNote: 'retained' });
        expect(result.routines[0].exercises).toEqual([{ exId: 'ex-1', setsCount: 3 }]);
        expect(result.trainingCycles[0].routines).toEqual([{ routineId: 'routine-1', frequencyPerWeek: 2 }]);
        expect(day.meals).toEqual([{ ...meal, quantity: 100, kcal: 200, carbs: 30, pro: 6, fat: 3 }]);
        expect(day.supplementsIntake.map(item => item.id)).toEqual(['intake-1']);
        expect(day.cardioSessions.map(item => item.id)).toEqual(['cardio-1']);
        const reparsed = UserDataSchema.parse(result);
        expect(reparsed.library).toEqual(result.library);
        expect(reparsed.routines).toEqual(result.routines);
        expect(reparsed.trainingCycles).toEqual(result.trainingCycles);
        expect(reparsed.nutrition).toEqual(result.nutrition);
        expect(input).toEqual(original);

        expect(() => assertCloudBusinessPreserved('nutrition_months/2026-11', {
            '2026-11-11': input.nutrition['2026-11-11'],
        }, {
            '2026-11-11': day,
        })).toThrow(CloudDataIntegrityError);
    });

    it('keeps a malformed nested collection quarantined, not converted into business data', () => {
        const parsed = UserDataSchema.parse({
            nutrition: {
                '2026-11-11': {
                    date: '2026-11-11',
                    meals: 'corrupted',
                    supplementsIntake: 10,
                    cardioSessions: null,
                },
            },
        });
        const day = parsed.nutrition['2026-11-11'];
        expect(day.meals).toEqual([]);
        expect(day.supplementsIntake).toEqual([]);
        expect(day.cardioSessions).toEqual([]);
        const reparsed = UserDataSchema.parse(parsed);
        expect(reparsed.nutrition).toEqual(parsed.nutrition);
    });

    it('matches full-Zod scoped projections and semantic operations for validated snapshots', () => {
        const before = UserDataSchema.parse({
            profile: { height: '170' },
            library: [{ id: 'ex-1', name: 'Squat', setsCount: 3 }],
            routines: [{ id: 'routine-1', name: 'A', exercises: [{ exId: 'ex-1', setsCount: 3 }] }],
            history: [{ id: 'workout-1', date: '2026-11-11', exercises: [] }],
            nutrition: { '2026-11-11': { date: '2026-11-11', kcal: 0, carbs: 0, pro: 0, fat: 0 } },
        }) as unknown as UserData;
        const after = applyDomainOperations(before, [
            { type: 'profile.patch', patch: { height: '175' } },
            { type: 'nutrition-day.patch', date: '2026-11-11', patch: { weight: '80' } },
        ]);
        const scope: DocumentProjectionScope = {
            rootKeys: new Set(['profile', 'library', 'catalogOverrides', 'nutritionPlanning']),
            monthly: new Map([
                ['history_months/2026-11', new Set(['workout-1'])],
                ['nutrition_months/2026-11', new Set(['2026-11-11'])],
            ]),
        };
        for (const snapshot of [before, after]) {
            expect([...projectValidatedDomainDocuments(snapshot, catalog, scope)])
                .toEqual([...projectDocuments(snapshot, catalog, scope)]);
        }
        const compiled = compileDomainOperations(before, after, [
            { type: 'profile.patch', patch: { height: '175' } },
            { type: 'nutrition-day.patch', date: '2026-11-11', patch: { weight: '80' } },
        ], catalog, 'actor-zod', 1, { 'actor-zod': 1 });
        expect(compiled.length).toBeGreaterThan(0);
        expect(compiled.every(operation => operation.docPath === '' || operation.docPath === 'nutrition_months/2026-11')).toBe(true);
        expect(compiled.some(operation => operation.docPath === '' && operation.path[0] === 'profile')).toBe(true);
        expect(compiled.some(operation => operation.docPath === 'nutrition_months/2026-11')).toBe(true);
    });
    it('validates each history session once while preserving normalized nested sets, identity and source', () => {
        const raw = [{
            id: '  workout-1  ',
            date: '2026-11-11',
            routineName: 42,
            globalStartTime: '1794000000000',
            endTime: 1794000600000,
            exercises: [{
                id: 'session-ex-1',
                exId: 'catalog-ex-1',
                sessionNote: null,
                sets: [{
                    id: 'set-1',
                    kg: 80,
                    reps: 8,
                    rir: 2,
                    segments: [
                        { id: 'segment-1', kg: 60, reps: 6, technique: 'dropset' },
                        { id: 'segment-1', kg: 40, reps: 6, technique: 'dropset' },
                        { id: 'bad/id', kg: 30, reps: 8 },
                    ],
                    dropsets: [{ kg: 20, reps: 5 }],
                }],
            }],
        }, {
            id: 'workout-1', date: '2026-11-11', exercises: [],
        }, { id: '', date: '2026-11-11' }, null, 'corrupted'];
        const original = structuredClone(raw);
        const parseSpy = vi.spyOn(WorkoutSessionSchema, 'parse');
        const history = (() => {
            try {
                const parsed = DomainParsers.parseHistory(raw);
                // Only the first unique valid ID is parsed; duplicates and
                // invalid IDs cannot introduce an additional Zod pass.
                expect(parseSpy).toHaveBeenCalledTimes(1);
                return parsed;
            } finally {
                parseSpy.mockRestore();
            }
        })();
        const state = UserDataSchema.parse({ history });

        expect(history).toHaveLength(1);
        expect(history[0].id).toBe('workout-1');
        expect(history[0].routineName).toBe('42');
        expect(history[0].globalStartTime).toBe(1794000000000);
        expect(history[0]).not.toHaveProperty('endTime');
        expect(history[0].exercises[0].sessionNote).toBe('');
        expect(history[0].exercises[0].sets[0].kg).toBe('80');
        expect(history[0].exercises[0].sets[0].rir).toBe(2);
        expect(history[0].exercises[0].sets[0]).not.toHaveProperty('dropsets');
        expect(history[0].exercises[0].sets[0].segments).toEqual([
            { id: 'segment-1', kg: '60', reps: '6', technique: 'dropset' },
        ]);
        expect(state.history).toEqual(history);
        expect(UserDataSchema.parse(state).history).toEqual(history);
        expect(raw).toEqual(original);

        const projected = projectDocuments(state as unknown as UserData, catalog);
        expect(Object.keys(projected.get('history_months/2026-11') ?? {})).toEqual(['workout-1']);
        expect(() => assertCloudBusinessPreserved('history_months/2026-11', {
            'workout-1': raw[0],
        }, {
            'workout-1': history[0],
        })).toThrow(CloudDataIntegrityError);
    });

    it('matches full-Zod scoped projections and causal operations across domain mutation families', () => {
        const before = UserDataSchema.parse({
            profile: { height: '170' },
            library: [{ id: 'ex-1', name: 'Squat', setsCount: 3, sets: [] }],
            routines: [
                { id: 'r-1', name: 'Upper', exercises: [{ exId: 'ex-1', setsCount: 3 }] },
                { id: 'r-2', name: 'Lower', exercises: [] },
            ],
            customFoods: [{ id: 'food-1', name: 'Riso', kcal: 100, carbs: 20, pro: 2, fat: 1 }],
            history: [{ id: 'historical-1', date: '2026-11-11', exercises: [] }],
            nutrition: { '2026-11-11': { date: '2026-11-11', kcal: 0, carbs: 0, pro: 0, fat: 0 } },
            activeWorkout: { id: 'active-1', date: '2026-11-11', exercises: [] },
            catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] },
        }) as unknown as UserData;
        const root = (...keys: string[]): DocumentProjectionScope => ({
            rootKeys: new Set(keys), monthly: new Map(),
        });
        const scopedMonth = (path: string, id: string): DocumentProjectionScope => ({
            rootKeys: new Set(), monthly: new Map([[path, new Set([id])]]),
        });
        const cases: Array<{
            label: string;
            operation: DomainOperation | DomainOperation[];
            scope: DocumentProjectionScope;
        }> = [
            { label: 'profile', operation: { type: 'profile.patch', patch: { height: '175' } }, scope: root('profile') },
            { label: 'routine order', operation: { type: 'routine.reorder', ids: ['r-2', 'r-1'] }, scope: root('routines') },
            { label: 'catalog visibility', operation: { type: 'catalog.exercise.visibility', id: 'ex-1', hidden: true }, scope: root('catalogOverrides') },
            { label: 'catalog custom food', operation: {
                type: 'food.upsert', food: { id: 'food-2', name: 'Fagioli', kcal: 70, carbs: 12, pro: 4, fat: 1 },
            }, scope: root('customFoods', 'catalogOverrides') },
            { label: 'nutrition planning defaults', operation: {
                type: 'nutrition-planning.replace', value: { weight: 80 }, origin: 'user-edited',
            }, scope: root('nutritionPlanning', 'nutritionPlanningOrigin') },
            { label: 'active workout', operation: { type: 'active-workout.set', workout: null }, scope: root('activeWorkout') },
            { label: 'nutrition day', operation: {
                type: 'nutrition-day.patch', date: '2026-11-11', patch: { weight: 80 },
            }, scope: scopedMonth('nutrition_months/2026-11', '2026-11-11') },
            { label: 'history move', operation: {
                type: 'history.upsert', workout: { id: 'historical-1', date: '2026-12-01', exercises: [] },
            }, scope: {
                rootKeys: new Set(),
                monthly: new Map([
                    ['history_months/2026-11', new Set(['historical-1'])],
                    ['history_months/2026-12', new Set(['historical-1'])],
                ]),
            } },
            { label: 'history delete', operation: { type: 'history.delete', id: 'historical-1' },
                scope: scopedMonth('history_months/2026-11', 'historical-1') },
            { label: 'workout completion', operation: {
                type: 'workout.complete',
                workout: { id: 'active-1', date: '2026-11-11', exercises: [] },
                expectedActiveWorkoutId: 'active-1',
                activePains: ['quads'],
            }, scope: {
                rootKeys: new Set(['activeWorkout', 'activePains']),
                monthly: new Map([['history_months/2026-11', new Set(['active-1'])]]),
            } },
        ];

        for (const { label, operation, scope } of cases) {
            const after = applyDomainOperations(before, operation);
            for (const state of [before, after]) {
                expect([...projectValidatedDomainDocuments(state, catalog, scope)], label)
                    .toEqual([...projectDocuments(state, catalog, scope)]);
            }
            const actor = 'actor-zod-parity';
            const clock = { [actor]: 1 };
            const expected = diffDocuments(
                projectDocuments(before, catalog, scope),
                projectDocuments(after, catalog, scope),
                actor, 1, clock,
            );
            const actual = compileDomainOperations(before, after, operation, catalog, actor, 1, clock);
            expect(actual, label).toEqual(expected);
        }
    });

    it('keeps a missing or empty nutrition plan stable through repeated parsing and guest-data detection', () => {
        const empty = UserDataSchema.parse({}) as unknown as UserData;
        const reparsed = UserDataSchema.parse(empty) as unknown as UserData;
        expect(reparsed.nutritionPlanning).toEqual(empty.nutritionPlanning);
        expect(hasUserData(empty)).toBe(false);
        expect(hasUserData(reparsed)).toBe(false);

        const partial = UserDataSchema.parse({
            nutritionPlanning: { weight: '78.5', notes: 'retain' },
            pendingConflicts: { nutritionPlanning: { onDaysCount: 3 } },
        }) as unknown as UserData;
        expect(partial.nutritionPlanning).toEqual({ weight: 78.5, notes: 'retain' });
        expect(partial.pendingConflicts?.nutritionPlanning).toEqual({ onDaysCount: 3 });
        expect(UserDataSchema.parse(partial).nutritionPlanning).toEqual(partial.nutritionPlanning);
        expect(UserDataSchema.parse(partial).pendingConflicts).toEqual(partial.pendingConflicts);
        expect(hasUserData(partial)).toBe(true);
    });

});
