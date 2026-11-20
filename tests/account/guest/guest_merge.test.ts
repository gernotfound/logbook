import { describe, it, expect } from 'vitest';
import { hasUserData, mergeArrayById, mergeNutrition, mergeProfile, filterCustomExercises, filterCustomFoods } from '../../../src/lib/merge';
import { getSeedCatalog } from '../../../src/lib/catalog/catalogService';
import type { Exercise, Food } from '../../../src/types';
import { asUserExercises } from './guestMergeFixture';

describe('Deterministic Guest Merge (R5) Suite', () => {
    it('merges only canonical hip measurements without reviving the pre-launch alias', () => {
        expect(mergeProfile({ hip: '88' }, { hips: '99' } as any)).toEqual({ hip: '88' });
        expect(mergeProfile({}, { hips: '99' } as any)).toEqual({});

        const day = { date: '2026-10-04', kcal: 0, carbs: 0, pro: 0, fat: 0 };
        const cloud = { ...day, hip: 95 };
        const guest = { ...day, hips: 99 } as any;
        const merged = mergeNutrition({ [day.date]: cloud }, { [day.date]: guest });
        expect(merged[day.date].hip).toBe(95);
        expect(merged[day.date]).not.toHaveProperty('hips');
    });

    describe('filterCustomExercises & filterCustomFoods helpers', () => {
        it('filters out standard seed catalog exercises and preserves user custom exercises', () => {
            const seed = getSeedCatalog();
            const standardEx = asUserExercises(seed.exercises)[0]; // e.g. panca-piana-bilanciere
            const customEx1: Exercise = { id: 'custom_ex_1', name: 'Custom Fly', setsCount: 3, sets: [], isDefault: false };
            const customEx2: Exercise = { id: 'custom_ex_2', name: 'Another Custom', setsCount: 4, sets: [] };

            const filtered = filterCustomExercises([standardEx, customEx1, customEx2]);
            expect(filtered).toHaveLength(2);
            expect(filtered.map(e => e.id)).toEqual(['custom_ex_1', 'custom_ex_2']);
        });

        it('filters out standard seed catalog foods and preserves user custom foods', () => {
            const seed = getSeedCatalog();
            const standardFood = seed.foods[0]; // e.g. petto-di-pollo-crudo
            const customFood1: Food = { id: 'custom_food_1', name: 'Custom Shake', kcal: 250, pro: 30, carbs: 10, fat: 5, isCustom: true };
            const customFood2: Food = { id: 'custom_food_2', name: 'Custom Oats', kcal: 350, pro: 12, carbs: 60, fat: 7 };

            const filtered = filterCustomFoods([standardFood, customFood1, customFood2]);
            expect(filtered).toHaveLength(2);
            expect(filtered.map(f => f.id)).toEqual(['custom_food_1', 'custom_food_2']);
        });
    });

    describe('hasUserData utility', () => {
        it('returns false for null, undefined, or empty objects', () => {
            expect(hasUserData(null)).toBe(false);
            expect(hasUserData(undefined)).toBe(false);
            expect(hasUserData({})).toBe(false);
            expect(hasUserData({ library: [], routines: [], history: [], nutrition: {}, customFoods: [], supplements: [], trainingCycles: [] })).toBe(false);
        });

        it('returns false for pristine state containing only standard seed catalog items', () => {
            const seed = getSeedCatalog();
            expect(hasUserData({
                library: asUserExercises(seed.exercises),
                customFoods: seed.foods,
                catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
            })).toBe(false);
        });

        it('returns true if catalogOverrides contains any modification or hidden item', () => {
            expect(hasUserData({ catalogOverrides: { exercises: { 'panca-piana-bilanciere': { notes: 'Pausa' } } } })).toBe(true);
            expect(hasUserData({ catalogOverrides: { foods: { 'petto-di-pollo-crudo': { pro: 25 } } } })).toBe(true);
            expect(hasUserData({ catalogOverrides: { hiddenExerciseIds: ['panca-declinata-bilanciere'] } })).toBe(true);
            expect(hasUserData({ catalogOverrides: { hiddenFoodIds: ['petto-di-tacchino-crudo'] } })).toBe(true);
        });

        it('returns true if any collection or profile has user data', () => {
            expect(hasUserData({ library: [{ id: 'ex1', name: 'Bench', setsCount: 3, sets: [] }] })).toBe(true);
            expect(hasUserData({ routines: [{ id: 'r1', name: 'Push', exercises: [] }] })).toBe(true);
            expect(hasUserData({ history: [{ id: 'h1', exercises: [] }] })).toBe(true);
            expect(hasUserData({ customFoods: [{ id: 'f1', name: 'Oats', kcal: 370, pro: 13, carbs: 60, fat: 7 }] })).toBe(true);
            expect(hasUserData({ trainingCycles: [{ id: 'c1', name: 'Hypertrophy', durationWeeks: 8, routines: [] }] })).toBe(true);
            expect(hasUserData({ supplements: [{ id: 's1', name: 'Creatine', unit: 'g' }] })).toBe(true);
            expect(hasUserData({ nutrition: { '2026-08-16': { date: '2026-08-16', kcal: 2000, carbs: 200, pro: 150, fat: 60 } } })).toBe(true);
            expect(hasUserData({ activeWorkout: { exercises: [{ exId: 'ex1', sessionNote: '', sets: [] }] } })).toBe(true);
            expect(hasUserData({ profile: { height: '180' } })).toBe(true);
        });
    });

    describe('mergeArrayById helper', () => {
        it('handles null and undefined arrays gracefully', () => {
            expect(mergeArrayById(null, null)).toEqual([]);
            expect(mergeArrayById(undefined, [{ id: '1', name: 'A' }])).toEqual([{ id: '1', name: 'A' }]);
            expect(mergeArrayById([{ id: '1', name: 'A' }], undefined)).toEqual([{ id: '1', name: 'A' }]);
        });

        it('deduplicates by ID with guest priority and preserves disjoint items', () => {
            const cloud = [
                { id: '1', name: 'Cloud Item 1', val: 10 },
                { id: '2', name: 'Cloud Item 2', val: 20 }
            ];
            const guest = [
                { id: '2', name: 'Guest Item 2 Edited', val: 25 },
                { id: '3', name: 'Guest Item 3', val: 30 }
            ];

            const result = mergeArrayById<{ id: string | number; name: string }>(cloud, guest);
            expect(result).toHaveLength(3);
            expect(result.find(x => x.id === '1')).toEqual({ id: '1', name: 'Cloud Item 1', val: 10 });
            expect(result.find(x => x.id === '2')).toEqual({ id: '2', name: 'Guest Item 2 Edited', val: 25 });
            expect(result.find(x => x.id === '3')).toEqual({ id: '3', name: 'Guest Item 3', val: 30 });
        });

        it('normalizes string and number IDs to deduplicate correctly', () => {
            const cloud = [{ id: 100, name: 'Cloud Food' }];
            const guest = [{ id: '100', name: 'Guest Food Overwrite' }];

            const result = mergeArrayById<{ id: string | number; name: string }>(cloud, guest);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Guest Food Overwrite');
        });
        it('quarantines non-ID items from both arrays', () => {
            const cloud = [{ name: 'Cloud Item Without ID' } as any, { id: 'c1', name: 'Cloud 1' }];
            const guest = [{ name: 'Guest Item Without ID' } as any, { id: 'g1', name: 'Guest 1' }];

            const result = mergeArrayById<{ id: string | number; name: string }>(cloud, guest);
            expect(result).toEqual([
                { id: 'c1', name: 'Cloud 1' },
                { id: 'g1', name: 'Guest 1' },
            ]);
        });
    });

});
