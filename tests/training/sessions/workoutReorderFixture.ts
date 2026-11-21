import { captureSession } from '../../../src/lib/sync/session';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { useAppStore } from '../../../src/store/useAppStore';
import { createDefaultNutritionPlanning } from '../../../src/lib/nutritionDefaults';
import type { ExerciseLibraryItem } from '../../../src/types';

export const mockLibrary: ExerciseLibraryItem[] = [
    {
        id: 'ex_bench',
        name: 'Panca piana con bilanciere',
        muscles: ['chest_upper', 'chest_lower'],
        secondaryMuscles: ['triceps', 'delts_front'],
        notes: 'Gomiti a 45 gradi',
        trackingType: 'weight_reps',
        setsCount: 3,
        sets: []
    },
    {
        id: 'ex_squat',
        name: 'Squat con bilanciere',
        muscles: ['quads', 'glutes'],
        secondaryMuscles: ['hamstrings', 'core'],
        notes: 'Accosciata profonda',
        trackingType: 'weight_reps',
        setsCount: 4,
        sets: []
    },
    {
        id: 'ex_pullup',
        name: 'Trazioni alla sbarra',
        muscles: ['back', 'lats'],
        secondaryMuscles: ['biceps'],
        notes: 'Presa prona',
        trackingType: 'weight_reps',
        setsCount: 3,
        sets: []
    }
];

export async function installWorkoutReorderFixture() {
        localStorage.clear();
        useAppStore.getState().resetStore();
        const owner = captureSession().owner;
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        useAppStore.setState({
            dataOwner: captureSession().owner,
            userData: {
                profile: {},
                library: mockLibrary,
                routines: [
                    {
                        id: 'rot_1',
                        name: 'Scheda A',
                        exercises: [
                            { exId: 'ex_bench', setsCount: 3 },
                            { exId: 'ex_squat', setsCount: 4 }
                        ]
                    }
                ],
                trainingCycles: [],
                customFoods: [],
                supplements: [],
                history: [],
                nutrition: {},
                nutritionPlanning: createDefaultNutritionPlanning(),
                activeWorkout: null,
                activeCycleId: null
            },
            localWorkout: null,
            syncing: false,
            saveError: null
        });
}
