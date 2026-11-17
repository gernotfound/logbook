import { beforeEach, describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData, WorkoutSession } from '../../../src/types';
import { useAppStore } from '../../../src/store/useAppStore';
import { getInitialLocalWorkout } from '../../../src/store/slices/createWorkoutSlice';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { unwrapWorkoutDeviceSnapshot } from '../../../src/lib/sync/workoutDeviceIntent';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { storageOwner } from '../../../src/lib/sync/session';

const parse = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;

function workout(id: string, exerciseIds: Array<[string, string]> = []): WorkoutSession {
    return {
        id,
        date: '2026-10-03',
        exercises: exerciseIds.map(([instanceId, exId], index) => ({
            id: instanceId,
            exId,
            sessionNote: '',
            sets: [{ id: `s-${index}`, kg: '10', reps: '10' }],
        })),
    };
}

describe('Device workout recovery and local-only state', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('restores the device workout from a validated fallback into sealed storage when the device copy is missing', async () => {
        const owner = 'user:recovery';
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        const durable = workout('w-recovered', [['se-1', 'bench']]);
        const sealedKey = protectedDeviceKey('workout', owner);
        expect(readDeviceValueStrict('workout', owner)).toBeNull();

        const recovered = getInitialLocalWorkout(owner, durable);

        expect(recovered?.id).toBe('w-recovered');
        expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
        const saved = unwrapWorkoutDeviceSnapshot(JSON.parse(readDeviceValueStrict('workout', owner)!), owner).workout;
        expect(saved).toMatchObject({ id: 'w-recovered' });
        expect(getInitialLocalWorkout(owner)?.id).toBe('w-recovered');
    });

    it('keeps setLocalWorkout strictly device-local and leaves cloud-facing UserData untouched', async () => {
        const owner = storageOwner();
        if (owner.startsWith('user:')) {
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        }
        await prepareUnlockedTestArchive(owner);
        const live = workout('live');
        const historical = { ...workout('history'), isEditingHistory: true };
        useAppStore.setState({
            dataOwner: storageOwner(),
            userData: parse({ activeWorkout: live }),
            localWorkout: live,
            localPersistenceBlocked: false,
        });

        useAppStore.getState().setLocalWorkout(historical);

        expect(useAppStore.getState().localWorkout?.id).toBe('history');
        expect(useAppStore.getState().userData?.activeWorkout?.id).toBe('live');
    });
});
