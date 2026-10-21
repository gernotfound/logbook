import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as catalogService from '../src/lib/catalog/catalogService';
import { ensureLocalVaultReady } from '../src/lib/sync/secureArchiveUnlockFlow';
import { isVaultUnlocked } from '../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession } from '../src/lib/sync/session';
import { useGuestLogin } from '../src/contexts/auth/useGuestLogin';
import { useAppStore } from '../src/store/useAppStore';

vi.mock('../src/lib/sync/secureArchiveUnlockFlow', () => ({
    ensureLocalVaultReady: vi.fn(),
}));
vi.mock('../src/lib/sync/secureArchiveSession', async importOriginal => ({
    ...(await importOriginal<typeof import('../src/lib/sync/secureArchiveSession')>()),
    isVaultUnlocked: vi.fn(() => true),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

function setupGuestLogin() {
    const isGuestRef = { current: false };
    const setIsGuest = vi.fn();
    const setGuestMigrationStatus = vi.fn();
    const setSaveError = vi.fn();
    const setUserData = vi.fn();
    const { result, unmount } = renderHook(() => useGuestLogin({
        isGuestRef, setIsGuest, setGuestMigrationStatus, setSaveError,
        setUserData: setUserData as unknown as ReturnType<typeof useAppStore.getState>['setUserData'],
    }));
    return { result, unmount, isGuestRef, setIsGuest, setUserData };
}

describe('guest login: session and vault readiness fencing', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.getState().resetStore({ force: true });
        vi.clearAllMocks();
        invalidateSession();
        vi.mocked(isVaultUnlocked).mockReturnValue(true);
        vi.mocked(ensureLocalVaultReady).mockResolvedValue(undefined);
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('does not publish guest mode when readiness finishes after an identity switch', async () => {
        const hold = deferred<void>();
        vi.mocked(ensureLocalVaultReady).mockReturnValueOnce(hold.promise);
        const hook = setupGuestLogin();
        let operation!: Promise<void>;
        act(() => { operation = hook.result.current(); });
        await waitFor(() => expect(ensureLocalVaultReady).toHaveBeenCalledWith('guest'));
        invalidateSession();
        await act(async () => { hold.resolve(); await operation; });
        expect(hook.setIsGuest).not.toHaveBeenCalled();
        expect(hook.setUserData).not.toHaveBeenCalled();
        expect(hook.isGuestRef.current).toBe(false);
        hook.unmount();
    });

    it('does not accept cancelled readiness as a usable local vault', async () => {
        vi.mocked(isVaultUnlocked).mockReturnValue(false);
        const hook = setupGuestLogin();
        await act(async () => { await hook.result.current(); });
        expect(ensureLocalVaultReady).toHaveBeenCalledWith('guest');
        expect(hook.setIsGuest).not.toHaveBeenCalled();
        expect(hook.setUserData).not.toHaveBeenCalled();
        hook.unmount();
    });

    it('does not adopt a replacement guest generation during vault provisioning', async () => {
        const hold = deferred<void>();
        vi.mocked(ensureLocalVaultReady).mockReturnValueOnce(hold.promise);
        const hook = setupGuestLogin();
        let operation!: Promise<void>;
        act(() => { operation = hook.result.current(); });
        await waitFor(() => expect(ensureLocalVaultReady).toHaveBeenCalledWith('guest'));
        localStorage.setItem(GUEST_SESSION_KEY, 'another-guest-generation');
        activateGuestSession('another-guest-generation');
        await act(async () => { hold.resolve(); await operation; });
        expect(hook.setIsGuest).not.toHaveBeenCalled();
        expect(hook.setUserData).not.toHaveBeenCalled();
        hook.unmount();
    });

    it('does not publish an obsolete guest draft after awaiting a catalog read', async () => {
        const hold = deferred<Awaited<ReturnType<typeof catalogService.getCachedCatalog>>>();
        vi.spyOn(catalogService, 'isCatalogInMemory').mockReturnValue(false);
        vi.spyOn(catalogService, 'getCachedCatalog').mockReturnValue(hold.promise);
        const hook = setupGuestLogin();
        let operation!: Promise<void>;
        act(() => { operation = hook.result.current(); });
        await waitFor(() => expect(catalogService.getCachedCatalog).toHaveBeenCalled());
        invalidateSession();
        await act(async () => {
            // The stale callback must exit before consuming this catalog; its
            // schema is irrelevant to the race being tested.
            hold.resolve({ exercises: [], foods: [] } as unknown as Awaited<ReturnType<typeof catalogService.getCachedCatalog>>);
            await operation;
        });
        expect(hook.setUserData).not.toHaveBeenCalled();
        hook.unmount();
    });
});
