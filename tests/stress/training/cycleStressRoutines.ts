import type { WorkoutRoutine } from '../../../src/types';

export const mockRoutines: WorkoutRoutine[] = [
        {
            id: 'r_push',
            name: 'Push Routine A',
            exercises: [{ exId: 'ex_bench', setsCount: 4 }]
        },
        {
            id: 'r_pull',
            name: 'Pull Routine B',
            exercises: [{ exId: 'ex_lat', setsCount: 4 }]
        },
        {
            id: 'r_legs',
            name: 'Legs Routine C',
            exercises: [{ exId: 'ex_squat', setsCount: 5 }]
        }
    ];
