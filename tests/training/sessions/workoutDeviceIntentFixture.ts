import { vi } from 'vitest';
import { update as idbUpdate } from 'idb-keyval';
import { UserDataSchema } from '../../../src/lib/schema';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import type { UserData, WorkoutSession } from '../../../src/types';

export const workout = (kg: string): WorkoutSession => ({
    id: 'device-intent-w1', date: '2026-10-14', routineName: 'Allenamento',
    exercises: [{ id: 'se1', exId: 'bench', sessionNote: '', sets: [{ id: 's1', kg, reps: '8' }] }],
});
export const data = (activeWorkout: WorkoutSession | null) => UserDataSchema.parse({ activeWorkout }) as unknown as UserData;
export const owner = 'user:test-user-id';

export async function prepareAccountWorkoutArchive(account: string): Promise<void> {
    if (account.startsWith('user:') && localStorage.getItem(`logbook:v2:${account}:health-consent-generation`) === null) {
        localStorage.setItem(`logbook:v2:${account}:health-consent-generation`, '1');
    }
    await prepareUnlockedTestArchive(account);
}


// Inject at the storage boundary rather than relying on how often recovery
// calls its session guard. The production transformation stays synchronous.
export function injectAtArchiveUpdate(account: string, phase: 'before-transform' | 'after-commit', inject: () => void) {
    const original = vi.mocked(idbUpdate).getMockImplementation()!;
    let injected = false;
    vi.mocked(idbUpdate).mockImplementation(async (key, transform, store) => {
        await original(key, value => {
            if (!injected && key === 'logbook:v2:' + account && phase === 'before-transform') {
                injected = true;
                inject();
            }
            return transform(value);
        }, store);
        if (!injected && key === 'logbook:v2:' + account && phase === 'after-commit') {
            injected = true;
            inject();
        }
    });
    return {
        didInject: () => injected,
        restore: () => { vi.mocked(idbUpdate).mockImplementation(original); },
    };
}
