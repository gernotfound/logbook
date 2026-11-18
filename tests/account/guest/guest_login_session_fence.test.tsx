import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '../../../src/lib/firebase';
import { isGuestVaultReadinessCurrent, useGuestLogin } from '../../../src/contexts/auth/useGuestLogin';
import { withGuestLifecycleLock } from '../../../src/lib/sync/guestLifecycleLock';
import {
    activateGuestSession, captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, invalidateSession,
} from '../../../src/lib/sync/session';

const ready = vi.fn((_owner: string) => true);

function beginGuest(id: string) {
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, id);
    localStorage.removeItem(GUEST_REVOCATION_KEY);
    activateGuestSession(id);
    return captureSession();
}

describe('guest vault readiness: exact owner and session fences', () => {
    beforeEach(() => {
        localStorage.clear();
        (auth as { currentUser: unknown }).currentUser = null;
        vi.clearAllMocks();
        ready.mockReturnValue(true);
    });

    it('allows the current guest generation when its vault is ready', () => {
        const session = beginGuest('guest-generation-a');
        expect(isGuestVaultReadinessCurrent(session, ready)).toBe(true);
        expect(ready).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledWith('guest');
    });

    it('refuses a canceled vault readiness completion after the session epoch changes', async () => {
        const session = beginGuest('guest-generation-b');
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const checkAfterReady = pending.then(() => isGuestVaultReadinessCurrent(session, ready));
        invalidateSession();
        release();
        await expect(checkAfterReady).resolves.toBe(false);
        expect(ready).not.toHaveBeenCalled();
    });

    it('does not mistake a completed readiness Promise for a usable vault', async () => {
        const session = beginGuest('guest-generation-c');
        ready.mockReturnValue(false);
        const completion = Promise.resolve().then(() => isGuestVaultReadinessCurrent(session, ready));
        await expect(completion).resolves.toBe(false);
        expect(ready).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledWith('guest');
    });

    it('rejects a replacement guest generation after asynchronous work', async () => {
        const session = beginGuest('guest-generation-old');
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const checkAfterReady = pending.then(() => isGuestVaultReadinessCurrent(session, ready));
        beginGuest('guest-generation-new');
        release();
        await expect(checkAfterReady).resolves.toBe(false);
        expect(ready).not.toHaveBeenCalled();
    });

    it('rejects an authenticated owner snapshot even if guest storage is active', () => {
        const session = beginGuest('guest-generation-handoff');
        expect(isGuestVaultReadinessCurrent({ ...session, owner: 'user:other-account' }, ready)).toBe(false);
        expect(ready).not.toHaveBeenCalled();
    });

    it('refuses a revoked guest generation without attempting to open the vault', () => {
        const session = beginGuest('guest-generation-revoked');
        localStorage.setItem(GUEST_REVOCATION_KEY, 'revoked');
        expect(isGuestVaultReadinessCurrent(session, ready)).toBe(false);
        expect(ready).not.toHaveBeenCalled();
    });

    it.each([null, ''])('rejects a guest marker with an absent or empty generation (%s)', async storedId => {
        localStorage.setItem('logbook_is_guest', 'true');
        if (storedId !== null) localStorage.setItem(GUEST_SESSION_KEY, storedId);
        // A new browser realm starts without an explicitly activated guest ID.
        vi.resetModules();
        const session = await import('../../../src/lib/sync/session');
        expect(session.isActiveGuestSession()).toBe(false);
        const snapshot = session.captureSession();
        expect(snapshot.owner).toBe('guest');
        expect(snapshot.guestSessionId).toBe(storedId);
        expect(session.isCurrentSession(snapshot)).toBe(false);
    });

    it('rejects a previously active guest when its durable generation disappears', () => {
        const snapshot = beginGuest('guest-generation-lost');
        localStorage.removeItem(GUEST_SESSION_KEY);
        expect(isGuestVaultReadinessCurrent(snapshot, ready)).toBe(false);
        expect(ready).not.toHaveBeenCalled();
    });
});

describe('guest login does not depend on Firebase when a provider supplies opaque identity', () => {
    it('rejects a queued guest activation after a Kinde identity switch', async () => {
        localStorage.clear();
        localStorage.removeItem(GUEST_REVOCATION_KEY);
        let account: object | null = { kind: 'kinde', session: 'A' };
        const run = { current: 1 };
        const isGuestRef = { current: false };
        const saved = { current: null };
        let release!: () => void;
        let entered!: () => void;
        const locked = new Promise<void>(resolve => { release = resolve; });
        const signaled = new Promise<void>(resolve => { entered = resolve; });
        const holder = withGuestLifecycleLock(async () => { entered(); await locked; });
        await signaled;
        const deps = {
            authRunRef: run,
            isGuestRef,
            readAuthIdentity: () => account,
            purgeGuest: vi.fn(async () => {}),
            setIsGuest: vi.fn(),
            setGuestMigrationStatus: vi.fn(),
            setUserData: vi.fn(),
            setSaveError: vi.fn(),
        };
        const { result } = renderHook(() => useGuestLogin(deps));
        try {
            const pending = result.current();
            account = { kind: 'kinde', session: 'B' };
            release();
            await holder;
            await act(async () => { await pending; });
            expect(localStorage.getItem('logbook_is_guest')).toBeNull();
            expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
            expect(deps.setIsGuest).not.toHaveBeenCalled();
            expect(deps.setUserData).not.toHaveBeenCalled();
            expect(saved.current).toBeNull();
        } finally {
            release();
            await holder;
        }
    });

    it('rejects a queued guest activation after an A-B-A identity change even with stable opaque identity', async () => {
        localStorage.clear();
        let account: object | null = { kind: 'kinde', session: 'A' };
        const run = { current: 1 };
        let release!: () => void;
        let entered!: () => void;
        const hold = new Promise<void>(resolve => { release = resolve; });
        const notification = new Promise<void>(resolve => { entered = resolve; });
        const holder = withGuestLifecycleLock(async () => { entered(); await hold; });
        await notification;
        const deps = {
            authRunRef: run,
            isGuestRef: { current: false },
            readAuthIdentity: () => account,
            purgeGuest: vi.fn(async () => {}),
            setIsGuest: vi.fn(),
            setGuestMigrationStatus: vi.fn(),
            setUserData: vi.fn(),
            setSaveError: vi.fn(),
        };
        const { result } = renderHook(() => useGuestLogin(deps));
        try {
            const pending = result.current();
            account = { kind: 'kinde', session: 'B' };
            run.current += 1; // The provider epoch cannot be reused on A→B→A.
            account = { kind: 'kinde', session: 'A' };
            release();
            await holder;
            await act(async () => { await pending; });
            expect(localStorage.getItem('logbook_is_guest')).toBeNull();
            expect(deps.setIsGuest).not.toHaveBeenCalled();
        } finally {
            release();
            await holder;
        }
    });
});
