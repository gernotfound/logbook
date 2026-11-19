import { beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { UserDataSchema } from '../../../src/lib/schema';
import type { WorkoutSession, UserData } from '../../../src/types';
import { captureSession } from '../../../src/lib/sync/session';
import { persistPlainWorkoutSnapshot } from '../../../src/lib/sync/workoutDeviceIntent';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import { localStorageMock } from '../../setup';
import { AuthContext, defaultAuthContext } from '../../../src/contexts/AuthContextDef';
import { auth } from '../../../src/lib/firebase';

export const renderOwnedWorkoutSession = () => render(
    <AuthContext.Provider value={{ ...defaultAuthContext, currentUser: auth.currentUser, isGuest: false }}>
        <TrainingSession />
    </AuthContext.Provider>,
);

export function workout(id: string, started = false): WorkoutSession & { id: string } {
    return {
        id, date: '2026-10-09', routineName: 'Workout',
        ...(started ? { globalStartTime: Date.now() - 60_000 } : {}),
        exercises: [{ id: 'se1', exId: 'bench', sessionNote: '',
            sets: [{ id: 's1', reps: '8', kg: '50' }] }],
    };
}
export function userData(data: Partial<UserData>): UserData {
    return UserDataSchema.parse(data) as unknown as UserData;
}

// These recovery cases simulate device copies written by the current account
// writer, not unsupported account snapshots from the pre-launch PWA.
export function seedCurrentDeviceWorkout(owner: string, snapshot: WorkoutSession): void {
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    if (owner.startsWith('user:') && localStorage.getItem(marker) === null) {
        localStorage.setItem(marker, '1');
    }
    persistPlainWorkoutSnapshot(snapshot, owner);
}

export function advanceConsentAfterGuardRead(marker: string, next: string) {
    const prior = localStorageMock.getItem.getMockImplementation();
    if (!prior) throw new Error('Storage test implementation missing');
    let advanced = false;
    localStorageMock.getItem.mockImplementation((key: string) => {
        const value = prior(key);
        if (key === marker && !advanced) {
            advanced = true;
            // Simulate another tab publishing consent immediately after our guard read.
            localStorage.setItem(marker, next);
        }
        return value;
    });
    return {
        advanced: () => advanced,
        restore: () => localStorageMock.getItem.mockImplementation(prior),
    };
}

export let owner: string;

export function installWorkoutLifecycleFixture() {
        beforeEach(() => {
            localStorage.clear();
            vi.clearAllMocks();
            // A failed case must not leave one-shot dialog outcomes for later tests.
            vi.mocked(useDialogStore.getState().showConfirm).mockReset().mockResolvedValue(true);
            vi.mocked(useDialogStore.getState().showAlert).mockReset().mockResolvedValue(undefined);
            owner = captureSession().owner;
            useAppStore.setState({
                userData: userData({}), dataOwner: owner, localWorkout: null,
                localPersistenceBlocked: false, syncHealth: 'synced',
                syncPresentation: 'normal', syncing: false, saveError: null,
                compatibilityStatus: 'ok',
            });
        });
        afterEach(() => vi.restoreAllMocks());
}
