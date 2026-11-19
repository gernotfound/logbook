import { describe, expect, it } from 'vitest';
import type { Exercise, WorkoutSession } from '../../types';
import {
    buildHomeMuscleExposureIndex,
    calculateHomeWorkoutStreak,
    getHomeWorkoutDate,
    getRecentHomeMuscles,
} from './homeTrainingMetrics';

const session = (date: string, time?: number, exId = 'press'): WorkoutSession => ({
    date,
    globalStartTime: time,
    exercises: [{ exId, sessionNote: '', sets: [{ id: 's1', kg: '50', reps: '8' }] }],
});

const library: ReadonlyMap<string, Exercise> = new Map([
    ['press', { id: 'press', name: 'Press', setsCount: 1, sets: [], muscles: ['chest_lower'] }],
    ['curl', { id: 'curl', name: 'Curl', setsCount: 1, sets: [], muscles: ['biceps'] }],
    ['future', { id: 'future', name: 'Future', setsCount: 1, sets: [], muscles: ['future_area'] }],
]);

describe('Home workout selectors', () => {
    it('counts distinct consecutive calendar days, including a streak starting yesterday', () => {
        const now = new Date('2026-11-19T12:00:00').getTime();
        expect(calculateHomeWorkoutStreak([
            session('2026-11-18'), session('2026-11-17'), session('2026-11-15'),
        ], now)).toBe(2);
        expect(calculateHomeWorkoutStreak([
            session('2026-11-19'), session('2026-11-19'),
            session('2026-11-18'), session('2026-11-17'),
        ], now)).toBe(3);
        expect(calculateHomeWorkoutStreak([session('2026-11-15')], now)).toBe(0);
    });

    it('keeps the date explicit on a workout and falls back to a stored timestamp', () => {
        const timestamp = new Date('2026-11-19T12:00:00').getTime();
        expect(getHomeWorkoutDate(session('2026-11-18', timestamp))).toBe('2026-11-18');
        expect(getHomeWorkoutDate({ exercises: [], globalStartTime: timestamp })).toBe('2026-11-19');
    });

    it('sorts factual exposure, includes the 72-hour edge and excludes older or future sessions', () => {
        const now = new Date('2026-11-19T12:00:00').getTime();
        const edge = now - 72 * 60 * 60 * 1000;
        const history = [
            session('2026-11-19', now + 60_000, 'future'),
            session('2026-11-16', edge - 1, 'curl'),
            session('2026-11-16', edge, 'press'),
            session('2026-11-19', now, 'missing-library-item'),
            { date: '2026-11-19', globalStartTime: now, exercises: [] },
        ] satisfies WorkoutSession[];
        const snapshot = structuredClone(history);
        const index = buildHomeMuscleExposureIndex(history, library);
        expect(index.map(entry => entry.time)).toEqual([edge - 1, edge, now + 60_000]);
        expect(getRecentHomeMuscles(index, now).has('chest_lower')).toBe(true);
        expect(getRecentHomeMuscles(index, now).has('biceps')).toBe(false);
        expect(getRecentHomeMuscles(index, now).has('future_area')).toBe(false);
        expect(getRecentHomeMuscles(index, now + 60_000).has('future_area')).toBe(true);
        expect(history).toEqual(snapshot);
    });
});
