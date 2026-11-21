import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DB, idb, storageOwner, isLocalPurgeIncomplete, isLocalPurgePending,
  localStorageMock, mockFirebaseAuth, originalIdbGet, originalIdbDel,
  beginGuestMigrationIntent, resetLogoutFixture, restoreLogoutFixture,
} from './sec02LogoutHarness';

describe('SEC-02: owner-scoped local purge and cross-session isolation', () => {
  beforeEach(resetLogoutFixture);
  afterEach(restoreLogoutFixture);

    it('purges the current owner draft through production without deleting another owner', async () => {
        const ownerKey = 'logbook:v2:user:test-user-id:draft:baseline';
        const foreignKey = 'logbook:v2:user:another-user:draft:private';
        localStorage.setItem(ownerKey, 'sealed-owner-data');
        localStorage.setItem(foreignKey, 'sealed-foreign-data');

        await DB.purgeAllLocalUserData('user:test-user-id');

        expect(localStorage.getItem(ownerKey)).toBeNull();
        expect(localStorage.getItem(foreignKey)).toBe('sealed-foreign-data');
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('does not adopt pre-launch business or IDB globals in owner cleanup', async () => {
        const unsupported = ['logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start',
            'logbook_timer_accumulated', 'draft_measurement', 'draft_exercise', 'draft_routine'];
        for (const key of unsupported) localStorage.setItem(key, 'prelaunch');
        vi.mocked(idb.get).mockImplementation(async key =>
            key === 'pending_sync_payload' ? { old: true } : originalIdbGet(key));
        localStorage.setItem('logbook:v2:user:test-user-id:draft:current', 'owner');

        await DB.purgeAllLocalUserData('user:test-user-id');

        for (const key of unsupported) expect(localStorage.getItem(key)).toBe('prelaunch');
        expect(localStorage.getItem('logbook:v2:user:test-user-id:draft:current')).toBeNull();
        expect(idb.del).toHaveBeenCalledWith('logbook:v2:user:test-user-id');
        expect(idb.del).not.toHaveBeenCalledWith('pending_sync_payload');
        expect(idb.get).not.toHaveBeenCalledWith('pending_sync_payload');
        expect(isLocalPurgeIncomplete('user:test-user-id')).toBe(false);
    });

    it('never erases active or failed Google redirect state as part of owner purge', async () => {
        for (const value of ['true', 'failed']) {
            sessionStorage.setItem('logbook_awaiting_redirect', value);
            await DB.purgeAllLocalUserData();
            expect(sessionStorage.getItem('logbook_awaiting_redirect')).toBe(value);
        }
    });


    it('rejects ordinary cleanup of a different authenticated owner even with no pending journal', async () => {
        const foreignOwner = 'user:different-user';
        const foreignDraft = `logbook:v2:${foreignOwner}:draft:protected`;
        localStorage.setItem(foreignDraft, 'foreign-ciphertext');

        await expect(DB.purgeAllLocalUserData(foreignOwner)).rejects.toThrow('La pulizia locale resta sospesa');

        expect(localStorage.getItem(foreignDraft)).toBe('foreign-ciphertext');
        expect(idb.del).not.toHaveBeenCalled();
        expect(isLocalPurgePending(foreignOwner)).toBe(false);
    });

    it('still clears guest-owned data and the Auth handoff when no ownerless business data exists', async () => {
        mockFirebaseAuth.currentUser = null;
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem('guest_migration_intent_v1', 'guest-auth-intent');
        localStorage.setItem('logbook_ios_install_prompt', 'device-pref');
        localStorage.setItem('logbook:v2:guest:draft:private', 'guest-private-draft');
        await DB.purgeAllLocalUserData('guest');
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem('guest_migration_intent_v1')).toBeNull();
        expect(localStorage.getItem('logbook:v2:guest:draft:private')).toBeNull();
        expect(localStorage.getItem('logbook_ios_install_prompt')).toBe('device-pref');
    });

    it('stops before shared IndexedDB and localStorage cleanup when Auth changes during owner IDB deletion', async () => {
        const previous = mockFirebaseAuth.currentUser!;
        let entered!: () => void;
        let release!: () => void;
        const requested = new Promise<void>(resolve => { entered = resolve; });
        const pendingDelete = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(idb.del).mockImplementationOnce(async key => {
            expect(key).toBe('logbook:v2:user:test-user-id');
            entered();
            await pendingDelete;
            await originalIdbDel(key);
        });

        const operation = DB.purgeAllLocalUserData();
        await requested;
        mockFirebaseAuth.currentUser = { ...previous, uid: 'second-user' };
        localStorage.setItem('guest_migration_intent_v1', 'second-user-new-login');

        release();
        await expect(operation).rejects.toThrow('La pulizia locale resta sospesa');
        expect(idb.del).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('guest_migration_intent_v1')).toBe('second-user-new-login');
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('stops before shared storage cleanup when a guest activates during old account IDB deletion', async () => {
        let entered!: () => void;
        let release!: () => void;
        const requested = new Promise<void>(resolve => { entered = resolve; });
        const pendingDelete = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(idb.del).mockImplementationOnce(async key => {
            entered();
            await pendingDelete;
            await originalIdbDel(key);
        });

        const operation = DB.purgeAllLocalUserData();
        await requested;
        mockFirebaseAuth.currentUser = null;
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem('draft_measurement', 'new-guest-measurement');

        release();
        await expect(operation).rejects.toThrow('La pulizia locale resta sospesa');
        expect(idb.del).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('draft_measurement')).toBe('new-guest-measurement');
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('keeps a concurrently replaced guest Auth intent without blocking unrelated account cleanup', async () => {
        localStorage.setItem('guest_migration_intent_v1', 'old-session-intent');
        let started!: () => void;
        let finish!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; });
        const blocked = new Promise<void>(resolve => { finish = resolve; });
        vi.mocked(idb.del).mockImplementationOnce(async key => {
            started();
            await blocked;
            await originalIdbDel(key);
        });
        const operation = DB.purgeAllLocalUserData();
        await entered;
        localStorage.setItem('guest_migration_intent_v1', 'new-session-intent');
        finish();

        await expect(operation).resolves.toBeUndefined();
        expect(localStorage.getItem('guest_migration_intent_v1')).toBe('new-session-intent');
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('does not claim a guest migration intent as data belonging to an authenticated owner', async () => {
        // Auth creates this ownerless intent before an account UID exists.
        // A different account's purge has no proof it owns the intent, even
        // when the intent predates the purge and the shared value is stable.
        const intent = await beginGuestMigrationIntent('merge', 'google');
        const raw = localStorage.getItem('guest_migration_intent_v1');
        expect(raw).toContain(intent.id);

        await DB.purgeAllLocalUserData('user:test-user-id');

        expect(localStorage.getItem('guest_migration_intent_v1')).toBe(raw);
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('preserves guest migration ownership through an interrupted account purge and a retry', async () => {
        const intent = await beginGuestMigrationIntent('skip', 'email', { email: 'other@example.test' });
        const raw = localStorage.getItem('guest_migration_intent_v1');
        vi.mocked(idb.del).mockRejectedValueOnce(new Error('interrupted IndexedDB cleanup'));

        await expect(DB.purgeAllLocalUserData('user:test-user-id')).rejects.toThrow('Pulizia locale incompleta');
        expect(localStorage.getItem('guest_migration_intent_v1')).toBe(raw);

        await DB.purgeAllLocalUserData('user:test-user-id');

        expect(localStorage.getItem('guest_migration_intent_v1')).toBe(raw);
        expect(raw).toContain(intent.id);
    });

    it('purges only owner-scoped IndexedDB data when no ambiguous legacy record exists', async () => {
        await DB.purgeAllLocalUserData();
        expect(idb.del).toHaveBeenCalledWith('logbook:v2:user:test-user-id');
        for (const key of ['logbook_cached_user_data', 'pending_sync_token', 'pending_sync_payload', 'sync_failed']) {
            expect(idb.del).not.toHaveBeenCalledWith(key);
            expect(idb.get).not.toHaveBeenCalledWith(key);
        }
    });

    it('cannot delete another account recovery handoff created during owner purge', async () => {
        const keyA = 'logbook:v2:user:test-user-id:guest-migration-sync-recovery';
        const keyB = 'logbook:v2:user:second-user:guest-migration-sync-recovery';
        localStorage.setItem(keyA, JSON.stringify({ version: 1, uid: 'test-user-id', guestSessionId: 'guest-a', id: 'proof-a' }));
        const originalRemove = localStorageMock.removeItem.getMockImplementation()!;
        let switched = false;
        localStorageMock.removeItem.mockImplementation((key: string) => {
            if (key === keyA && !switched) {
                switched = true;
                localStorage.setItem(keyB, JSON.stringify({ version: 1, uid: 'second-user', guestSessionId: 'guest-b', id: 'proof-b' }));
            }
            originalRemove(key);
        });

        await DB.purgeAllLocalUserData('user:test-user-id');

        expect(switched).toBe(true);
        expect(localStorage.getItem(keyA)).toBeNull();
        expect(JSON.parse(localStorage.getItem(keyB)!)).toMatchObject({ uid: 'second-user' });
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('purgeAllLocalUserData removes the owner recovery marker but preserves a different UID', async () => {
        const keyA = 'logbook:v2:user:test-user-id:guest-migration-sync-recovery';
        const keyB = 'logbook:v2:user:another-user:guest-migration-sync-recovery';
        localStorage.setItem(keyA, JSON.stringify({ version: 1, uid: 'test-user-id', guestSessionId: 'guest-a', id: 'proof-a' }));
        localStorage.setItem(keyB, JSON.stringify({ version: 1, uid: 'another-user', guestSessionId: 'guest-b', id: 'proof-b' }));

        await DB.purgeAllLocalUserData(storageOwner());

        expect(localStorage.getItem(keyA)).toBeNull();
        expect(JSON.parse(localStorage.getItem(keyB)!)).toMatchObject({ uid: 'another-user' });
    });

    it('purgeAllLocalUserData preserves local recovery data if IndexedDB deletion fails', async () => {
        vi.mocked(idb.del).mockRejectedValueOnce(new Error('IndexedDB quota exceeded'));
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        localStorage.setItem('logbook:v2:user:test-user-id:draft:current', 'draft_data');

        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('Pulizia locale incompleta');

        // Deleting drafts before the IndexedDB failure is resolved can orphan
        // the encrypted journal. All remaining local bytes stay recoverable.
        expect(localStorage.getItem('logbook:v2:user:test-user-id:draft:current')).toBe('draft_data');
        expect(isLocalPurgePending(storageOwner())).toBe(true);

        consoleWarnSpy.mockRestore();
    });

    it('purgeAllLocalUserData iterates gracefully through localStorage keys even if one throws an error (best-effort per key)', async () => {
        // Force localStorage.removeItem to throw on the first sensitive key
        const originalRemoveItem = localStorage.removeItem;
        let throwCount = 0;
        localStorage.removeItem = vi.fn((key: string) => {
            if (key === 'logbook:v2:user:test-user-id:draft:first' && throwCount === 0) {
                throwCount++;
                throw new Error('Simulated localStorage error');
            }
            originalRemoveItem.call(localStorage, key);
        });

        localStorage.setItem('logbook:v2:user:test-user-id:draft:first', 'data');
        localStorage.setItem('logbook:v2:user:test-user-id:draft:second', 'draft');
        
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('Pulizia locale incompleta');
        // Ensure subsequent keys were still deleted
        expect(localStorage.getItem('logbook:v2:user:test-user-id:draft:second')).toBeNull();

        localStorage.removeItem = originalRemoveItem;
        consoleWarnSpy.mockRestore();
    });

    it('purgeAllLocalUserData preserves the remaining draft when the key list shifts and safely resumes', async () => {
        const owner = 'user:test-user-id';
        const first = `logbook:v2:${owner}:draft:a`;
        const second = `logbook:v2:${owner}:draft:b`;
        localStorage.setItem(first, 'a');
        localStorage.setItem(second, 'b');

        const originalKey = localStorageMock.key.getMockImplementation()!;
        let compacted = false;
        localStorageMock.key.mockImplementation((index: number) => {
            const storageKey = originalKey(index);
            if (!compacted && storageKey === first) {
                compacted = true;
                localStorage.removeItem(first);
            }
            return storageKey;
        });

        // The old index scan could skip the second draft. A concurrent
        // compaction invalidates the inventory, not the recoverable data.
        await expect(DB.purgeAllLocalUserData(owner)).rejects.toThrow('Pulizia locale incompleta');
        expect(compacted).toBe(true);
        expect(localStorage.getItem(first)).toBeNull();
        expect(localStorage.getItem(second)).toBe('b');
        expect(isLocalPurgePending(owner)).toBe(true);

        await DB.purgeAllLocalUserData(owner);
        expect(localStorage.getItem(second)).toBeNull();
        expect(isLocalPurgePending(owner)).toBe(true);
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
        localStorage.setItem('logbook:v2:user:test-user-id:draft:once', 'data');

        await DB.purgeAllLocalUserData();
        expect(localStorage.getItem('logbook:v2:user:test-user-id:draft:once')).toBeNull();

        await expect(DB.purgeAllLocalUserData()).resolves.toBeUndefined();
        
        expect(consoleWarnSpy).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
    });

});
