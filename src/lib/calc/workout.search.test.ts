import { describe, expect, it } from 'vitest';
import { createExerciseLibrarySearcher, getLatestUserWeight } from './workout';

describe('typed workout search contracts', () => {
    const exercises = [
        { id: 'a', name: 'Panca piana', muscles: ['chest_upper_left'], notes: 'Presa media', setsCount: 4, customFlag: true },
        { id: 'b', name: 'Squat', muscles: ['quadriceps_left'], notes: '', setsCount: 3, customFlag: false },
    ];

    it('preserves exercise metadata and field types through direct/fuzzy search', () => {
        const results: typeof exercises = createExerciseLibrarySearcher(exercises)('panca');
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ id: 'a', setsCount: 4, customFlag: true });
        const typoResults: typeof exercises = createExerciseLibrarySearcher(exercises)('pancca');
        expect(typoResults.map(item => item.id)).toContain('a');
    });

    it('keeps blank-query alphabetical ordering without mutating the caller library', () => {
        const originalIds = exercises.map(item => item.id);
        const all = createExerciseLibrarySearcher(exercises)('   ');
        expect(all.map(item => item.id)).toEqual(['a', 'b']);
        expect(exercises.map(item => item.id)).toEqual(originalIds);
    });

    it('returns independent alphabetically sorted arrays from a reused searcher', () => {
        const searcher = createExerciseLibrarySearcher(exercises);
        const first = searcher('');
        const second = searcher('   ');
        expect(first).toEqual(second);
        expect(first).not.toBe(second);
        first.reverse();
        expect(searcher('').map(item => item.id)).toEqual(second.map(item => item.id));
    });

    it('reuses an exercise search index, retaining ranking and separating different owners', () => {
        const search = createExerciseLibrarySearcher(exercises);
        expect(search('panca').map(item => item.id)).toEqual(['a']);
        expect(search('quadricipiti').map(item => item.id)).toEqual(['b']);
        expect(search('').map(item => item.id)).toEqual(['a', 'b']);
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

    it('ignores pre-launch date keys without rewriting them or replacing canonical measurements', () => {
        const nutrition = {
            '2026-12-1': { weight: 81 },
            '2026-10-01': { weight: 78.5 },
            '15/12/2026': { weight: '79,5' },
            ' 2026-12-20 ': { weight: 150 },
            '2026-12-25T12:00:00': { weight: 160 },
            '2026-02-30': { weight: 110 },
            'not-a-date': { weight: 200 },
        };
        const before = structuredClone(nutrition);
        expect(getLatestUserWeight(nutrition)).toBe(78.5);
        expect(nutrition).toEqual(before);
        expect(getLatestUserWeight({ '15/12/2026': { weight: 90 }, '2026-12-1': { weight: 99 } }, { weight: 74 })).toBe(74);
        expect(getLatestUserWeight({ '15/12/2026': { weight: 90 } })).toBe(80);
        expect(getLatestUserWeight({
            '2026-02-31': { weight: 999 },
            '2026-09-05': { weight: 'invalid' },
        }, { weight: 74 })).toBe(74);
        expect(getLatestUserWeight({ '2026-10-03': { weight: '82,1' }, '2026-10-2': { weight: 85 } })).toBe(82.1);
    });

});

describe('single-token exercise category search', () => {
    it('includes the tracking-type field in direct search while keeping name matching', () => {
        const library = [
            { id: 'erg', name: 'Ergometro', trackingType: 'cardio' as const },
            { id: 'plank', name: 'Plank', trackingType: 'time' as const },
            { id: 'bench', name: 'Panca', trackingType: 'weight_reps' as const },
        ];
        const searcher = createExerciseLibrarySearcher(library);
        expect(searcher('cardio').map(item => item.id)).toEqual(['erg']);
        expect(createExerciseLibrarySearcher(library)('isometria').map(item => item.id)).toEqual(['plank']);
        expect(searcher('peso').map(item => item.id)).toEqual(['bench']);
        expect(searcher('Panca').map(item => item.id)).toContain('bench');
    });
});
