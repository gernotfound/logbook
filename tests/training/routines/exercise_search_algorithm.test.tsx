import { describe, expect, it } from 'vitest';
import { mockLibrary } from './exerciseSearchTestFixture';
import { normalizeStem } from '../../../src/lib/logic';
import { createExerciseLibrarySearcher } from '../../../src/lib/calc/workout';

    describe('1. createExerciseLibrarySearcher Algorithm & Typo Tolerance', () => {
        it('1.1: Exact name matching returns exercise', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('Panca Piana Bilanciere');
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].id).toBe('ex_bench');
        });

        it('1.2: Substring matching is case-insensitive', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('panca');
            expect(results.length).toBe(2);
            expect(results.map(r => r.id)).toContain('ex_bench');
            expect(results.map(r => r.id)).toContain('ex_incline');
        });

        it('1.3: Fuzzy typo-tolerance matches misspelled exercise names', () => {
            // "pancca" -> Panca Piana Bilanciere / Panca Inclinata
            const typoPanca = createExerciseLibrarySearcher(mockLibrary)('pancca');
            expect(typoPanca.length).toBeGreaterThanOrEqual(1);
            expect(typoPanca.map(r => r.id)).toContain('ex_bench');

            // "squatt" -> Squat con Bilanciere
            const typoSquat = createExerciseLibrarySearcher(mockLibrary)('squatt');
            expect(typoSquat.length).toBeGreaterThanOrEqual(1);
            expect(typoSquat[0].id).toBe('ex_squat');

            // "trazzioni" -> Trazioni alla Sbarra
            const typoTrazioni = createExerciseLibrarySearcher(mockLibrary)('trazzioni');
            expect(typoTrazioni.length).toBeGreaterThanOrEqual(1);
            expect(typoTrazioni[0].id).toBe('ex_pullup');
        });

        it('1.4: Search by Italian primary muscle group matches mapped exercises', () => {
            // "petto" -> Panca Piana, Panca Inclinata
            const chestExercises = createExerciseLibrarySearcher(mockLibrary)('petto');
            expect(chestExercises.length).toBeGreaterThanOrEqual(2);
            expect(chestExercises.map(r => r.id)).toContain('ex_bench');
            expect(chestExercises.map(r => r.id)).toContain('ex_incline');

            // "dorso" -> Trazioni alla Sbarra
            const backExercises = createExerciseLibrarySearcher(mockLibrary)('dorso');
            expect(backExercises.length).toBeGreaterThanOrEqual(1);
            expect(backExercises.map(r => r.id)).toContain('ex_pullup');
        });

        it('1.5: Search by Italian secondary muscle matches exercises', () => {
            // "bicipiti" -> Trazioni alla Sbarra (secondary muscle biceps)
            const bicepsExercises = createExerciseLibrarySearcher(mockLibrary)('bicipiti');
            expect(bicepsExercises.length).toBeGreaterThanOrEqual(1);
            expect(bicepsExercises.map(r => r.id)).toContain('ex_pullup');

            // "tricipiti" -> Panca Piana Bilanciere (secondary muscle triceps)
            const tricepsExercises = createExerciseLibrarySearcher(mockLibrary)('tricipiti');
            expect(tricepsExercises.length).toBeGreaterThanOrEqual(1);
            expect(tricepsExercises.map(r => r.id)).toContain('ex_bench');
        });

        it('1.6: Multi-token combined search matches multiple criteria', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('petto bilanciere');
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].id).toBe('ex_bench');
        });

        it('1.7: Tracking type keyword search finds cardio and time exercises', () => {
            const cardioResults = createExerciseLibrarySearcher(mockLibrary)('cardio');
            expect(cardioResults.length).toBeGreaterThanOrEqual(1);
            expect(cardioResults.map(r => r.id)).toContain('ex_treadmill');

            const timeResults = createExerciseLibrarySearcher(mockLibrary)('plank');
            expect(timeResults.length).toBeGreaterThanOrEqual(1);
            expect(timeResults.map(r => r.id)).toContain('ex_plank');
        });

        it('1.8: Empty query returns full library sorted alphabetically', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('');
            expect(results.length).toBe(mockLibrary.length);
            const names = results.map(r => r.name);
            const sortedNames = [...names].sort((a, b) => a.localeCompare(b, 'it'));
            expect(names).toEqual(sortedNames);
        });

        it('1.9: Regex metacharacters are literal and never match unknown exercises', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('.*+?^${}()|[]\\');
            expect(results).toEqual([]);
        });

        it('1.10: Empty library or non-array returns empty array safely', () => {
            expect(createExerciseLibrarySearcher([])('panca')).toEqual([]);
            expect(createExerciseLibrarySearcher(null as any)('panca')).toEqual([]);
            expect(createExerciseLibrarySearcher(undefined as any)('panca')).toEqual([]);
        });

        it('1.11: normalizeStem helper handles Italian muscle suffixes properly', () => {
            expect(normalizeStem('pettorali')).toBe('petto');
            expect(normalizeStem('deltoidi')).toBe('deltoid');
            expect(normalizeStem('bicipiti')).toBe('bicipit');
            expect(normalizeStem('tricipiti')).toBe('tricipit');
            expect(normalizeStem('quadricipiti')).toBe('quadricipit');
            expect(normalizeStem('femorali')).toBe('femoral');
            expect(normalizeStem('polpacci')).toBe('polpacc');
            expect(normalizeStem('addominali')).toBe('addom');
        });
    })
