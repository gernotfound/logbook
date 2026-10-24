import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { GlobalTimer } from '../src/components/Training/ActiveWorkoutSession';
import { useAppStore } from '../src/store/useAppStore';
import {
    assertWorkoutClockHealthy,
    resetWorkoutClockGuard,
    resumeWorkoutClock,
    sampleWorkoutClock,
    WorkoutClockAnomalyError,
} from '../src/lib/workoutClockGuard';
import { prepareCompletedWorkout } from '../src/hooks/workout/workoutSessionPreparation';
import type { WorkoutSession } from '../src/types';

describe('workout clock guard', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        resetWorkoutClockGuard();
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
        });
    });

    it('detects a large forward wall-clock jump while the document stays visible', () => {
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
        });

        expect(sampleWorkoutClock('w1', 1_000, 1_000, 10).anomalous).toBe(false);
        const jumped = sampleWorkoutClock('w1', 1_000, 7_201_000, 1_010);

        expect(jumped.anomalous).toBe(true);
        expect(() => assertWorkoutClockHealthy('w1', 1_000, 7_201_000)).toThrow(WorkoutClockAnomalyError);
    });

    it('detects a backward wall-clock jump even across a foreground resume', () => {
        sampleWorkoutClock('w2', 100_000, 200_000, 10_000);

        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
        });
        const resumed = resumeWorkoutClock('w2', 100_000, 100_000, 10_100);

        expect(resumed.anomalous).toBe(true);
        expect(() => assertWorkoutClockHealthy('w2', 100_000, 100_000)).toThrow(WorkoutClockAnomalyError);
    });

    it('does not treat a long forward background interval as a clock anomaly', () => {
        sampleWorkoutClock('w3', 1_000, 1_000, 50);

        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
        });
        const resumed = resumeWorkoutClock('w3', 1_000, 7_201_000, 55);

        expect(resumed.anomalous).toBe(false);
        expect(() => assertWorkoutClockHealthy('w3', 1_000, 7_201_000)).not.toThrow();
    });


    it('prevents the business completion helper from saving a detected jump', () => {
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
        });
        sampleWorkoutClock('w-business', 1_000, 1_000, 10);
        sampleWorkoutClock('w-business', 1_000, 7_201_000, 1_010);

        const workout: WorkoutSession = {
            id: 'w-business',
            date: '2026-10-05',
            globalStartTime: 1_000,
            exercises: [],
        };

        expect(() => prepareCompletedWorkout(workout, 7_201_000)).toThrow(WorkoutClockAnomalyError);
    });

    it('shows the clock warning from the mounted live timer and refuses completion after a visible jump', () => {
        vi.useFakeTimers();
        const wall = vi.spyOn(Date, 'now').mockReturnValue(100_000);
        const monotonic = vi.spyOn(performance, 'now').mockReturnValue(1_000);
        const current = { id: 'clock-render', date: '2026-10-05', globalStartTime: 100_000, exercises: [] };
        const { unmount } = render(createElement(GlobalTimer, { workoutId: current.id, startTime: current.globalStartTime }));
        expect(screen.queryByRole('alert')).toBeNull();

        act(() => {
            wall.mockReturnValue(222_000);
            monotonic.mockReturnValue(2_000);
            vi.advanceTimersByTime(1_000);
        });

        expect(screen.getByRole('alert').textContent).toContain('Orologio del dispositivo modificato');
        expect(useAppStore.getState().saveError).toContain('L’orologio del dispositivo è cambiato');
        expect(() => prepareCompletedWorkout(current, 222_000)).toThrow(WorkoutClockAnomalyError);
        unmount();
    });

    it('fails completion when the end wall clock is materially before the start time', () => {
        expect(() => assertWorkoutClockHealthy('w4', 100_000, 1_000)).toThrow(WorkoutClockAnomalyError);
    });
});
