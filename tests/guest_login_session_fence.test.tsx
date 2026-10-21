import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '../src/lib/firebase';
import { isGuestVaultReadinessCurrent } from '../src/contexts/auth/useGuestLogin';
import {
    activateGuestSession, captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, invalidateSession,
} from '../src/lib/sync/session';

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
        expect(ready).toHaveBeenCalledExactlyOnceWith('guest');
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
        expect(ready).toHaveBeenCalledExactlyOnceWith('guest');
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
});
