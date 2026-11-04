import { describe, expect, it } from 'vitest';
import { getWorkoutDurationSeconds } from './workoutDuration';
import { getRoutineDurationEstimate } from '../../components/Training/session/sessionDurationEstimate';
import { computeWorkoutReport } from './workoutReport';
import type { WorkoutSession } from '../../types';

describe('canonical workout duration', () => {
    const session = (id: string): WorkoutSession => ({
        id, routineId: 'routine-a', date: '2026-09-24',
        exercises: [],
        globalStartTime: 1000,
        globalEndTime: 2401000,
        globalDurationStr: '00:40:00',
        manualDurationStr: '00:45:00',
    });

    it('prefers the edited duration consistently over timestamps and recorded timer text', () => {
        const workout = session('a');
        expect(getWorkoutDurationSeconds(workout)).toBe(2700);
        expect(computeWorkoutReport(workout, [], new Map(), 80).durationSeconds).toBe(2700);
        expect(getRoutineDurationEstimate('routine-a', [session('a'), session('b'), session('c')]))
            .toEqual({ minutes: 45, sampleSize: 3 });
    });

    it('falls back to canonical timer text, then verified timestamps', () => {
        expect(getWorkoutDurationSeconds({ globalDurationStr: '00:40:00', globalStartTime: 1000, globalEndTime: 3001000 })).toBe(2400);
        expect(getWorkoutDurationSeconds({ globalStartTime: 1000, globalEndTime: 3001000 })).toBe(3000);
        expect(getWorkoutDurationSeconds({ globalStartTime: 3001000, globalEndTime: 1000 })).toBeUndefined();
        expect(getWorkoutDurationSeconds({ manualDurationStr: 'invalid', globalDurationStr: '00:20:00' })).toBe(1200);
    });
});
