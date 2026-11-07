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

    it('ignores whitespace-only manual input and preserves hours and seconds', () => {
        expect(getWorkoutDurationSeconds({
            manualDurationStr: '  \t  ', globalDurationStr: '00:02:05',
        })).toBe(125);
        expect(getWorkoutDurationSeconds({
            manualDurationStr: '01:02:03', globalDurationStr: '00:20:00',
        })).toBe(3723);
        expect(getWorkoutDurationSeconds({ manualDurationStr: '00:00:07' })).toBe(7);
    });

    it('rejects malformed timestamps instead of inventing elapsed time, including zero-duration edge', () => {
        const malformed: Array<[unknown, unknown]> = [
            [undefined, 2000], [1000, undefined],
            [NaN, 2000], [1000, NaN],
            [Infinity, 2000], [1000, Infinity],
            [-Infinity, 2000], [1000, -Infinity],
            [-Number.MAX_VALUE, Number.MAX_VALUE],
            ['1000', 2000], [1000, '2000'],
            [2000, 1000],
        ];
        for (const [globalStartTime, globalEndTime] of malformed) {
            expect(getWorkoutDurationSeconds({
                globalStartTime, globalEndTime,
            } as unknown as Parameters<typeof getWorkoutDurationSeconds>[0])).toBeUndefined();
        }
        expect(getWorkoutDurationSeconds({
            globalStartTime: 1000, globalEndTime: 1000,
        })).toBe(0);
    });
    it('excludes overflowing timestamps from reports and the routine estimate sample', () => {
        const overflowing = {
            ...session('overflow'),
            manualDurationStr: undefined,
            globalDurationStr: undefined,
            globalStartTime: -Number.MAX_VALUE,
            globalEndTime: Number.MAX_VALUE,
        };
        const before = structuredClone(overflowing);
        expect(computeWorkoutReport(overflowing, [], new Map(), 80).durationSeconds).toBe(0);
        expect(getRoutineDurationEstimate('routine-a', [
            overflowing, session('a'), session('b'), session('c'),
        ])).toEqual({ minutes: 45, sampleSize: 3 });
        expect(getRoutineDurationEstimate('routine-a', [
            overflowing, session('a'), session('b'),
        ])).toBeNull();
        expect(overflowing).toEqual(before);
    });
});
