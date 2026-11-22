import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { update as idbUpdate } from 'idb-keyval';
import { DB } from '../../../src/lib/db';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { captureSession } from '../../../src/lib/sync/session';
import { readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { persistPlainWorkoutSnapshot } from '../../../src/lib/sync/workoutDeviceIntent';
import { UserDataSchema } from '../../../src/lib/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import type { UserData } from '../../../src/types';
import { emptyUserData, idbStore } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

const baseData = (): UserData => structuredClone({
    ...emptyUserData,
    profile: { ...emptyUserData.profile, height: '175' },
});

async function seedDurableState(data: UserData): Promise<string> {
    const owner = captureSession().owner;
    await prepareUnlockedTestArchive(owner);
    await initializeLocal(owner, data);
    expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
    useAppStore.setState({
        userData: data,
        dataOwner: owner,
        localWorkout: null,
        saveError: null,
        syncing: false,
        syncHealth: 'synced',
        syncGeneration: 0,
        localPersistenceBlocked: false,
        compatibilityStatus: 'ok',
        compatibilityError: null,
    });
    return owner;
}

describe('optimistic Zustand state vs local IndexedDB durability', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useAppStore.getState().resetStore({ force: true });
        vi.clearAllMocks();
    });

    afterEach(() => {
        useAppStore.getState().resetStore({ force: true });
        lockAllVaults();
        vi.useRealTimers();
    });

    it('validates bulk business data before altering a durable workout witness', async () => {
        const data = baseData();
        const owner = await seedDurableState(data);
        if (owner.startsWith('user:')) {
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        }
        const valid = UserDataSchema.parse({
            ...data,
            activeWorkout: {
                id: 'workout-bulk-validation', date: '2026-10-13',
                routineName: 'Test', exercises: [],
            },
        }) as unknown as UserData;
        expect(valid.activeWorkout?.id).toBe('workout-bulk-validation');

        // Prove this fixture can really persist a workout, so a failed schema
        // validation cannot pass the test merely because the archive is locked.
        persistPlainWorkoutSnapshot(valid.activeWorkout ?? null, owner);
        expect(readDeviceValueStrict('workout', owner)).not.toBeNull();
        persistPlainWorkoutSnapshot(null, owner);
        expect(readDeviceValueStrict('workout', owner)).toBeNull();

        const before = useAppStore.getState().userData;
        const malformed = {
            ...valid,
            profile: { ...valid.profile, height: { invalid: true } },
        } as unknown as UserData;
        expect(() => useAppStore.getState().setUserData(malformed)).toThrow();
        expect(readDeviceValueStrict('workout', owner)).toBeNull();
        expect(useAppStore.getState().localWorkout).toBeNull();
        expect(useAppStore.getState().userData).toBe(before);
        expect((await readLocal(owner))?.pending).toHaveLength(0);
    });

    it('reconciles optimistic business state back to the durable envelope when the local commit fails', async () => {
        const data = baseData();
        const owner = await seedDurableState(data);
        const localError = new Error('IndexedDB write failed');
        vi.mocked(idbUpdate).mockRejectedValueOnce(localError);
        const cloudSpy = vi.spyOn(DB, 'saveUserData');

        const result = useAppStore.getState().dispatchDomainOperation({
            type: 'profile.patch',
            patch: { height: '190' },
        });
        const rejected = expect(result).rejects.toThrow(localError.message);

        expect(useAppStore.getState().userData?.profile?.height).toBe('190');

        await vi.advanceTimersByTimeAsync(1100);
        await rejected;

        expect(cloudSpy).not.toHaveBeenCalled();
        expect(useAppStore.getState().userData?.profile?.height).toBe('175');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(useAppStore.getState().saveError).toBe(localError.message);

        const durable = await readLocal(owner);
        expect(durable?.data.profile?.height).toBe('175');
        expect(durable?.pending).toHaveLength(0);
    });

    it('blocks further mutations after an asynchronous snapshot save fails', async () => {
        const data = baseData();
        await seedDurableState(data);
        vi.mocked(idbUpdate).mockRejectedValueOnce(new Error('IndexedDB write failed'));

        useAppStore.getState().setUserData({ ...data, profile: { ...data.profile, height: '190' } });
        await vi.advanceTimersByTimeAsync(0);

        expect(useAppStore.getState().userData?.profile?.height).toBe('190');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        const volatileAfterFailure = useAppStore.getState().userData;
        useAppStore.getState().setUserData({ ...data, profile: { ...data.profile, height: '200' } });
        expect(useAppStore.getState().userData).toBe(volatileAfterFailure);
        await expect(useAppStore.getState().dispatchDomainOperation({
            type: 'profile.patch', patch: { height: '195' },
        })).rejects.toThrow('Archivio locale non leggibile');
    });

    it('fails closed and blocks later mutations when the durable envelope cannot be read after a local commit failure', async () => {
        const data = baseData();
        await seedDurableState(data);
        for (const key of Object.keys(idbStore)) delete idbStore[key];

        const localError = new Error('IndexedDB write failed');
        vi.mocked(idbUpdate).mockRejectedValueOnce(localError);
        const cloudSpy = vi.spyOn(DB, 'saveUserData');

        const first = useAppStore.getState().dispatchDomainOperation({
            type: 'profile.patch',
            patch: { height: '190' },
        });
        const firstRejected = expect(first).rejects.toThrow(localError.message);

        await vi.advanceTimersByTimeAsync(1100);
        await firstRejected;

        expect(cloudSpy).not.toHaveBeenCalled();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(useAppStore.getState().saveError).toContain('Archivio locale non leggibile');

        const volatileBeforeRetry = useAppStore.getState().userData;
        await expect(useAppStore.getState().dispatchDomainOperation({
            type: 'profile.patch',
            patch: { height: '195' },
        })).rejects.toThrow('Archivio locale non leggibile');
        expect(useAppStore.getState().userData).toBe(volatileBeforeRetry);
    });
});
