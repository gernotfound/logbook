import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
    currentUser: { uid: 'user-a' } as { uid: string } | null,
}));

const sessionState = vi.hoisted(() => ({
    owner: 'user:user-a',
    epoch: 0,
}));

const hydrateState = vi.hoisted(() => ({
    hydrateLocal: vi.fn(),
}));

const dbState = vi.hoisted(() => ({
    loadCloudPayload: vi.fn(),
}));

vi.mock('../src/lib/firebase', () => ({
    auth: authState,
}));

vi.mock('../src/lib/db', () => ({
    DB: {
        loadCloudPayload: dbState.loadCloudPayload,
    },
}));

vi.mock('../src/lib/sync/session', () => ({
    captureSession: () => ({ owner: sessionState.owner, epoch: sessionState.epoch }),
    isCurrentSession: (session: { owner: string; epoch: number }) => (
        session.owner === sessionState.owner && session.epoch === sessionState.epoch
    ),
    userOwner: (uid: string) => `user:${uid}`,
}));

vi.mock('../src/lib/sync/localRepository', () => ({
    hydrateLocal: hydrateState.hydrateLocal,
}));

vi.mock('../src/store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({ userData: { profile: { name: 'existing' } } }),
    },
}));

vi.mock('../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: vi.fn(),
    getInMemoryCatalog: vi.fn(),
    isCatalogInMemory: () => true,
}));

vi.mock('../src/contexts/auth/defaultUserData', () => ({
    getResolvedDefaultUserData: vi.fn(),
}));

vi.mock('../src/lib/schema', () => ({
    UserDataSchema: { parse: (value: unknown) => value },
}));

import { loadAuthenticatedData } from '../src/contexts/auth/loadAuthenticatedData';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

function switchSession(uid: string): void {
    authState.currentUser = { uid };
    sessionState.owner = `user:${uid}`;
    sessionState.epoch += 1;
}

describe('authenticated hydration session fencing', () => {
    beforeEach(() => {
        localStorage.clear();
        authState.currentUser = { uid: 'user-a' };
        sessionState.owner = 'user:user-a';
        sessionState.epoch += 1;
        dbState.loadCloudPayload.mockReset();
        hydrateState.hydrateLocal.mockReset();
        dbState.loadCloudPayload.mockResolvedValue({
            data: { profile: { name: 'cloud-a' } },
            completeMonths: [],
            cloudDocuments: new Map(),
        });
    });

    it('does not publish A after the session switches to B while hydrateLocal(A) is pending', async () => {
        const hydration = deferred<{ data: { profile: { name: string } } }>();
        hydrateState.hydrateLocal.mockReturnValueOnce(hydration.promise);
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

        await vi.waitFor(() => expect(hydrateState.hydrateLocal).toHaveBeenCalledTimes(1));
        const writeGuard = hydrateState.hydrateLocal.mock.calls[0]?.[5] as (() => boolean) | undefined;
        expect(writeGuard?.()).toBe(true);

        switchSession('user-b');
        expect(writeGuard?.()).toBe(false);
        hydration.resolve({ data: { profile: { name: 'hydrated-a' } } });
        await loadPromise;

        expect(setUserData).not.toHaveBeenCalled();
        expect(setSaveError).not.toHaveBeenCalled();
        expect(setSyncing).not.toHaveBeenCalled();
    });

    it('does not resurrect the stale A load after A to B to A', async () => {
        const hydration = deferred<{ data: { profile: { name: string } } }>();
        hydrateState.hydrateLocal.mockReturnValueOnce(hydration.promise);
        const setUserData = vi.fn();

        const loadPromise = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });

        await vi.waitFor(() => expect(hydrateState.hydrateLocal).toHaveBeenCalledTimes(1));
        const writeGuard = hydrateState.hydrateLocal.mock.calls[0]?.[5] as (() => boolean) | undefined;

        switchSession('user-b');
        switchSession('user-a');
        expect(writeGuard?.()).toBe(false);
        hydration.resolve({ data: { profile: { name: 'hydrated-a' } } });
        await loadPromise;

        expect(setUserData).not.toHaveBeenCalled();
    });

    it('lets the newest same-account load supersede an older overlapping load', async () => {
        const firstHydration = deferred<{ data: { profile: { name: string } } }>();
        hydrateState.hydrateLocal
            .mockReturnValueOnce(firstHydration.promise)
            .mockResolvedValueOnce({ data: { profile: { name: 'newer-a' } } });
        const firstSetUserData = vi.fn();
        const secondSetUserData = vi.fn();

        const firstLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: firstSetUserData,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await vi.waitFor(() => expect(hydrateState.hydrateLocal).toHaveBeenCalledTimes(1));
        const firstWriteGuard = hydrateState.hydrateLocal.mock.calls[0]?.[5] as (() => boolean) | undefined;
        expect(firstWriteGuard?.()).toBe(true);

        const secondLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: secondSetUserData,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });

        await vi.waitFor(() => expect(hydrateState.hydrateLocal).toHaveBeenCalledTimes(2));
        expect(firstWriteGuard?.()).toBe(false);
        await secondLoad;
        expect(secondSetUserData).toHaveBeenCalledWith({ profile: { name: 'newer-a' } });

        firstHydration.resolve({ data: { profile: { name: 'older-a' } } });
        await firstLoad;
        expect(firstSetUserData).not.toHaveBeenCalled();
    });
});
