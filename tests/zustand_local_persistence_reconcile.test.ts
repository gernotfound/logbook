import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { update as idbUpdate } from 'idb-keyval';
import { DB } from '../src/lib/db';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { captureSession } from '../src/lib/sync/session';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';
import { emptyUserData, idbStore } from './setup';

const baseData = (): UserData => structuredClone({
    ...emptyUserData,
    profile: { ...emptyUserData.profile, height: '175' },
});

async function seedDurableState(data: UserData): Promise<string> {
    const owner = captureSession().owner;
    await initializeLocal(owner, data);
    useAppStore.setState({
        userData: data,
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
        vi.useRealTimers();
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
