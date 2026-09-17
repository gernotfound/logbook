import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
    currentUser: { uid: 'user-a' } as { uid: string } | null,
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
import { invalidateSession } from '../src/lib/sync/session';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

describe('authenticated hydration session fencing', () => {
    beforeEach(() => {
        localStorage.clear();
        authState.currentUser = { uid: 'user-a' };
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

        authState.currentUser = { uid: 'user-b' };
        invalidateSession();
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

        authState.currentUser = { uid: 'user-b' };
        invalidateSession();
        authState.currentUser = { uid: 'user-a' };
        invalidateSession();
        hydration.resolve({ data: { profile: { name: 'hydrated-a' } } });
        await loadPromise;

        expect(setUserData).not.toHaveBeenCalled();
    });
});
