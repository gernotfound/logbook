// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    guestMigrationSyncRecoveryKey, readGuestMigrationSyncRecovery,
    readGuestMigrationSyncWitness, markGuestMigrationSyncRecovery,
    clearGuestMigrationSyncRecovery,
} from '../../src/lib/auth/guestMigrationSyncRecovery';
import { GUEST_SESSION_KEY } from '../../src/lib/sync/sessionKeys';

describe('owner-scoped guest migration sync recovery', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(GUEST_SESSION_KEY, 'generation-a');
    });

    it('keeps distinct account handoffs independent across concurrent tab-style transitions', () => {
        const a = 'account-a';
        const b = 'account-b';
        const witnessA = markGuestMigrationSyncRecovery(a);
        markGuestMigrationSyncRecovery(b);

        expect(readGuestMigrationSyncRecovery(a)).toBe(true);
        expect(readGuestMigrationSyncRecovery(b)).toBe(true);
        clearGuestMigrationSyncRecovery(a, witnessA);

        expect(localStorage.getItem(guestMigrationSyncRecoveryKey(a))).toBeNull();
        expect(readGuestMigrationSyncRecovery(b)).toBe(true);
        expect(readGuestMigrationSyncWitness(b)?.uid).toBe(b);
    });

    it('does not allow a stale same-UID retry to consume a newer recovery handoff', () => {
        const first = markGuestMigrationSyncRecovery('account-a');
        localStorage.setItem(GUEST_SESSION_KEY, 'generation-b');
        const second = markGuestMigrationSyncRecovery('account-a');
        expect(first).not.toBe(second);
        expect(() => clearGuestMigrationSyncRecovery('account-a', first))
            .toThrow('sostituita');
        expect(readGuestMigrationSyncWitness('account-a')).toMatchObject({
            uid: 'account-a', guestSessionId: 'generation-b', id: second,
        });
        clearGuestMigrationSyncRecovery('account-a', second);
        expect(readGuestMigrationSyncRecovery('account-a')).toBe(false);
    });

    it.each(['null', '[]', '1', '"unexpected"', '{broken'])(
        'rejects malformed recovery proof %s with its stable error and preserves the original',
        raw => {
            const uid = 'account-a';
            const key = guestMigrationSyncRecoveryKey(uid);
            localStorage.setItem(key, raw);
            expect(() => readGuestMigrationSyncWitness(uid)).toThrow('Prova di recupero migrazione account non valida.');
            expect(() => clearGuestMigrationSyncRecovery(uid, 'unverified')).toThrow('Prova di recupero migrazione account non valida.');
            expect(localStorage.getItem(key)).toBe(raw);
        },
    );

    it.each([null, '', '   '])(
        'refuses to create a recovery proof without a valid guest generation (%j)',
        generation => {
            const key = guestMigrationSyncRecoveryKey('account-a');
            if (generation === null) localStorage.removeItem(GUEST_SESSION_KEY);
            else localStorage.setItem(GUEST_SESSION_KEY, generation);

            expect(() => markGuestMigrationSyncRecovery('account-a'))
                .toThrow('Generazione guest mancante');
            expect(localStorage.getItem(key)).toBeNull();

            localStorage.setItem(GUEST_SESSION_KEY, 'generation-a');
            const id = markGuestMigrationSyncRecovery('account-a');
            expect(readGuestMigrationSyncWitness('account-a'))
                .toMatchObject({ guestSessionId: 'generation-a', id });
        },
    );

    it.each([null, '', '   ', 42, false])(
        'does not accept a stored recovery proof with a corrupt generation (%j)',
        generation => {
            const uid = 'account-a';
            const key = guestMigrationSyncRecoveryKey(uid);
            const raw = JSON.stringify({ version: 1, uid, guestSessionId: generation, id: 'witness' });
            localStorage.setItem(key, raw);

            expect(() => readGuestMigrationSyncWitness(uid))
                .toThrow('Prova di recupero migrazione account non valida.');
            expect(() => clearGuestMigrationSyncRecovery(uid, 'witness'))
                .toThrow('Prova di recupero migrazione account non valida.');
            expect(localStorage.getItem(key)).toBe(raw);
        },
    );

    it.each(['', 'invalid/uid'])(
        'does not construct or mutate a guest-migration namespace for an invalid account UID (%j)',
        uid => {
            const before = localStorage.length;
            expect(() => guestMigrationSyncRecoveryKey(uid)).toThrow();
            expect(() => readGuestMigrationSyncWitness(uid)).toThrow();
            expect(() => markGuestMigrationSyncRecovery(uid)).toThrow();
            expect(() => clearGuestMigrationSyncRecovery(uid, 'witness')).toThrow();
            expect(localStorage.length).toBe(before);
        },
    );

    it('rejects altered recovery ownership without erasing evidence', () => {
        const uid = 'account-a';
        const key = guestMigrationSyncRecoveryKey(uid);
        localStorage.setItem(key, JSON.stringify({
            version: 1, uid: 'account-b', guestSessionId: 'generation-b', id: 'another',
        }));
        expect(() => readGuestMigrationSyncRecovery(uid)).toThrow('Prova di recupero');
        expect(() => clearGuestMigrationSyncRecovery(uid, 'another')).toThrow('Prova di recupero');
        expect(localStorage.getItem(key)).not.toBeNull();
    });
});
