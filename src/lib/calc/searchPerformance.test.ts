import { describe, expect, it } from 'vitest';
import { createFoodSearcher } from './nutrition';
import { createExerciseLibrarySearcher } from './workout';

describe('catalog search index equivalence', () => {
    it('reuses indexes without changing search results on large deterministic catalogs', () => {
        const foodNames = ['Pollo arrosto', 'Riso integrale', 'Yogurt greco', 'Fagioli rossi'];
        const foods = Array.from({ length: 600 }, (_, i) => ({
            id: `food-${i}`,
            name: `${foodNames[i % foodNames.length]} ${i}`,
            category: 'alimentazione',
            kcal: 100 + i % 200,
            carbs: i % 80,
            pro: i % 35,
            fat: i % 20,
        }));
        const exerciseNames = ['Panca piana', 'Squat', 'Rematore', 'Pressa gambe'];
        const exercises = Array.from({ length: 600 }, (_, i) => ({
            id: `exercise-${i}`,
            name: `${exerciseNames[i % exerciseNames.length]} ${i}`,
            muscles: [],
            notes: 'Macchina',
        }));
        const foodExamples = [
            ['pollo', 'food-0'],
            ['polo', 'food-0'],
            ['riso', 'food-1'],
            ['greco', 'food-2'],
        ] as const;
        const exerciseExamples = [
            ['panca', 'exercise-0'],
            ['pancca', 'exercise-0'],
            ['squat', 'exercise-1'],
            ['rematore', 'exercise-2'],
        ] as const;

        const preparedFoods = createFoodSearcher(foods);
        const preparedExercises = createExerciseLibrarySearcher(exercises);
        expect(preparedFoods('')).toHaveLength(600);
        for (const query of ['p', 'pollo', 'polo', 'riso', 'greco', 'rossi', 'not-found']) {
            const complete = preparedFoods(query).map(item => item.id);
            for (const limit of [1, 5, 15]) {
                expect(preparedFoods(query, limit).map(item => item.id)).toEqual(complete.slice(0, limit));
            }
        }
        expect(preparedExercises('')).toHaveLength(600);

        for (const [query, expectedId] of foodExamples) {
            const indexedIds = preparedFoods(query).map(item => item.id);
            expect(indexedIds).toContain(expectedId);
            expect(new Set(indexedIds).size).toBe(indexedIds.length);
        }
        for (const [query, expectedId] of exerciseExamples) {
            const indexedIds = preparedExercises(query).map(item => item.id);
            expect(indexedIds).toContain(expectedId);
            expect(new Set(indexedIds).size).toBe(indexedIds.length);
        }

    });
});
