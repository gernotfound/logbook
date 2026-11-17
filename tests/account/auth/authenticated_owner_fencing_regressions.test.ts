import { beforeEach, describe, expect, it } from 'vitest';
import { clearAuthenticatedOwnerHint, readAuthenticatedOwnerHint, rememberAuthenticatedOwner } from '../../../src/lib/sync/authOwnerHint';
import { storageOwner } from '../../../src/lib/sync/session';
import { normalizeStorageOwner, userOwner } from '../../../src/lib/sync/owner';
import { assertNoLocalPurge } from '../../../src/lib/sync/localPurgeFence';
import { auth } from '../../../src/lib/firebase';

describe('Authenticated owner identity and local purge fencing', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('normalizes only a guest or a valid authenticated storage owner', () => {
        expect(normalizeStorageOwner('guest')).toBe('guest');
        expect(normalizeStorageOwner('valid-uid')).toBe('user:valid-uid');
        expect(normalizeStorageOwner('user:valid-uid')).toBe('user:valid-uid');
        expect(userOwner('valid-uid')).toBe('user:valid-uid');
        expect(assertNoLocalPurge('user:valid-uid')).toBeUndefined();
    });

    it.each(['user:', 'user:/bad', 'user:invalid/uid', 'invalid/uid', 'guest/other'])(
        'rejects a malformed storage owner %j before any purge fence or archive access',
        malformed => {
            expect(() => normalizeStorageOwner(malformed)).toThrow();
            expect(() => assertNoLocalPurge(malformed)).toThrow();
            expect(localStorage.length).toBe(0);
        },
    );

    it.each(['', 'invalid/uid', '/uid'])(
        'rejects an invalid authenticated UID %j before creating an owner namespace',
        uid => {
            expect(() => userOwner(uid)).toThrow();
            expect(() => rememberAuthenticatedOwner(uid)).toThrow();
            expect(localStorage.getItem('logbook_authenticated_owner')).toBeNull();
        },
    );

    it('persists and clears a strict authenticated owner hint without consulting Firebase Auth', () => {
        expect(readAuthenticatedOwnerHint()).toBeNull();
        expect(rememberAuthenticatedOwner('abc')).toBe('user:abc');
        expect(readAuthenticatedOwnerHint()).toBe('user:abc');
        clearAuthenticatedOwnerHint('user:abc');
        expect(readAuthenticatedOwnerHint()).toBeNull();
    });

    it.each(['', 'user:', 'guest', 'user:invalid/uid'])(
        'fails closed on a persisted malformed owner hint %j instead of falling back to guest',
        stored => {
            const previous = (auth as any).currentUser;
            try {
                (auth as any).currentUser = null;
                localStorage.setItem('logbook_authenticated_owner', stored);
                expect(() => readAuthenticatedOwnerHint()).toThrow('Owner autenticato locale non valido');
                expect(() => storageOwner()).toThrow('Owner autenticato locale non valido');
                // Corrupt evidence must never be silently cleared or rewritten.
                expect(localStorage.getItem('logbook_authenticated_owner')).toBe(stored);
            } finally {
                (auth as any).currentUser = previous;
            }
        },
    );

    it('refuses to persist an owner identity that its own reader would reject', () => {
        rememberAuthenticatedOwner('valid-account');
        expect(() => rememberAuthenticatedOwner('invalid/uid')).toThrow('Owner autenticato locale non valido');
        expect(readAuthenticatedOwnerHint()).toBe('user:valid-account');
        expect(localStorage.getItem('logbook_authenticated_owner')).toBe('user:valid-account');
    });

    it('preserves a new owner hint when a stale logout clears another owner', () => {
        rememberAuthenticatedOwner('new-account');
        clearAuthenticatedOwnerHint('user:previous-account');
        expect(readAuthenticatedOwnerHint()).toBe('user:new-account');

        expect(() => clearAuthenticatedOwnerHint('')).toThrow('Owner autenticato locale non valido');
        expect(readAuthenticatedOwnerHint()).toBe('user:new-account');
        clearAuthenticatedOwnerHint('user:new-account');
        expect(readAuthenticatedOwnerHint()).toBeNull();
    });

    it('keeps the hinted authenticated owner authoritative while Firebase Auth is still unresolved', () => {
        const previous = (auth as any).currentUser;
        try {
            (auth as any).currentUser = null;
            rememberAuthenticatedOwner('offline-user');
            expect(storageOwner()).toBe('user:offline-user');
        } finally {
            (auth as any).currentUser = previous;
            clearAuthenticatedOwnerHint();
        }
    });
});
