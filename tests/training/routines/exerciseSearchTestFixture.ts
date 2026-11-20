import { afterEach, beforeEach, vi } from 'vitest';
import { captureSession } from '../../../src/lib/sync/session';
import type { ExerciseLibraryItem } from '../../../src/types';
import { useAppStore } from '../../../src/store/useAppStore';

export const mockLibrary: ExerciseLibraryItem[] = [
    {
        id: 'ex_bench',
        name: 'Panca Piana Bilanciere',
        setsCount: 3,
        muscles: ['chest_upper', 'chest_lower'],
        secondaryMuscles: ['triceps', 'delts_front'],
        notes: 'Presa media con gomiti a 45 gradi',
        trackingType: 'weight_reps',
        sets: []
    },
    {
        id: 'ex_incline',
        name: 'Panca Inclinata Manubri',
        setsCount: 3,
        muscles: ['chest_upper'],
        secondaryMuscles: ['delts_front', 'triceps'],
        notes: 'Inclinazione panca 30 gradi',
        trackingType: 'weight_reps',
        sets: []
    },
    {
        id: 'ex_squat',
        name: 'Squat con Bilanciere',
        setsCount: 4,
        muscles: ['quads', 'glutes'],
        secondaryMuscles: ['hamstrings', 'core'],
        notes: 'Scosciata completa sotto il parallelo',
        trackingType: 'weight_reps',
        sets: []
    },
    {
        id: 'ex_pullup',
        name: 'Trazioni alla Sbarra',
        setsCount: 3,
        muscles: ['back', 'lats'],
        secondaryMuscles: ['biceps', 'forearms'],
        notes: 'Presa prona larga',
        trackingType: 'weight_reps',
        sets: []
    },
    {
        id: 'ex_treadmill',
        name: 'Corsa sul Tapis Roulant',
        setsCount: 1,
        muscles: ['quads', 'calves'],
        secondaryMuscles: ['glutes'],
        notes: 'Riscaldamento cardio',
        trackingType: 'cardio',
        sets: []
    },
    {
        id: 'ex_plank',
        name: 'Plank Isometrico',
        setsCount: 3,
        muscles: ['abs', 'core'],
        secondaryMuscles: ['glutes'],
        notes: 'Tenuta addominale isometrica',
        trackingType: 'time',
        sets: []
    }
];

beforeEach(async () => {
    window.localStorage.clear();
    localStorage.setItem('logbook:v2:user:test-user-id:health-consent-generation', '1');
    useAppStore.getState().resetStore();
    vi.clearAllMocks();

    useAppStore.setState({
        dataOwner: captureSession().owner,
        userData: {
            profile: {} as any,
            library: mockLibrary as any,
            routines: [
                {
                    id: 'rot_push',
                    name: 'Scheda Spinta Base',
                    exercises: [{ exId: 'ex_bench', setsCount: 3 }]
                }
            ],
            trainingCycles: [],
            customFoods: [],
            supplements: [],
            history: [],
            nutrition: {},
            nutritionPlanning: {} as any,
            activeWorkout: null,
            activeCycleId: null
        },
        localWorkout: null
    });
});

afterEach(() => {
    window.localStorage.clear();
    useAppStore.getState().resetStore();
    vi.restoreAllMocks();
});
