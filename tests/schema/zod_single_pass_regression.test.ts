import { describe, expect, it } from 'vitest';
import type { CachedGlobalCatalog, UserData } from '../../src/types';
import { UserDataSchema } from '../../src/lib/schema';
import { assertCloudBusinessPreserved, CloudDataIntegrityError } from '../../src/lib/sync/cloudBusinessIntegrity';
import { projectDocuments, projectValidatedDomainDocuments, type DocumentProjectionScope } from '../../src/lib/sync/documentProjection';
import { applyDomainOperations, compileDomainOperations } from '../../src/lib/sync/domainOperations';

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
        expect(UserDataSchema.parse(result)).toEqual(result);
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
        expect(UserDataSchema.parse(parsed)).toEqual(parsed);
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
            rootKeys: new Set(['profile', 'library', 'catalogOverrides']),
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
});
