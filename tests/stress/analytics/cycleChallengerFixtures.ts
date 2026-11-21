import type { Exercise, WorkoutRoutine } from '../../../src/types';

export const sampleRoutines: WorkoutRoutine[] = [
    {
        id: 'r_push',
        name: 'Push A',
        exercises: [{ exId: 'ex_bench', setsCount: 4 }]
    },
    {
        id: 'r_pull',
        name: 'Pull B',
        exercises: [{ exId: 'ex_row', setsCount: 4 }]
    },
    {
        id: 'r_legs',
        name: 'Legs C',
        exercises: [{ exId: 'ex_squat', setsCount: 5 }]
    }
];

export const sampleLibrary: Exercise[] = [
    { id: 'ex_bench', name: 'Panca piana', setsCount: 4, muscles: ['chest', 'triceps'], sets: [] },
    { id: 'ex_row', name: 'Rematore bilanciere', setsCount: 4, muscles: ['back', 'biceps'], sets: [] },
    { id: 'ex_squat', name: 'Squat', setsCount: 5, muscles: ['quads', 'glutes'], sets: [] }
];
