import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import * as idb from 'idb-keyval';
import { useAppStore } from '../src/store/useAppStore';
import { storageOwner } from '../src/lib/sync/session';
import { localStorageMock } from './setup';
import { markAccountDeletion, isAccountDeletionPending } from '../src/lib/sync/accountGate';

vi.mock('idb-keyval', () => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn()
}));

// Mock firebase auth
vi.mock('../src/lib/firebase', async () => {
    const actual = await vi.importActual('../src/lib/firebase');
    return {
        ...actual,
        auth: {
            signOut: vi.fn(),
            currentUser: { uid: 'user123' }
        },
        ensureAppCheck: vi.fn(),
        getDb: vi.fn()
    };
});

describe('SEC-02: Logout Cleanup & Sensitive Data Purge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('purgeAllLocalUserData removes all sensitive keys from localStorage and preserves device-specific ones', async () => {
        const sensitiveKeys = [
            'logbook_local_workout',
            'logbook_timer_state',
            'logbook_timer_start',
            'logbook_timer_accumulated',
            'draft_measurement',
            'draft_exercise',
            'draft_routine',
            'logbook_is_guest',
            'logbook_awaiting_redirect',
            'guest_migration_intent_v1',
            'guest_migration_policy'
        ];

        const deviceKeys = [
            'logbook_ios_install_prompt'
        ];

        sensitiveKeys.forEach(k => localStorage.setItem(k, 'sensitive_data'));
        deviceKeys.forEach(k => localStorage.setItem(k, 'device_pref'));

        await DB.purgeAllLocalUserData('guest');

        sensitiveKeys.forEach(k => {
            expect(localStorage.getItem(k)).toBeNull();
        });

        deviceKeys.forEach(k => {
            expect(localStorage.getItem(k)).toBe('device_pref');
        });
    });

    it('purgeAllLocalUserData removes IndexedDB sensitive keys', async () => {
        await DB.purgeAllLocalUserData();

        expect(idb.del).toHaveBeenCalledWith('logbook_cached_user_data');
        expect(idb.del).toHaveBeenCalledWith('pending_sync_token');
        expect(idb.del).toHaveBeenCalledWith('pending_sync_payload');
        expect(idb.del).toHaveBeenCalledWith('sync_failed');
    });

    it('purgeAllLocalUserData removes only the current owner guest migration recovery marker', async () => {
        localStorage.setItem('logbook_guest_migration_sync_recovery', 'user123');
        await DB.purgeAllLocalUserData('user:user123');
        expect(localStorage.getItem('logbook_guest_migration_sync_recovery')).toBeNull();

        localStorage.setItem('logbook_guest_migration_sync_recovery', 'another-user');
        await DB.purgeAllLocalUserData('user:user123');
        expect(localStorage.getItem('logbook_guest_migration_sync_recovery')).toBe('another-user');
    });

    it('purgeAllLocalUserData reports IndexedDB failure and still cleans localStorage', async () => {
        vi.mocked(idb.del).mockRejectedValueOnce(new Error('IndexedDB quota exceeded'));
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        localStorage.setItem('draft_measurement', 'draft_data');

        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('Pulizia locale incompleta');

        expect(localStorage.getItem('draft_measurement')).toBeNull();
        
        consoleWarnSpy.mockRestore();
    });

    it('purgeAllLocalUserData iterates gracefully through localStorage keys even if one throws an error (best-effort per key)', async () => {
        // Force localStorage.removeItem to throw on the first sensitive key
        const originalRemoveItem = localStorage.removeItem;
        let throwCount = 0;
        localStorage.removeItem = vi.fn((key: string) => {
            if (key === 'logbook_local_workout' && throwCount === 0) {
                throwCount++;
                throw new Error('Simulated localStorage error');
            }
            originalRemoveItem.call(localStorage, key);
        });

        localStorage.setItem('logbook_local_workout', 'data');
        localStorage.setItem('draft_measurement', 'draft');
        
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('Pulizia locale incompleta');
        // Ensure subsequent keys were still deleted
        expect(localStorage.getItem('draft_measurement')).toBeNull();

        localStorage.removeItem = originalRemoveItem;
        consoleWarnSpy.mockRestore();
    });

    it('purgeAllLocalUserData verifies the postcondition after concurrent key compaction', async () => {
        const owner = 'user:test-user-id';
        const first = `logbook:v2:${owner}:draft:a`;
        const second = `logbook:v2:${owner}:draft:b`;
        localStorage.setItem(first, 'a');
        localStorage.setItem(second, 'b');

        const originalKey = localStorageMock.key.getMockImplementation()!;
        let compacted = false;
        localStorageMock.key.mockImplementation((index: number) => {
            const storageKey = originalKey(index);
            if (!compacted && index === 0 && storageKey === first) {
                compacted = true;
                localStorage.removeItem(first);
            }
            return storageKey;
        });

        await DB.purgeAllLocalUserData(owner);

        expect(localStorage.getItem(first)).toBeNull();
        expect(localStorage.getItem(second)).toBeNull();
    });

    it('purgeAllLocalUserData removes owner keys added concurrently during cleanup', async () => {
        const owner = 'user:test-user-id';
        const initial = `logbook:v2:${owner}:draft:a`;
        const concurrent = `logbook:v2:${owner}:draft:b`;
        localStorage.setItem(initial, 'a');

        const originalRemove = localStorageMock.removeItem.getMockImplementation()!;
        let added = false;
        localStorageMock.removeItem.mockImplementation((storageKey: string) => {
            originalRemove(storageKey);
            if (!added && storageKey === initial) {
                added = true;
                localStorage.setItem(concurrent, 'b');
            }
        });

        await DB.purgeAllLocalUserData(owner);

        expect(localStorage.getItem(initial)).toBeNull();
        expect(localStorage.getItem(concurrent)).toBeNull();
    });

    it('purgeAllLocalUserData rejects when an owner-scoped survivor cannot be removed', async () => {
        const owner = 'user:test-user-id';
        const survivor = `logbook:v2:${owner}:draft:survivor`;
        const otherOwner = 'logbook:v2:user:other-user:draft:keep';
        localStorage.setItem(survivor, 'private');
        localStorage.setItem(otherOwner, 'other');

        const originalRemove = localStorageMock.removeItem.getMockImplementation()!;
        localStorageMock.removeItem.mockImplementation((storageKey: string) => {
            if (storageKey !== survivor) originalRemove(storageKey);
        });

        await expect(DB.purgeAllLocalUserData(owner)).rejects.toThrow('Pulizia locale incompleta');
        expect(localStorage.getItem(survivor)).toBe('private');
        expect(localStorage.getItem(otherOwner)).toBe('other');
    });

    it('purgeAllLocalUserData is idempotent (safe to call twice)', async () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.setItem('logbook_local_workout', 'data');

        await DB.purgeAllLocalUserData();
        expect(localStorage.getItem('logbook_local_workout')).toBeNull();

        await expect(DB.purgeAllLocalUserData()).resolves.toBeUndefined();
        
        expect(consoleWarnSpy).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
    });

    it('secureLogOut removes the account-deletion recovery credential only after local purge succeeds', async () => {
        const recoveryKey = 'logbook_deletion_recovery_devices_v1';
        const owner = storageOwner();
        const uid = owner.startsWith('user:') ? owner.slice('user:'.length) : 'unexpected-guest';
        localStorage.setItem(recoveryKey, JSON.stringify([{ uid, token: 'A'.repeat(43) }]));

        await DB.secureLogOut();

        expect(localStorage.getItem(recoveryKey)).toBeNull();
    });

    it('secureLogOut preserves the recovery credential if local purge fails after sign-out', async () => {
        const recoveryKey = 'logbook_deletion_recovery_devices_v1';
        const owner = storageOwner();
        const uid = owner.startsWith('user:') ? owner.slice('user:'.length) : 'unexpected-guest';
        localStorage.setItem(recoveryKey, JSON.stringify([{ uid, token: 'A'.repeat(43) }]));
        const purgeSpy = vi.spyOn(DB, 'purgeAllLocalUserData').mockRejectedValueOnce(new Error('local purge failed'));

        await expect(DB.secureLogOut()).rejects.toThrow('local purge failed');
        expect(localStorage.getItem(recoveryKey)).not.toBeNull();

        purgeSpy.mockRestore();
    });

    it('secureLogOut preserves the local archive and rejects when auth.signOut fails', async () => {
        const { auth } = await import('../src/lib/firebase');
        vi.mocked(auth.signOut).mockRejectedValueOnce(new Error('Network offline'));
        
        const purgeSpy = vi.spyOn(DB, 'purgeAllLocalUserData').mockResolvedValue(undefined);
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(DB.secureLogOut()).rejects.toThrow('Network offline');
        expect(purgeSpy).not.toHaveBeenCalled();

        purgeSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it('cancelPendingSyncs stops debouncer and sets syncing to false to prevent race conditions during logout', () => {
        const store = useAppStore.getState();
        // Manually start a "sync"
        store.setSyncing(true);
        expect(useAppStore.getState().syncing).toBe(true);

        store.cancelPendingSyncs();

        expect(useAppStore.getState().syncing).toBe(false);
    });

    it('resetStore preserves memory state when the active deletion marker is corrupt', () => {
        const owner = storageOwner();
        localStorage.setItem(`logbook:v2:${owner}:account-deletion`, '{"startedAt":');
        useAppStore.setState({
            userData: { profile: { height: '175' } } as any,
            dataOwner: owner,
        });

        useAppStore.getState().resetStore();

        expect(useAppStore.getState().userData?.profile?.height).toBe('175');
        expect(useAppStore.getState().saveError).toContain('Cancellazione account in verifica');
    });

    it('blocks ordinary local writes while account deletion is pending', async () => {
        localStorage.setItem('logbook_is_guest', 'false');
        const owner = storageOwner();
        const uid = owner.startsWith('user:') ? owner.slice(5) : 'unexpected-guest';
        localStorage.setItem(`logbook:v2:${owner}:account-deletion`, JSON.stringify({
            owner,
            uid,
            startedAt: Date.now(),
            receiptToken: 'receipt-token',
        }));
        useAppStore.setState({
            userData: {
                ...useAppStore.getState().userData,
                profile: { height: '176' },
            } as any,
            dataOwner: owner,
        });

        await expect(useAppStore.getState().dispatchDomainOperation({
            type: 'profile.patch',
            patch: { height: '177' },
        } as any)).rejects.toThrow('Cancellazione account in corso');

        expect(useAppStore.getState().userData?.profile?.height).toBe('176');
    });

    it('resetStore clears memory state without manual storage deletion', () => {
        const store = useAppStore.getState();
        store.resetStore();

        expect(useAppStore.getState().userData).toBeNull();
        expect(useAppStore.getState().localWorkout).toBeNull();
        expect(useAppStore.getState().syncing).toBe(false);
        expect(useAppStore.getState().saveError).toBeNull();
    });
    it('refuses authenticated logout before signOut when a deletion receipt is pending', async () => {
        const owner = storageOwner();
        expect(owner.startsWith('user:')).toBe(true);
        markAccountDeletion(owner, { receiptToken: 'A'.repeat(43), serverAcceptedAt: Date.now() });
        localStorage.setItem('logbook:v2:' + owner + ':workout', 'recoverable');

        await expect(DB.secureLogOut()).rejects.toThrow('Cancellazione account in sospeso');

        const { auth } = await import('../src/lib/firebase');
        expect(auth.signOut).not.toHaveBeenCalled();
        expect(idb.del).not.toHaveBeenCalled();
        expect(isAccountDeletionPending(owner)).toBe(true);
        expect(localStorage.getItem('logbook:v2:' + owner + ':workout')).toBe('recoverable');
    });

});
