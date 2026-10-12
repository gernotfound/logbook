import { describe, expect, it } from 'vitest';
import { searchExerciseLibrary, filterItems } from './workout';

describe('typed workout search contracts', () => {
    const exercises = [
        { id: 'a', name: 'Panca piana', muscles: ['chest_upper_left'], notes: 'Presa media', setsCount: 4, customFlag: true },
        { id: 'b', name: 'Squat', muscles: ['quadriceps_left'], notes: '', setsCount: 3, customFlag: false },
    ];

    it('preserves exercise metadata and field types through direct/fuzzy search', () => {
        const results: typeof exercises = searchExerciseLibrary(exercises, 'panca');
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ id: 'a', setsCount: 4, customFlag: true });
        const typoResults: typeof exercises = searchExerciseLibrary(exercises, 'pancca');
        expect(typoResults.map(item => item.id)).toContain('a');
    });

    it('keeps blank-query alphabetical ordering without mutating the caller library', () => {
        const originalIds = exercises.map(item => item.id);
        const all = searchExerciseLibrary(exercises, '   ');
        expect(all.map(item => item.id)).toEqual(['a', 'b']);
        expect(exercises.map(item => item.id)).toEqual(originalIds);
    });

    it('preserves arbitrary item fields in filterItems and direct-first deduplication', () => {
        const items = [
            { id: 'one', name: 'Panca piana', priority: 9 },
            { id: 'two', name: 'Squat', priority: 3 },
        ];
        const filtered: typeof items = filterItems(items, 'panca');
        expect(filtered).toHaveLength(1);
        expect(filtered[0]).toBe(items[0]);
        expect(filtered[0].priority).toBe(9);
        expect(filterItems(items, '')).toBe(items);
    });

    it('supports caller-selected fields without changing empty-query semantics', () => {
        const items = [{ id: 42, label: 'Spalle', weight: 15 }];
        const matches: typeof items = filterItems(items, 'spalle', 'label');
        expect(matches).toEqual(items);
        expect(filterItems(items, '', 'label')).toBe(items);
    });
});
