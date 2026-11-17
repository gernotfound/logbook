import { describe, expect, it } from 'vitest';
import type { Exercise, TrainingCycle, WorkoutRoutine } from '../../../types';
import { MUSCLES } from '../../../lib/constants/muscles';
import { calculateCycleMacroVolume } from './cycleMacroVolume';

describe('cycle macro volume - canonical muscle IDs', () => {
    it('classifies canonical arm, hip-abductor, back and core muscle IDs', () => {
        const routines: WorkoutRoutine[] = [{
            id: 'upper',
            name: 'Parte superiore',
            exercises: [
                { exId: 'triceps', setsCount: 3 },
                { exId: 'lats', setsCount: 4 },
                { exId: 'shoulders', setsCount: 2 },
                { exId: 'lumbar', setsCount: 2 },
                { exId: 'hand-flexors', setsCount: 2 },
                { exId: 'abductors', setsCount: 3 },
            ],
        }];
        const library: Exercise[] = [
            { id: 'triceps', name: 'Tricipiti', muscles: ['triceps_lateral'], setsCount: 3, sets: [] },
            { id: 'lats', name: 'Dorsali', muscles: ['lats_right'], setsCount: 4, sets: [] },
            { id: 'shoulders', name: 'Spalle', muscles: ['delts_side'], setsCount: 2, sets: [] },
            { id: 'lumbar', name: 'Lombari', muscles: ['lower_back'], setsCount: 2, sets: [] },
            { id: 'hand-flexors', name: 'Flessori della mano', muscles: ['hand_flexors_right'], setsCount: 2, sets: [] },
            { id: 'abductors', name: 'Abduttori', muscles: ['abductors_left'], setsCount: 3, sets: [] },
        ];
        const cycle: TrainingCycle = {
            id: 'cycle',
            name: 'Test',
            durationWeeks: 4,
            sessionsPerWeek: 1,
            routines: [{ routineId: 'upper', frequencyPerWeek: 1 }],
        };

        const result = calculateCycleMacroVolume(cycle, routines, library);
        expect(result.find(item => item.key === 'arms')?.sets).toBe(5);
        expect(result.find(item => item.key === 'back')?.sets).toBe(4);
        expect(result.find(item => item.key === 'shoulders')?.sets).toBe(2);
        expect(result.find(item => item.key === 'core')?.sets).toBe(2);
        expect(result.find(item => item.key === 'glutes')?.sets).toBe(3);
        expect(result.find(item => item.key === 'other')).toBeUndefined();
        expect(result).toHaveLength(5);
    });
    it('maps every current canonical muscle ID to a named macroarea', () => {
        const cycle: TrainingCycle = {
            id: 'catalog-cycle', name: 'Catalogo muscolare',
            durationWeeks: 4, sessionsPerWeek: 1,
            routines: [{ routineId: 'catalog-routine', frequencyPerWeek: 1 }],
        };
        const unclassified = MUSCLES.filter(({ id, name }) => {
            const routines: WorkoutRoutine[] = [{
                id: 'catalog-routine', name: 'Catalogo',
                exercises: [{ exId: id, setsCount: 1 }],
            }];
            const library: Exercise[] = [{
                id, name, muscles: [id], setsCount: 1, sets: [],
            }];
            const result = calculateCycleMacroVolume(cycle, routines, library);
            return result.length !== 1 || result[0].key === 'other' || result[0].sets !== 1;
        }).map(muscle => muscle.id);

        expect(unclassified).toEqual([]);
        const generalLegs: Exercise[] = [{
            id: 'general-legs', name: 'Gambe (generale)',
            muscles: ['legs_general'], setsCount: 1, sets: [],
        }];
        const legsRoutine: WorkoutRoutine[] = [{
            id: 'catalog-routine', name: 'Catalogo',
            exercises: [{ exId: 'general-legs', setsCount: 1 }],
        }];
        expect(calculateCycleMacroVolume(cycle, legsRoutine, generalLegs)).toEqual([
            { key: 'legs', label: 'Gambe (generale)', sets: 1 },
        ]);
    });

    it('counts each macroarea once per exercise while keeping independent areas and weekly totals', () => {
        const cycle: TrainingCycle = {
            id: 'mixed-cycle', name: 'Volume misto',
            durationWeeks: 4, sessionsPerWeek: 1,
            routines: [{ routineId: 'mixed', frequencyPerWeek: 1 }],
        };
        const routines: WorkoutRoutine[] = [{
            id: 'mixed', name: 'Mista',
            exercises: [
                { exId: 'press', setsCount: 3 },
                { exId: 'pull', setsCount: 2 },
            ],
        }];
        const library: Exercise[] = [
            {
                id: 'press', name: 'Spinta',
                muscles: ['biceps_long_left', 'triceps_lateral', 'chest_upper'],
                setsCount: 3, sets: [],
            },
            {
                id: 'pull', name: 'Trazione',
                muscles: ['hand_flexors_right', 'lats_right', 'rhomboids'],
                setsCount: 2, sets: [],
            },
        ];
        const original = structuredClone({ cycle, routines, library });

        expect(calculateCycleMacroVolume(cycle, routines, library)).toEqual([
            { key: 'arms', label: 'Braccia', sets: 5 },
            { key: 'chest', label: 'Petto', sets: 3 },
            { key: 'back', label: 'Dorso', sets: 2 },
        ]);
        expect({ cycle, routines, library }).toEqual(original);
    });
});
