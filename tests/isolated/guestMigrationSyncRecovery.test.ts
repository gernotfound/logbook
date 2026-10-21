import { beforeEach, describe, expect, it } from 'vitest';
import {
    guestMigrationSyncRecoveryKey, readGuestMigrationSyncRecovery,
    markGuestMigrationSyncRecovery, clearGuestMigrationSyncRecovery,
} from '../../src/lib/auth/guestMigrationSyncRecovery';

describe('owner-scoped guest migration sync recovery', () => {
    beforeEach(() => localStorage.clear());

    it('keeps distinct account handoffs independent across concurrent tab-style transitions', () => {
        const a = 'account-a';
        const b = 'account-b';
        markGuestMigrationSyncRecovery(a);
        markGuestMigrationSyncRecovery(b);

        expect(readGuestMigrationSyncRecovery(a)).toBe(true);
        expect(readGuestMigrationSyncRecovery(b)).toBe(true);
        clearGuestMigrationSyncRecovery(a);

        expect(localStorage.getItem(guestMigrationSyncRecoveryKey(a))).toBeNull();
        expect(readGuestMigrationSyncRecovery(b)).toBe(true);
        expect(localStorage.getItem(guestMigrationSyncRecoveryKey(b))).toBe(b);
    });

    it('rejects altered recovery ownership without erasing the evidence', () => {
        const uid = 'account-a';
        const key = guestMigrationSyncRecoveryKey(uid);
        localStorage.setItem(key, 'account-b');

        expect(() => readGuestMigrationSyncRecovery(uid)).toThrow('Prova di recupero');
        expect(() => clearGuestMigrationSyncRecovery(uid)).toThrow('Prova di recupero');
        expect(localStorage.getItem(key)).toBe('account-b');
    });
});
