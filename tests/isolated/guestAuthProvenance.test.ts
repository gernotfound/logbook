// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User, UserCredential } from 'firebase/auth';
import {
    beginGuestMigrationIntent,
    bindGuestMigrationIntentToUser,
    clearGuestMigrationIntent,
    confirmGuestMigrationCredential,
    rejectGuestMigrationAuthWaiters,
} from '../../src/lib/auth/guestMigrationIntent';

const KEY = 'guest_migration_intent_v1';
const user = { uid: 'same-account', email: 'same@example.test', providerData: [
    { providerId: 'google.com' },
] } as User;
const credential = (providerId: 'google.com' | 'password', account: User = user) =>
    ({ user: account, providerId } as UserCredential);

describe('Auth result provenance for guest-to-account decisions', () => {
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        // jsdom has no Web Locks API. Preserve the production contract:
        // operations with the same named lock are serialized, never bypassed.
        const tails = new Map<string, Promise<void>>();
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: {
                request: async <T>(name: string, _options: LockOptions, operation: () => Promise<T>): Promise<T> => {
                    const preceding = tails.get(name) ?? Promise.resolve();
                    let release!: () => void;
                    const held = new Promise<void>(resolve => { release = resolve; });
                    tails.set(name, preceding.then(() => held));
                    await preceding;
                    try {
                        return await operation();
                    } finally {
                        release();
                    }
                },
            },
        });
    });
    afterEach(() => {
        vi.useRealTimers();
        if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
        else Reflect.deleteProperty(navigator, 'locks');
    });

    it('does not bind an Auth broadcast of the same UID/provider before the initiating result', async () => {
        const intent = await beginGuestMigrationIntent('merge', 'google');
        let finished = false;
        // Models an onAuthStateChanged callback from another tab while the
        // initiating signInWithPopup promise has not returned its UserCredential.
        const binding = bindGuestMigrationIntentToUser(user).then(value => {
            finished = true;
            return value;
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(finished).toBe(false);
        expect(JSON.parse(localStorage.getItem(KEY)!)).not.toHaveProperty('credentialUid');

        await confirmGuestMigrationCredential(intent.id, credential('google.com'));
        await expect(binding).resolves.toMatchObject({ id: intent.id, boundUid: user.uid, policy: 'merge' });
        expect(finished).toBe(true);
    });

    it('rejects a different UID and does not consume the reserved guest choice', async () => {
        const intent = await beginGuestMigrationIntent('skip', 'email', {
            email: 'same@example.test', uid: user.uid,
        });
        const foreign = { ...user, uid: 'other-account' } as User;
        await expect(bindGuestMigrationIntentToUser(foreign)).rejects.toThrow('account diverso');
        await expect(confirmGuestMigrationCredential(intent.id, credential('password', foreign))).rejects.toThrow('account diverso');
        expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ id: intent.id, policy: 'skip' });
    });

    it('fails closed immediately if the own Auth result cannot be attested', async () => {
        const intent = await beginGuestMigrationIntent('merge', 'email', { email: user.email! });
        const binding = bindGuestMigrationIntentToUser(user);
        const rejection = expect(binding).rejects.toThrow('non verificabile');
        rejectGuestMigrationAuthWaiters(intent.id, 'Risultato Auth non verificabile.');
        await rejection;
        expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ id: intent.id, policy: 'merge' });
        await clearGuestMigrationIntent(intent.id);
        await expect(confirmGuestMigrationCredential(intent.id, credential('password'))).rejects.toThrow('assente');
    });

    it('cannot reuse a prior popup result after a JS realm restart with a copied receipt', async () => {
        const intent = await beginGuestMigrationIntent('merge', 'email', { email: user.email! });
        await confirmGuestMigrationCredential(intent.id, credential('password'));
        expect(JSON.parse(localStorage.getItem(KEY)!)).not.toHaveProperty('credentialUid');
        // New realm, but the localStorage reservation and sessionStorage receipt
        // still exist (the same circumstance as reload or a duplicated tab).
        vi.resetModules();
        const restarted = await import('../../src/lib/auth/guestMigrationIntent');
        vi.useFakeTimers();
        const outcome = restarted.bindGuestMigrationIntentToUser(user)
            .then(() => 'unsafe-accepted', error => (error as Error).message);
        await vi.advanceTimersByTimeAsync(15_010);
        expect(await outcome).toContain('non confermata');
        expect(localStorage.getItem(KEY)).not.toBeNull();
    });
});
