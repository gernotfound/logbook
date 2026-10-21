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
