import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import * as idb from 'idb-keyval';
import { useAppStore } from '../src/store/useAppStore';

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
            'guest_migration_policy'
        ];

        const deviceKeys = [
            'logbook_ios_install_prompt',
            'logbook_analytics_consent'
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

    it('purgeAllLocalUserData is idempotent (safe to call twice)', async () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.setItem('logbook_local_workout', 'data');

        await DB.purgeAllLocalUserData();
        expect(localStorage.getItem('logbook_local_workout')).toBeNull();

        await expect(DB.purgeAllLocalUserData()).resolves.toBeUndefined();
        
        expect(consoleWarnSpy).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
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

    it('resetStore clears memory state without manual storage deletion', () => {
        const store = useAppStore.getState();
        store.resetStore();

        expect(useAppStore.getState().userData).toBeNull();
        expect(useAppStore.getState().localWorkout).toBeNull();
        expect(useAppStore.getState().syncing).toBe(false);
        expect(useAppStore.getState().saveError).toBeNull();
    });
});
