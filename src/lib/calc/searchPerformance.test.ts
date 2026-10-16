import { describe, expect, it } from 'vitest';
import { createFoodSearcher, searchFoods } from './nutrition';
import { createExerciseLibrarySearcher, searchExerciseLibrary } from './workout';

// Diagnostic only: CI load differs across runners, so timings must not become a release threshold.
function elapsedMs(task: () => void): number {
    const start = performance.now();
    task();
    return Math.round((performance.now() - start) * 100) / 100;
}

describe('catalog search scaling diagnostic', () => {
    it('compares fresh indexes with reused indexes on large deterministic catalogs', () => {
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
        const queries = ['pollo', 'polo', 'riso', 'greco', 'panca', 'pancca', 'squat', 'rematore'];
        const foodQueries = queries.slice(0, 4);
        const exerciseQueries = queries.slice(4);

        const preparedFoods = createFoodSearcher(foods);
        const preparedExercises = createExerciseLibrarySearcher(exercises);
        preparedFoods('pollo');
        preparedExercises('panca');

        for (const query of foodQueries) {
            expect(preparedFoods(query).map(item => item.id))
                .toEqual(searchFoods(foods, query).map(item => item.id));
        }
        for (const query of exerciseQueries) {
            expect(preparedExercises(query).map(item => item.id))
                .toEqual(searchExerciseLibrary(exercises, query).map(item => item.id));
        }

        const rounds = 3;
        const freshFoodMs = elapsedMs(() => {
            for (let i = 0; i < rounds; i++) for (const query of foodQueries) searchFoods(foods, query);
        });
        const reusedFoodMs = elapsedMs(() => {
            for (let i = 0; i < rounds; i++) for (const query of foodQueries) preparedFoods(query);
        });
        const freshExerciseMs = elapsedMs(() => {
            for (let i = 0; i < rounds; i++) for (const query of exerciseQueries) searchExerciseLibrary(exercises, query);
        });
        const reusedExerciseMs = elapsedMs(() => {
            for (let i = 0; i < rounds; i++) for (const query of exerciseQueries) preparedExercises(query);
        });

        // Collected in CI logs for comparisons; results are observational, not a timing assertion.
        console.info('search-index-diagnostic', JSON.stringify({
            catalogSize: foods.length,
            searchesPerCategory: rounds * foodQueries.length,
            foodFreshMs: freshFoodMs,
            foodReusedMs: reusedFoodMs,
            exerciseFreshMs: freshExerciseMs,
            exerciseReusedMs: reusedExerciseMs,
        }));
    });
});
