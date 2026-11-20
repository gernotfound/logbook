import { describe, it, expect } from 'vitest';
import { calculateCycleVolume, getDetailedMuscleCategory } from '../../../src/lib/calc/planning';
import type { TrainingCycle, WorkoutRoutine, Exercise } from '../../../src/types';
import { createTrainingPlanningFixtures } from './trainingPlanningFixtures';

describe('Training Planning & Volume Calculations', () => {
    const { mockLibrary, mockRoutines } = createTrainingPlanningFixtures();

    it('getDetailedMuscleCategory correctly classifies muscles', () => {
        expect(getDetailedMuscleCategory('chest').label).toBe('Petto');
        expect(getDetailedMuscleCategory('lats').label).toBe('Dorso');
        expect(getDetailedMuscleCategory('traps').label).toBe('Trapezi');
        expect(getDetailedMuscleCategory('delts_side').label).toBe('Spalle');
        expect(getDetailedMuscleCategory('quads').label).toBe('Quadricipiti');
        expect(getDetailedMuscleCategory('biceps').label).toBe('Bicipiti');
        expect(getDetailedMuscleCategory('triceps_lateral').label).toBe('Tricipiti');
        expect(getDetailedMuscleCategory('lats_upper_right').label).toBe('Dorso');
        expect(getDetailedMuscleCategory('lower_back').label).toBe('Addome e Core');
        expect(getDetailedMuscleCategory('hand_flexors_right').label).toBe('Avambracci');
        expect(getDetailedMuscleCategory('unknown_xyz').label).toBe('Altro');
    });

    it('calculateCycleVolume returns 0 for empty or invalid cycle', () => {
        const result = calculateCycleVolume(null, mockRoutines, mockLibrary);
        expect(result.totalWorkoutsPerWeek).toBe(0);
        expect(result.totalSetsPerWeek).toBe(0);
        expect(result.muscleVolumes).toEqual([]);
        expect(result.highlightedMuscles).toEqual([]);
    });

    it('does not inflate heatmap intensity when a primary muscle ID is repeated', () => {
        const cycle: TrainingCycle = {
            id: 'dup-muscle-cycle',
            name: 'Volume e mappa coerenti',
            durationWeeks: 4,
            sessionsPerWeek: 1,
            routines: [{ routineId: 'dup-muscle-routine', frequencyPerWeek: 1 }],
        };
        const routines: WorkoutRoutine[] = [{
            id: 'dup-muscle-routine',
            name: 'Volume',
            exercises: [{ exId: 'bench', setsCount: 2 }, { exId: 'row', setsCount: 5 }],
        }];
        const canonical: Exercise[] = [
            { id: 'bench', name: 'Panca', setsCount: 2, sets: [], muscles: ['chest'] },
            { id: 'row', name: 'Rematore', setsCount: 5, sets: [], muscles: ['lats'] },
        ];
        const withDuplicate = canonical.map(item => item.id === 'bench'
            ? { ...item, muscles: ['chest', 'chest'] } : item);

        const expected = calculateCycleVolume(cycle, routines, canonical);
        const repeated = calculateCycleVolume(cycle, routines, withDuplicate);
        expect(expected.muscleVolumes.find(item => item.key === 'chest')?.sets).toBe(2);
        expect(expected.muscleColors.chest).toBe('#38bdf8');
        expect(expected.muscleColors.lats).toBe('#0ea5e9');
        expect(repeated).toEqual(expected);
    });

    it('keeps overlapping anatomical paths independent of routine exercise order', () => {
        const cycle: TrainingCycle = {
            id: 'overlap-cycle',
            name: 'Regioni sovrapposte',
            durationWeeks: 4,
            sessionsPerWeek: 1,
            routines: [{ routineId: 'overlap-routine', frequencyPerWeek: 1 }],
        };
        const library: Exercise[] = [
            { id: 'broad', name: 'Petto intero', setsCount: 6, sets: [], muscles: ['chest'] },
            { id: 'narrow', name: 'Petto alto', setsCount: 2, sets: [], muscles: ['chest_upper'] },
        ];
        const exercises = [
            { exId: 'broad', setsCount: 6 },
            { exId: 'narrow', setsCount: 2 },
        ];
        const compute = (items: WorkoutRoutine['exercises']) => calculateCycleVolume(
            cycle,
            [{ id: 'overlap-routine', name: 'Scheda', exercises: items }],
            library,
        );

        const broadFirst = compute(exercises);
        const narrowFirst = compute([...exercises].reverse());
        expect(broadFirst.totalSetsPerWeek).toBe(8);
        expect(broadFirst.muscleColors['chest-upper-left']).toBe('#0ea5e9');
        expect(broadFirst.muscleColors['chest-lower-left']).toBe('#0ea5e9');
        expect(broadFirst.muscleColors.chest_upper).toBe('#7dd3fc');
        expect(narrowFirst.muscleColors).toEqual(broadFirst.muscleColors);
    });

    it('calculateCycleVolume gracefully handles deleted routines and exercises', () => {
        const cycleWithMissingRefs: TrainingCycle = {
            id: 'cycle_missing',
            name: 'Ciclo Test',
            durationWeeks: 4,
            routines: [
                { routineId: 'non_existent_routine', frequencyPerWeek: 3 },
                { routineId: 'r_push', frequencyPerWeek: 1 }
            ]
        };

        const result = calculateCycleVolume(cycleWithMissingRefs, mockRoutines, mockLibrary);
        // The missing routine still belongs to the planned four-session target,
        // but its lost sets are not reassigned to the remaining routine.
        expect(result.totalWorkoutsPerWeek).toBe(4);
        expect(result.totalSetsPerWeek).toBe(7); // 4 bench + 3 ohp

        // A deleted exercise must not contribute phantom sets to an existing routine.
        const withoutOhp = calculateCycleVolume(
            cycleWithMissingRefs,
            mockRoutines,
            mockLibrary.filter(exercise => exercise.id !== 'ex_ohp'),
        );
        expect(withoutOhp.totalWorkoutsPerWeek).toBe(4);
        expect(withoutOhp.totalSetsPerWeek).toBe(4);
        expect(withoutOhp.muscleVolumes.find(muscle => muscle.label === 'Petto')?.sets).toBe(4);
        expect(withoutOhp.muscleVolumes.find(muscle => muscle.label === 'Spalle')).toBeUndefined();
    });

    it('calculateCycleVolume correctly calculates weekly sets for multiple routines with frequencies', () => {
        const cycle: TrainingCycle = {
            id: 'cycle_1',
            name: 'Mesociclo 4x',
            durationWeeks: 6,
            routines: [
                { routineId: 'r_push', frequencyPerWeek: 2 }, // Push 2x/week: bench 4x2=8, ohp 3x2=6
                { routineId: 'r_pull', frequencyPerWeek: 1 }, // Pull 1x/week: lat 4x1=4, curl 3x1=3
                { routineId: 'r_legs', frequencyPerWeek: 1 }  // Legs 1x/week: squat 5x1=5
            ]
        };

        const result = calculateCycleVolume(cycle, mockRoutines, mockLibrary);

        // Total workouts: 2 + 1 + 1 = 4
        expect(result.totalWorkoutsPerWeek).toBe(4);
        // Total sets: (4+3)*2 + (4+3)*1 + 5*1 = 14 + 7 + 5 = 26
        expect(result.totalSetsPerWeek).toBe(26);

        // Muscle breakdown (primary muscles only)
        const petto = result.muscleVolumes.find(m => m.label === 'Petto');
        expect(petto?.sets).toBe(8);

        const spalle = result.muscleVolumes.find(m => m.label === 'Spalle');
        expect(spalle?.sets).toBe(6);

        const dorso = result.muscleVolumes.find(m => m.label === 'Dorso');
        expect(dorso?.sets).toBe(4);

        const quadricipiti = result.muscleVolumes.find(m => m.label === 'Quadricipiti');
        expect(quadricipiti?.sets).toBe(5);

        const bicipiti = result.muscleVolumes.find(m => m.label === 'Bicipiti');
        expect(bicipiti?.sets).toBe(3);

        // Highlighted muscles contain primary muscle keys
        expect(result.highlightedMuscles).toContain('chest');
        expect(result.highlightedMuscles).toContain('lats');
        expect(result.highlightedMuscles).toContain('quads');

        // Muscle colors generated for MuscleModel
        expect(Object.keys(result.muscleColors).length).toBeGreaterThan(0);
    });

});
