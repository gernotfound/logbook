import { afterEach, describe, expect, it } from 'vitest';
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

    it('fails completion when the end wall clock is materially before the start time', () => {
        expect(() => assertWorkoutClockHealthy('w4', 100_000, 1_000)).toThrow(WorkoutClockAnomalyError);
    });
});
