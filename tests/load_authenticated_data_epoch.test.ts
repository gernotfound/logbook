import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyUserData } from './setup';
import type { UserData } from '../src/types';

const authState = vi.hoisted(() => ({
    currentUser: { uid: 'user-a' } as { uid: string } | null,
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

vi.mock('../src/store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({ userData: { profile: { height: '170' } } }),
    },
}));

import { loadAuthenticatedData } from '../src/contexts/auth/loadAuthenticatedData';
import { readLocal } from '../src/lib/sync/localRepository';
import { invalidateSession } from '../src/lib/sync/session';

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

function switchSession(uid: string): void {
    authState.currentUser = { uid };
    invalidateSession();
}

function payload(height: string) {
    return {
        data: data(height),
        completeMonths: [],
        cloudDocuments: new Map(),
    };
}

describe('authenticated hydration session fencing', () => {
    beforeEach(() => {
        localStorage.clear();
        authState.currentUser = { uid: 'user-a' };
        invalidateSession();
        dbState.loadCloudPayload.mockReset();
    });

    it('does not publish or persist A when the session changes before cloud data arrives', async () => {
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
        switchSession('user-b');
        firstPayload.resolve(payload('171'));
        await loadPromise;

        expect(await readLocal('user-a')).toBeUndefined();
        expect(setUserData).not.toHaveBeenCalled();
        expect(setSaveError).not.toHaveBeenCalled();
        expect(setSyncing).not.toHaveBeenCalledWith(false);
    });

    it('does not resurrect an older A load after A to B to A', async () => {
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

        switchSession('user-b');
        switchSession('user-a');
        const secondLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setUserData: secondSetUserData,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await secondLoad;

        expect((await readLocal('user-a'))?.data.profile.height).toBe('182');
        expect(secondSetUserData).toHaveBeenCalledWith(expect.objectContaining({
            profile: expect.objectContaining({ height: '182' }),
        }));

        firstPayload.resolve(payload('171'));
        await firstLoad;

        expect((await readLocal('user-a'))?.data.profile.height).toBe('182');
        expect(firstSetUserData).not.toHaveBeenCalled();
    });

    it('lets the newest same-account load supersede an older overlapping load', async () => {
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

        expect((await readLocal('user-a'))?.data.profile.height).toBe('183');
        expect(secondSetUserData).toHaveBeenCalledWith(expect.objectContaining({
            profile: expect.objectContaining({ height: '183' }),
        }));

        firstPayload.resolve(payload('171'));
        await firstLoad;

        expect((await readLocal('user-a'))?.data.profile.height).toBe('183');
        expect(firstSetUserData).not.toHaveBeenCalled();
    });
});
