import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    values: new Map<string, unknown>(),
    owner: 'user:a',
    failKey: null as string | null,
    writes: [] as string[],
    deletionPending: false,
}));

vi.mock('idb-keyval', () => ({
    get: vi.fn(async (key: string) => fake.values.get(key)),
    del: vi.fn(async (key: string) => {
        if (fake.failKey === key) throw new Error('IDB inaccessible');
        fake.writes.push(key);
        fake.values.delete(key);
    }),
}));

vi.mock('../src/lib/sync/session', () => ({
    storageOwner: () => fake.owner,
    GUEST_SESSION_KEY: 'logbook_guest_session_id_v1',
}));

vi.mock('../src/lib/sync/accountGate', () => ({
    isAccountDeletionPending: () => fake.deletionPending,
}));

import { markHealthConsentRevocation, healthConsentRevocationKey } from '../src/lib/healthConsentRevocation';
import { eraseWithdrawnLocalTracking } from '../src/lib/healthConsentLocalErasure';

describe('owner-scoped consent withdrawal local purge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        fake.values.clear();
        fake.writes.length = 0;
        fake.owner = 'user:a';
        fake.failKey = null;
        fake.deletionPending = false;
    });

    it('purges revoked owner envelope, pending journal and device data but keeps revocation and account deletion receipts', async () => {
        markHealthConsentRevocation('user:a', 'pending');
        localStorage.setItem('logbook:v2:user:a:account-deletion', 'receipt');
        localStorage.setItem('logbook:v2:user:a:workout', 'private');
        localStorage.setItem('logbook:v2:user:b:workout', 'other owner');
        localStorage.setItem('logbook_timer_state', 'legacy');
        fake.values.set('logbook:v2:user:a', { data: 'sensitive', pending: ['op'] });
        fake.values.set('pending_sync_payload', { sensitive: true });
        fake.values.set('logbook:v2:user:b', { data: 'other' });
        await eraseWithdrawnLocalTracking('user:a');
        expect(localStorage.getItem(healthConsentRevocationKey('user:a'))).toBe('pending');
        expect(localStorage.getItem('logbook:v2:user:a:account-deletion')).toBe('receipt');
        expect(localStorage.getItem('logbook:v2:user:a:workout')).toBeNull();
        expect(localStorage.getItem('logbook_timer_state')).toBeNull();
        expect(localStorage.getItem('logbook:v2:user:b:workout')).toBe('other owner');
        expect(fake.values.has('logbook:v2:user:a')).toBe(false);
        expect(fake.values.has('pending_sync_payload')).toBe(false);
        expect(fake.values.has('logbook:v2:user:b')).toBe(true);
        await expect(eraseWithdrawnLocalTracking('user:a')).resolves.toBeUndefined();
    });

    it('preserves guest auth/session and consent marker after consent withdrawal', async () => {
        fake.owner = 'guest';
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem('logbook_guest_session_id_v1', 'guest-generation');
        localStorage.setItem('logbook:v2:guest:workout', 'active session');
        markHealthConsentRevocation('guest', 'confirmed');
        await eraseWithdrawnLocalTracking('guest');
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(localStorage.getItem('logbook_guest_session_id_v1')).toBe('guest-generation');
        expect(localStorage.getItem('logbook:v2:guest:workout')).toBeNull();
        expect(localStorage.getItem(healthConsentRevocationKey('guest'))).toBe('confirmed');
    });

    it('refuses to destroy user data unless consent withdrawal is already durable', async () => {
        fake.values.set('logbook:v2:user:a', { private: true });
        await expect(eraseWithdrawnLocalTracking('user:a')).rejects.toThrow('Revoca non registrata');
        expect(fake.values.has('logbook:v2:user:a')).toBe(true);
        fake.deletionPending = true;
        markHealthConsentRevocation('user:a', 'pending');
        await expect(eraseWithdrawnLocalTracking('user:a')).rejects.toThrow('Eliminazione account');
        expect(fake.values.has('logbook:v2:user:a')).toBe(true);
    });

    it('fails visibly if IDB is inaccessible, so the UI can retry the cleanup', async () => {
        markHealthConsentRevocation('user:a', 'confirmed');
        fake.values.set('logbook:v2:user:a', { data: 'sensitive' });
        fake.failKey = 'logbook:v2:user:a';
        await expect(eraseWithdrawnLocalTracking('user:a')).rejects.toThrow('IDB inaccessible');
        expect(fake.values.has('logbook:v2:user:a')).toBe(true);
        fake.failKey = null;
        await expect(eraseWithdrawnLocalTracking('user:a')).resolves.toBeUndefined();
        expect(fake.values.has('logbook:v2:user:a')).toBe(false);
    });

    it('aborts before other-owner deletion after a session switch', async () => {
        markHealthConsentRevocation('user:a', 'pending');
        fake.owner = 'user:b';
        fake.values.set('logbook:v2:user:a', { private: true });
        await expect(eraseWithdrawnLocalTracking('user:a')).rejects.toThrow('Sessione cambiata');
        expect(fake.values.has('logbook:v2:user:a')).toBe(true);
        expect(fake.writes).toEqual([]);
    });
});
