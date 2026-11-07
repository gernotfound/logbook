import { describe, expect, it } from 'vitest';
import type { Exercise, TrainingCycle, WorkoutRoutine } from '../../../types';
import { calculateCycleMacroVolume } from './cycleMacroVolume';

describe('cycle macro volume - canonical muscle IDs', () => {
    it('classifies lateral triceps as arms, lats as back and lumbar muscles as core', () => {
        const routines: WorkoutRoutine[] = [{
            id: 'upper',
            name: 'Parte superiore',
            exercises: [
                { exId: 'triceps', setsCount: 3 },
                { exId: 'lats', setsCount: 4 },
                { exId: 'shoulders', setsCount: 2 },
                { exId: 'lumbar', setsCount: 2 },
            ],
        }];
        const library: Exercise[] = [
            { id: 'triceps', name: 'Tricipiti', muscles: ['triceps_lateral'], setsCount: 3, sets: [] },
            { id: 'lats', name: 'Dorsali', muscles: ['lats_right'], setsCount: 4, sets: [] },
            { id: 'shoulders', name: 'Spalle', muscles: ['delts_side'], setsCount: 2, sets: [] },
            { id: 'lumbar', name: 'Lombari', muscles: ['lower_back'], setsCount: 2, sets: [] },
        ];
        const cycle: TrainingCycle = {
            id: 'cycle',
            name: 'Test',
            durationWeeks: 4,
            sessionsPerWeek: 1,
            routines: [{ routineId: 'upper', frequencyPerWeek: 1 }],
        };

        const result = calculateCycleMacroVolume(cycle, routines, library);
        expect(result.find(item => item.key === 'arms')?.sets).toBe(3);
        expect(result.find(item => item.key === 'back')?.sets).toBe(4);
        expect(result.find(item => item.key === 'shoulders')?.sets).toBe(2);
        expect(result.find(item => item.key === 'core')?.sets).toBe(2);
        expect(result).toHaveLength(4);
    });
});
