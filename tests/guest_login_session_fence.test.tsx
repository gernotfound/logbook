import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isVaultUnlocked } from '../src/lib/sync/secureArchiveSession';
import { isGuestVaultReadinessCurrent } from '../src/contexts/auth/useGuestLogin';
import {
    activateGuestSession, captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, invalidateSession,
} from '../src/lib/sync/session';

vi.mock('../src/lib/sync/secureArchiveSession', async importOriginal => ({
    ...(await importOriginal<typeof import('../src/lib/sync/secureArchiveSession')>()),
    isVaultUnlocked: vi.fn(() => true),
}));

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
        vi.clearAllMocks();
        vi.mocked(isVaultUnlocked).mockReturnValue(true);
    });

    it('permits publishing only with the active guest generation and an unlocked vault', () => {
        const session = beginGuest('guest-generation-a');
        expect(isGuestVaultReadinessCurrent(session)).toBe(true);
        expect(isVaultUnlocked).toHaveBeenCalledWith('guest');
    });

    it('refuses a canceled vault readiness completion after the session epoch changes', async () => {
        const session = beginGuest('guest-generation-b');
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const checkAfterReady = pending.then(() => isGuestVaultReadinessCurrent(session));
        invalidateSession();
        release();
        await expect(checkAfterReady).resolves.toBe(false);
    });

    it('does not mistake a completed readiness Promise for a usable vault', async () => {
        const session = beginGuest('guest-generation-c');
        vi.mocked(isVaultUnlocked).mockReturnValue(false);
        const completion = Promise.resolve().then(() => isGuestVaultReadinessCurrent(session));
        await expect(completion).resolves.toBe(false);
    });

    it('rejects adoption of a replacement guest generation after asynchronous work', async () => {
        const session = beginGuest('guest-generation-old');
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const checkAfterReady = pending.then(() => isGuestVaultReadinessCurrent(session));
        beginGuest('guest-generation-new');
        release();
        await expect(checkAfterReady).resolves.toBe(false);
    });

    it('does not publish guest state for an authenticated owner snapshot', () => {
        const guest = beginGuest('guest-during-account-handoff');
        expect(isGuestVaultReadinessCurrent({ ...guest, owner: 'user:other-account' })).toBe(false);
    });

    it('fails closed when the guest generation has been revoked', () => {
        const session = beginGuest('guest-generation-revoked');
        localStorage.setItem(GUEST_REVOCATION_KEY, 'revoked');
        expect(isGuestVaultReadinessCurrent(session)).toBe(false);
    });
});
