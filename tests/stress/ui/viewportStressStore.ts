import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';

export function seedViewportStressStore() {
        useAppStore.setState({
            dataOwner: captureSession().owner,
            userData: {
                profile: { height: 180, gender: 'M' },
                nutrition: {
                    '2026-08-25': {
                        date: '2026-08-25',
                        weight: 78.5,
                        waist: 82,
                        neck: 38,
                        kcal: 2300,
                        carbs: 260,
                        pro: 165,
                        fat: 65,
                        meals: []
                    }
                },
                history: [],
                library: [
                    { id: 'ex1', name: 'Panca piana', trackingType: 'weight_reps', muscles: ['petto'], secondaryMuscles: [], setsCount: 3, sets: [] }
                ],
                routines: [
                    { id: 'r1', name: 'Spinta A', exercises: [{ exId: 'ex1', setsCount: 3 }] }
                ],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null,
                activeWorkout: null,
                supplements: []
            } as any
        });
}
