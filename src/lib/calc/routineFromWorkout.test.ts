import { describe, expect, it } from 'vitest';
import type { WorkoutSession } from '../../types';
import { routineFromWorkout } from './routineFromWorkout';

describe('completed workout to reusable routine', () => {
    it('keeps observed set counts, min/max repetitions and does not mutate the completed session', () => {
        const workout: WorkoutSession = { id: 'done', exercises: [
            { exId: 'squat', sessionNote: '', sets: [
                { id: 'a', kg: '80', reps: '10' },
                { id: 'b', kg: '90', reps: '8' },
                { id: 'c', kg: '90', reps: '' },
            ] },
            { exId: 'empty', sessionNote: '', sets: [] },
        ] };
        const snapshot = structuredClone(workout);
        expect(routineFromWorkout(workout, 'r-new', 'Nuova scheda')).toEqual({
            id: 'r-new', name: 'Nuova scheda', exercises: [
                { exId: 'squat', setsCount: 3, minReps: 8, maxReps: 10 },
                { exId: 'empty', setsCount: 1 },
            ],
        });
        expect(workout).toEqual(snapshot);
    });

    it('preserves a pure legacy isometry as the exercise default technique', () => {
        const workout: WorkoutSession = { exercises: [{ exId: 'hold', sessionNote: '', sets: [{
            id: 'a', kg: '20', reps: '', isometrics: [{ id: 'iso', kg: '20', time: '30' }],
        }] }] };
        expect(routineFromWorkout(workout, 'r-iso', 'Isometria').exercises).toEqual([
            { exId: 'hold', setsCount: 1, defaultTechnique: 'isometrics' },
        ]);
    });

    it('does not invent an advanced plan for mixed techniques', () => {
        const workout: WorkoutSession = { exercises: [{ exId: 'mixed', sessionNote: '', sets: [{
            id: 'a', kg: '60', reps: '8', technique: 'rest_pause', segments: [
                { id: 's1', kg: '50', reps: '4', technique: 'rest_pause' },
                { id: 's2', kg: '40', reps: '2', technique: 'dropset' },
            ],
        }] }] };
        expect(routineFromWorkout(workout, 'r-mixed', 'Mista').exercises).toEqual([
            { exId: 'mixed', setsCount: 1, minReps: 8, maxReps: 8 },
        ]);
    });

    it('preserves representable advanced set plans in their original order', () => {
        const workout: WorkoutSession = { exercises: [{ exId: 'press', sessionNote: '', sets: [
            { id: 'a', kg: '70', reps: '8', technique: 'rest_pause', segments: [
                { id: 'extra', kg: '70', reps: '3', technique: 'rest_pause', restBeforeSeconds: 25 },
            ] },
            { id: 'b', kg: '80', reps: '6' },
        ] }] };
        expect(routineFromWorkout(workout, 'r-plan', 'Piano').exercises).toEqual([
            { exId: 'press', setsCount: 2, minReps: 6, maxReps: 8, setPlans: [
                { technique: 'rest_pause', segmentCount: 2, restSeconds: 25 },
                { technique: 'straight' },
            ] },
        ]);
    });
});
