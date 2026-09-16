import { describe, expect, it } from 'vitest';
import {
    filterMuscles,
    getExpandedMuscleIds,
    normalizeStem,
    toggleSmartMuscleSelection
} from '../src/hooks/trainingExercises/muscleSelection';

describe('Training exercise muscle helpers', () => {
    it('preserves Italian muscle stem normalization used by search', () => {
        expect(normalizeStem('deltoidi laterali e pettorali')).toBe('deltoid lateral e petto');
        expect(normalizeStem('bicipiti tricipiti quadricipiti')).toBe('bicipit tricipit quadricipit');
    });

    it('keeps exact/base matches first and caps fuzzy results at ten', () => {
        const results = filterMuscles('bicipiti');
        expect(results.length).toBeGreaterThan(0);
        expect(results.length).toBeLessThanOrEqual(10);
        expect(results[0].id).toBe('biceps');
    });

    it('expands a bilateral base muscle to its left and right ids', () => {
        expect(Array.from(getExpandedMuscleIds([{ id: 'biceps' }])).sort()).toEqual([
            'biceps_left',
            'biceps_right'
        ]);
    });

    it('collapses matching left and right selections back to the base muscle', () => {
        const selected = toggleSmartMuscleSelection(
            [{ id: 'biceps_left' }],
            { id: 'biceps_right' }
        );
        expect(selected.map((muscle) => muscle.id)).toEqual(['biceps']);
    });

    it('toggling an already-selected bilateral base muscle clears it', () => {
        const selected = toggleSmartMuscleSelection(
            [{ id: 'biceps' }],
            { id: 'biceps' }
        );
        expect(selected).toEqual([]);
    });
});
