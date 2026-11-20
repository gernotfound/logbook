import { vi } from 'vitest';
import { captureSession } from '../../../src/lib/sync/session';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { useAppStore } from '../../../src/store/useAppStore';
import { emptyUserData } from '../../setup';
import type { Exercise } from '../../../src/types';

export const mockLibrary: Exercise[] = [
        { id: 'ex_bench', name: 'Panca Piana', setsCount: 3, sets: [], trackingType: 'weight_reps' },
        { id: 'ex_plank', name: 'Plank', setsCount: 3, sets: [], trackingType: 'time' },
        { id: 'ex_treadmill', name: 'Tapis Roulant', setsCount: 1, sets: [], trackingType: 'cardio' }
    ];

export async function setupTrainingSessionUiFixture() {
        vi.clearAllMocks();
        localStorage.clear();
        const owner = captureSession().owner;
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        useAppStore.setState({
            userData: {
                ...emptyUserData,
                library: mockLibrary,
                routines: [
                    {
                        id: 'routine_1',
                        name: 'Scheda Petto',
                        exercises: [{ exId: 'ex_bench', setsCount: 3 }]
                    }
                ]
            },
            localWorkout: null,
            syncing: false,
            saveError: null
        });
}
