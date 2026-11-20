import type { Exercise, WorkoutRoutine } from '../../../src/types';

export function createTrainingPlanningFixtures() {
    const mockLibrary: Exercise[] = [
        {
            id: 'ex_bench',
            name: 'Panca Piana Bilanciere',
            setsCount: 4,
            muscles: ['chest', 'chest_lower'],
            secondaryMuscles: ['triceps', 'delts_front'],
            sets: []
        },
        {
            id: 'ex_ohp',
            name: 'Military Press',
            setsCount: 3,
            muscles: ['delts_front', 'shoulders'],
            secondaryMuscles: ['triceps'],
            sets: []
        },
        {
            id: 'ex_lat',
            name: 'Lat Machine Avanti',
            setsCount: 4,
            muscles: ['lats', 'back'],
            secondaryMuscles: ['biceps'],
            sets: []
        },
        {
            id: 'ex_squat',
            name: 'Squat con Bilanciere',
            setsCount: 5,
            muscles: ['quads', 'legs_general'],
            secondaryMuscles: ['glutes', 'lower_back'],
            sets: []
        },
        {
            id: 'ex_curl',
            name: 'Curl Bicipiti con Manubri',
            setsCount: 3,
            muscles: ['biceps'],
            secondaryMuscles: ['forearms'],
            sets: []
        }
    ];

    const mockRoutines: WorkoutRoutine[] = [
        {
            id: 'r_push',
            name: 'Spinta (Push)',
            exercises: [
                { exId: 'ex_bench', setsCount: 4 },
                { exId: 'ex_ohp', setsCount: 3 }
            ]
        },
        {
            id: 'r_pull',
            name: 'Trazione (Pull)',
            exercises: [
                { exId: 'ex_lat', setsCount: 4 },
                { exId: 'ex_curl', setsCount: 3 }
            ]
        },
        {
            id: 'r_legs',
            name: 'Gambe (Legs)',
            exercises: [
                { exId: 'ex_squat', setsCount: 5 }
            ]
        }
    ];

    return { mockLibrary, mockRoutines };
}
