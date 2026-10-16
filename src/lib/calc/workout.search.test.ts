import { describe, expect, it } from 'vitest';
import { searchExerciseLibrary, createExerciseLibrarySearcher, filterItems, getLatestUserWeight } from './workout';

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

    it('reuses an exercise search index, retaining ranking and separating different owners', () => {
        const search = createExerciseLibrarySearcher(exercises);
        for (const query of ['', 'panca', 'pancca', 'panca piana', 'quadricipiti']) {
            expect(search(query)).toEqual(searchExerciseLibrary(exercises, query));
        }
        const otherOwner = createExerciseLibrarySearcher([{ id: 'private', name: 'Rematore' }]);
        expect(otherOwner('panca')).toEqual([]);
        expect(search('panca').map(item => item.id)).toEqual(['a']);
    });

    it('selects the latest valid weight in unsorted nutrition history', () => {
        const nutrition = {
            '2026-10-15': { weight: '78,5' },
            '2025-01-01': { weight: 90 },
            '2026-11-01': { weight: 'invalid' },
            '2026-09-01': { weight: '79' }
        };
        expect(getLatestUserWeight(nutrition)).toBe(78.5);
        expect(getLatestUserWeight({ '2026-01-01': { weight: 0 } }, { weight: '82,5' })).toBe(82.5);
    });

    it('orders imported unpadded and Italian dates chronologically, ignoring invalid day keys', () => {
        const nutrition = {
            '2026-2-10': { weight: 81 },
            '2026-10-01': { weight: 78.5 },
            '15/09/2026': { weight: '79,5' },
            '2026-02-30': { weight: 110 },
            'not-a-date': { weight: 200 },
        };
        expect(getLatestUserWeight(nutrition)).toBe(78.5);
        expect(getLatestUserWeight({
            '2026-02-31': { weight: 999 },
            '2026-09-05': { weight: 'invalid' },
        }, { weight: 74 })).toBe(74);
        expect(getLatestUserWeight({ '2026-10-03': { weight: '82,1' }, '2026-10-2': { weight: 85 })).toBe(82.1);
    });

    it('supports caller-selected fields without changing empty-query semantics', () => {
        const items = [{ id: 42, label: 'Spalle', weight: 15 }];
        const matches: typeof items = filterItems(items, 'spalle', 'label');
        expect(matches).toEqual(items);
        expect(filterItems(items, '', 'label')).toBe(items);
    });
});
