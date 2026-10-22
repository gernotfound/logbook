import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyUserData } from './setup';
import { clear } from 'idb-keyval';
import type { UserData } from '../src/types';

const authState = vi.hoisted(() => ({
    currentUser: { uid: 'user-a' } as { uid: string } | null,
}));

const dbState = vi.hoisted(() => ({
    loadCloudPayload: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
    current: { userData: { profile: { height: '170' } } as UserData | null, localWorkout: null as any, localPersistenceBlocked: false },
}));

vi.mock('../src/lib/firebase', () => ({
    auth: authState,
}));

vi.mock('../src/lib/db', () => ({
    DB: {
        loadCloudPayload: dbState.loadCloudPayload,
    },
}));

vi.mock('../src/lib/sync/replicaProtocol', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/lib/sync/replicaProtocol')>();
    return { ...actual, needsReplicaCheckpoint: () => false };
});

vi.mock('../src/store/useAppStore', () => ({
    useAppStore: {
        getState: () => storeState.current,
        setState: (patch: any) => {
            storeState.current = {
                ...storeState.current,
                ...(typeof patch === 'function' ? patch(storeState.current) : patch),
            };
        },
    },
}));

function data(height: string): UserData {
    return {
        ...structuredClone(emptyUserData),
        profile: { ...emptyUserData.profile, height },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

function payload(height: string) {
    return {
        data: data(height),
        completeMonths: [],
        cloudDocuments: new Map(),
    };
}

async function loadModules() {
    vi.resetModules();
    const [{ loadAuthenticatedData }, { readLocal, initializeLocal, commitDomainOperations }, { invalidateSession }] = await Promise.all([
        import('../src/contexts/auth/loadAuthenticatedData'),
        import('../src/lib/sync/localRepository'),
        import('../src/lib/sync/session'),
    ]);
    return { loadAuthenticatedData, readLocal, initializeLocal, commitDomainOperations, invalidateSession };
}

describe('authenticated hydration session fencing', () => {
    beforeEach(() => {
        localStorage.clear();
        authState.currentUser = { uid: 'user-a' };
        storeState.current = {
            userData: { profile: { height: '170' } } as UserData,
            localWorkout: null,
            localPersistenceBlocked: false,
        };
        dbState.loadCloudPayload.mockReset();
    });

    it('rejects a stale workout when an owner envelope appears during an offline cloud-load failure', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, initializeLocal, commitDomainOperations, invalidateSession } = await loadModules();
        invalidateSession();
        storeState.current = { userData: null, localWorkout: null, localPersistenceBlocked: false };
        const oldWorkout = { id: 'closed-during-cloud-load', date: '2026-10-09', exercises: [] };
        const deviceKey = 'logbook:v2:user:user-a:workout';
        localStorage.setItem(deviceKey, JSON.stringify(oldWorkout));

        const initial = data('170');
        dbState.loadCloudPayload.mockImplementationOnce(async () => {
            // Another tab initialized and closed the session after the first readLocal.
            await initializeLocal('user:user-a', initial);
            await commitDomainOperations('user:user-a', {
                type: 'active-workout.set', workout: null, deletedWorkoutId: oldWorkout.id,
            }, initial);
            throw Object.assign(new Error('Cloud unavailable'), { code: 'unavailable' });
        });
        await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: vi.fn(),
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        expect((await readLocal('user:user-a'))?.closedWorkoutIds).toContain(oldWorkout.id);
        expect(storeState.current.localWorkout).toBeNull();
        expect(localStorage.getItem(deviceKey)).toBeNull();
        await clear();
    });

    it('installs a durable fence when a cloud month fails strict integrity validation', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, initializeLocal, invalidateSession } = await loadModules();
        const { IncompleteCloudMonthError, requireCompleteHistoryMonthDocument } =
            await import('../src/lib/sync/monthlyIntegrity');
        invalidateSession();
        const local = data('170');
        await initializeLocal('user:user-a', local);
        let invalidMonthError: unknown;
        try { requireCompleteHistoryMonthDocument('2026-09', { malformed: {} }); }
        catch (error) { invalidMonthError = error; }
        expect(invalidMonthError).toBeInstanceOf(IncompleteCloudMonthError);
        dbState.loadCloudPayload.mockRejectedValueOnce(invalidMonthError);
        const setSaveError = vi.fn();

        const result = await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: vi.fn(),
            setSyncing: vi.fn(),
            setSaveError,
        });

        const preserved = await readLocal('user:user-a');
        expect(result).toBe('blocked');
        expect(preserved?.data.profile?.height).toBe('170');
        expect(preserved?.cloudIntegrityFence).toEqual(expect.any(String));
        expect('cloudIntegrityBlocked' in storeState.current && storeState.current.cloudIntegrityBlocked).toBe(true);
        expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('sincronizzazione sospesa'));
        await clear();
    });

    it('does not create an empty account journal when a cloud read fails without a local envelope', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        storeState.current = { userData: null, localWorkout: null, localPersistenceBlocked: false };
        dbState.loadCloudPayload.mockRejectedValueOnce(Object.assign(new Error('Cloud unavailable'), { code: 'unavailable' }));
        const setUserData = vi.fn();
        const setSaveError = vi.fn();
        const options = {
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData,
            setSyncing: vi.fn(),
            setSaveError,
        };

        expect(await loadAuthenticatedData(options)).toBe('blocked');
        expect(setUserData).not.toHaveBeenCalled();
        expect((await readLocal('user:user-a'))).toBeUndefined();
        expect(storeState.current.userData).toBeNull();
        expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('nessun archivio locale'));

        // The failure is retryable: a later verified server read still hydrates
        // this same account normally, without any fabricated local baseline.
        dbState.loadCloudPayload.mockResolvedValueOnce(payload('185'));
        expect(await loadAuthenticatedData(options)).toBe('ready');
        expect(storeState.current.userData?.profile?.height).toBe('185');
        expect((await readLocal('user:user-a'))?.data.profile?.height).toBe('185');
        expect(setUserData).not.toHaveBeenCalled();
        await clear();
    });

    it('does not publish or persist A when the session changes before cloud data arrives', async () => {
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        const firstPayload = deferred<ReturnType<typeof payload>>();
        dbState.loadCloudPayload.mockReturnValueOnce(firstPayload.promise);
        const setUserData = vi.fn();
        const setSyncing = vi.fn();
        const setSaveError = vi.fn();

        const loadPromise = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData,
            setSyncing,
            setSaveError,
        });

        await vi.waitFor(() => expect(dbState.loadCloudPayload).toHaveBeenCalledTimes(1));
        authState.currentUser = { uid: 'user-b' };
        invalidateSession();
        firstPayload.resolve(payload('171'));
        await loadPromise;

        expect(await readLocal('user-a')).toBeUndefined();
        expect(setUserData).not.toHaveBeenCalled();
        expect(setSaveError).not.toHaveBeenCalled();
        expect(setSyncing).not.toHaveBeenCalledWith(false);
    });

    it('does not resurrect an older A load after A to B to A', async () => {
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        const firstPayload = deferred<ReturnType<typeof payload>>();
        dbState.loadCloudPayload
            .mockReturnValueOnce(firstPayload.promise)
            .mockResolvedValueOnce(payload('182'));
        const firstSetUserData = vi.fn();
        const secondSetUserData = vi.fn();

        const firstLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: firstSetUserData,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await vi.waitFor(() => expect(dbState.loadCloudPayload).toHaveBeenCalledTimes(1));

        authState.currentUser = { uid: 'user-b' };
        invalidateSession();
        authState.currentUser = { uid: 'user-a' };
        invalidateSession();

        const secondLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: secondSetUserData,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await secondLoad;

        expect((await readLocal('user-a'))?.data.profile?.height).toBe('182');
        // The cloud snapshot is already durably committed by hydrateLocal:
        // exposing it through the user-edit writer would spawn duplicate
        // SemanticOperations. The authenticated view must update directly.
        expect(storeState.current.userData?.profile?.height).toBe('182');
        expect(secondSetUserData).not.toHaveBeenCalled();

        firstPayload.resolve(payload('171'));
        await firstLoad;

        expect((await readLocal('user-a'))?.data.profile?.height).toBe('182');
        expect(firstSetUserData).not.toHaveBeenCalled();
    });

    it('lets the newest same-account load supersede an older overlapping load', async () => {
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        const firstPayload = deferred<ReturnType<typeof payload>>();
        dbState.loadCloudPayload
            .mockReturnValueOnce(firstPayload.promise)
            .mockResolvedValueOnce(payload('183'));
        const firstSetUserData = vi.fn();
        const secondSetUserData = vi.fn();

        const firstLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: firstSetUserData,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await vi.waitFor(() => expect(dbState.loadCloudPayload).toHaveBeenCalledTimes(1));

        const secondLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: secondSetUserData,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await secondLoad;

        expect((await readLocal('user-a'))?.data.profile?.height).toBe('183');
        // The cloud snapshot is already durably committed by hydrateLocal:
        // exposing it through the user-edit writer would spawn duplicate
        // SemanticOperations. The authenticated view must update directly.
        expect(storeState.current.userData?.profile?.height).toBe('183');
        expect(secondSetUserData).not.toHaveBeenCalled();

        firstPayload.resolve(payload('171'));
        await firstLoad;

        expect((await readLocal('user-a'))?.data.profile?.height).toBe('183');
        expect(firstSetUserData).not.toHaveBeenCalled();
    });

    it('does not overwrite an unsaved UI draft with an older readable owner envelope', async () => {
        await clear();
        const { loadAuthenticatedData, initializeLocal, invalidateSession } = await loadModules();
        invalidateSession();
        await initializeLocal('user:user-a', data('170'));
        storeState.current = { userData: data('199'), localWorkout: null, localPersistenceBlocked: true };
        const setSyncing = vi.fn();
        await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: vi.fn(),
            setSyncing,
            setSaveError: vi.fn(),
        });
        expect(storeState.current.userData?.profile?.height).toBe('199');
        expect(storeState.current.localPersistenceBlocked).toBe(true);
        expect(dbState.loadCloudPayload).not.toHaveBeenCalled();
        expect(setSyncing).not.toHaveBeenCalled();
        await clear();
    });

});
