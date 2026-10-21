import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import * as idb from 'idb-keyval';
import { useAppStore } from '../src/store/useAppStore';
import { storageOwner } from '../src/lib/sync/session';
import { beginLocalPurge, isLocalPurgeIncomplete, isLocalPurgePending } from '../src/lib/sync/localPurgeFence';
import * as localRepository from '../src/lib/sync/localRepository';
import { localStorageMock, mockFirebaseAuth } from './setup';
import { markAccountDeletion, isAccountDeletionPending } from '../src/lib/sync/accountGate';
import { beginGuestMigrationIntent } from '../src/lib/auth/guestMigrationIntent';

vi.mock('idb-keyval', () => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn()
}));

// Mock firebase auth
vi.mock('../src/lib/firebase', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
    return {
        ...actual,
        // Share the exact Auth instance already used by session.ts. An
        // independently fabricated Auth would bypass the production UID fence.
        auth: Object.assign(actual.auth, { signOut: vi.fn() }),
        ensureAppCheck: vi.fn(),
        getDb: vi.fn()
    };
});

describe('SEC-02: Logout Cleanup & Sensitive Data Purge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Later regression cases replace the IDB implementation; prevent
        // their mock storage from becoming the next test's initial state.
        vi.mocked(idb.get).mockReset();
        vi.mocked(idb.del).mockReset();
        Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: string, _options: unknown, action: () => Promise<unknown>) => action() } });
        localStorage.clear();
    });

    it('also refuses a direct ordinary authenticated purge with a pending journal', async () => {
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{ seq: 1 }] } as any);
        try {
            await expect(DB.purgeAllLocalUserData(storageOwner())).rejects.toThrow('modifiche');
            expect(idb.del).not.toHaveBeenCalled();
            expect(isLocalPurgePending(storageOwner())).toBe(false);
        } finally { read.mockRestore(); }
    });

    it('rejects an ordinary authenticated logout when the durable journal has pending operations', async () => {
        const { auth } = await import('../src/lib/firebase');
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{ seq: 1 }] } as any);
        try {
            await expect(DB.secureLogOut()).rejects.toThrow('modifiche');
            expect(auth.signOut).not.toHaveBeenCalled();
            expect(idb.del).not.toHaveBeenCalled();
            expect(isLocalPurgePending(storageOwner())).toBe(false);
        } finally { read.mockRestore(); }
    });

    it('allows explicitly discarded pending changes but still completes the fenced sign-out', async () => {
        const { auth } = await import('../src/lib/firebase');
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{ seq: 1 }] } as any);
        try {
            await DB.secureLogOut({ discardUnsynced: true });
            expect(auth.signOut).toHaveBeenCalledTimes(1);
            expect(idb.del).toHaveBeenCalledWith('logbook:v2:' + storageOwner());
            expect(isLocalPurgePending(storageOwner())).toBe(true);
        } finally { read.mockRestore(); }
    });

    it('never signs out or purges a different account than the requester', async () => {
        const { auth } = await import('../src/lib/firebase');
        await expect(DB.secureLogOut({ expectedUid: 'another-account' })).rejects.toThrow('sessione non valida');
        expect(auth.signOut).not.toHaveBeenCalled();
        expect(idb.del).not.toHaveBeenCalled();
    });

    it('restores write access when Firebase sign-out fails before deleting anything', async () => {
        const { auth } = await import('../src/lib/firebase');
        vi.mocked(auth.signOut).mockRejectedValueOnce(new Error('Network offline'));
        await expect(DB.secureLogOut()).rejects.toThrow('Network offline');
        expect(idb.del).not.toHaveBeenCalled();
        expect(isLocalPurgePending(storageOwner())).toBe(false);
    });

    it('rechecks the journal after pending UI drafts have flushed', async () => {
        const { auth } = await import('../src/lib/firebase');
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{ seq: 2 }] } as any);
        const verifyCurrentDrafts = vi.fn(async () => undefined);
        try {
            await expect(DB.secureLogOut({ verifyCurrentDrafts })).rejects.toThrow('modifiche');
            expect(verifyCurrentDrafts).toHaveBeenCalledTimes(1);
            expect(auth.signOut).not.toHaveBeenCalled();
        } finally { read.mockRestore(); }
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
        // An explicit guest reset belongs to a guest session, not the
        // authenticated fixture used by the other logout tests.
        mockFirebaseAuth.currentUser = null;
        localStorage.setItem('logbook_is_guest', 'true');

        await DB.purgeAllLocalUserData('guest');

        sensitiveKeys.forEach(k => {
            expect(localStorage.getItem(k)).toBeNull();
        });

        deviceKeys.forEach(k => {
            expect(localStorage.getItem(k)).toBe('device_pref');
        });
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
        vi.mocked(idb.del).mockImplementationOnce(async () => {
            entered();
            await pendingDelete;
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

    it('preserves a new Google redirect marker started while the previous owner purge awaits IndexedDB', async () => {
        let entered!: () => void;
        let release!: () => void;
        const requested = new Promise<void>(resolve => { entered = resolve; });
        const pendingDelete = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(idb.del).mockImplementationOnce(async key => {
            expect(key).toBe('logbook:v2:user:test-user-id');
            entered();
            await pendingDelete;
        });

        localStorage.setItem('draft_measurement', 'previous-owner-legacy');
        const operation = DB.purgeAllLocalUserData();
        await requested;
        // The next login can begin before its Firebase UID is available:
        // its shared redirect flag must never be cleared by the old purge.
        localStorage.setItem('logbook_awaiting_redirect', 'true');

        release();
        await operation;

        expect(localStorage.getItem('logbook_awaiting_redirect')).toBe('true');
        expect(localStorage.getItem('draft_measurement')).toBeNull();
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('still removes a failed non-active redirect marker on logout', async () => {
        localStorage.setItem('logbook_awaiting_redirect', 'failed');
        await DB.purgeAllLocalUserData();
        expect(localStorage.getItem('logbook_awaiting_redirect')).toBeNull();
    });

    it('preserves a new unscoped legacy draft written during the IndexedDB purge wait', async () => {
        let started!: () => void;
        let finish!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; });
        const blocked = new Promise<void>(resolve => { finish = resolve; });
        vi.mocked(idb.del).mockImplementationOnce(async () => {
            started();
            await blocked;
        });
        const operation = DB.purgeAllLocalUserData();
        await entered;
        // No new Firebase UID is available yet; the identity fence alone
        // cannot establish provenance of this global legacy value.
        localStorage.setItem('draft_exercise', 'new-session-draft');
        finish();

        await expect(operation).rejects.toThrow('Pulizia locale incompleta');
        expect(localStorage.getItem('draft_exercise')).toBe('new-session-draft');
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('keeps a concurrently replaced guest Auth intent without blocking unrelated account cleanup', async () => {
        localStorage.setItem('guest_migration_intent_v1', 'old-session-intent');
        let started!: () => void;
        let finish!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; });
        const blocked = new Promise<void>(resolve => { finish = resolve; });
        vi.mocked(idb.del).mockImplementationOnce(async () => {
            started();
            await blocked;
        });
        const operation = DB.purgeAllLocalUserData();
        await entered;
        localStorage.setItem('guest_migration_intent_v1', 'new-session-intent');
        finish();

        await expect(operation).resolves.toBeUndefined();
        expect(localStorage.getItem('guest_migration_intent_v1')).toBe('new-session-intent');
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('stops on a new legacy value introduced during a prior localStorage removal', async () => {
        const priorRemoval = localStorageMock.removeItem.getMockImplementation()!;
        let introduced = false;
        localStorageMock.removeItem.mockImplementation((key: string) => {
            priorRemoval(key);
            if (!introduced && key === 'logbook_local_workout') {
                introduced = true;
                localStorage.setItem('draft_routine', 'new-tab-draft');
            }
        });
        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('Pulizia locale incompleta');
        expect(introduced).toBe(true);
        expect(localStorage.getItem('draft_routine')).toBe('new-tab-draft');
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('never re-adopts a new unscoped draft as old-owner data on a later purge retry', async () => {
        let started!: () => void;
        let finish!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; });
        const blocked = new Promise<void>(resolve => { finish = resolve; });
        vi.mocked(idb.del).mockImplementationOnce(async () => { started(); await blocked; });
        const operation = DB.purgeAllLocalUserData();
        await entered;
        localStorage.setItem('draft_exercise', 'new-owner-draft-after-fence');
        finish();
        await expect(operation).rejects.toThrow('Pulizia locale incompleta');
        const fingerprintKey = 'logbook:local-purge-legacy-snapshot:v1:user:test-user-id';
        const recorded = localStorage.getItem(fingerprintKey);
        expect(recorded).not.toBeNull();
        expect(recorded).not.toContain('new-owner-draft-after-fence');

        // Simulate a full reload: no in-memory baseline survives. Before this
        // regression, the next invocation silently chose a fresh baseline and
        // destroyed the previously preserved new-owner draft.
        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('senza provenienza');
        expect(localStorage.getItem('draft_exercise')).toBe('new-owner-draft-after-fence');
        expect(localStorage.getItem(fingerprintKey)).toBe(recorded);
        expect(isLocalPurgeIncomplete('user:test-user-id')).toBe(true);
    });

    it('retains a replaced legacy ownerless policy across repeated purge attempts', async () => {
        localStorage.setItem('guest_migration_policy', 'old-intent');
        let started!: () => void;
        let finish!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; });
        const blocked = new Promise<void>(resolve => { finish = resolve; });
        vi.mocked(idb.del).mockImplementationOnce(async () => { started(); await blocked; });
        const operation = DB.purgeAllLocalUserData();
        await entered;
        localStorage.setItem('guest_migration_policy', 'new-intent');
        finish();
        await expect(operation).rejects.toThrow('Pulizia locale incompleta');
        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('senza provenienza');
        expect(localStorage.getItem('guest_migration_policy')).toBe('new-intent');
        expect(isLocalPurgeIncomplete('user:test-user-id')).toBe(true);
    });

    it('refuses to manufacture provenance for an old incomplete purge without a durable snapshot', async () => {
        beginLocalPurge('user:test-user-id');
        localStorage.setItem('draft_measurement', 'unattributed-old-draft');
        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('Provenienza delle chiavi legacy');
        expect(idb.del).not.toHaveBeenCalled();
        expect(localStorage.getItem('draft_measurement')).toBe('unattributed-old-draft');
    });

    it('resumes a stable original legacy snapshot after an IndexedDB failure and cleans its metadata', async () => {
        const owner = 'user:test-user-id';
        const fingerprintKey = 'logbook:local-purge-legacy-snapshot:v1:' + owner;
        localStorage.setItem('draft_measurement', 'original-owner-draft');
        vi.mocked(idb.del).mockRejectedValueOnce(new Error('temporary IndexedDB error'));
        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('Pulizia locale incompleta');
        expect(localStorage.getItem('draft_measurement')).toBe('original-owner-draft');
        expect(localStorage.getItem(fingerprintKey)).not.toBeNull();

        await DB.purgeAllLocalUserData();
        expect(localStorage.getItem('draft_measurement')).toBeNull();
        expect(localStorage.getItem(fingerprintKey)).toBeNull();
        expect(isLocalPurgeIncomplete(owner)).toBe(false);
        expect(isLocalPurgePending(owner)).toBe(true);
    });

    it('does not claim a guest migration intent as data belonging to an authenticated owner', async () => {
        // Auth creates this ownerless intent before an account UID exists.
        // A different account's purge has no proof it owns the intent, even
        // when the intent predates the purge and the shared value is stable.
        const intent = beginGuestMigrationIntent('merge', 'google');
        const raw = localStorage.getItem('guest_migration_intent_v1');
        expect(raw).toContain(intent.id);

        await DB.purgeAllLocalUserData('user:test-user-id');

        expect(localStorage.getItem('guest_migration_intent_v1')).toBe(raw);
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('preserves guest migration ownership through an interrupted account purge and a retry', async () => {
        const intent = beginGuestMigrationIntent('skip', 'email', { email: 'other@example.test' });
        const raw = localStorage.getItem('guest_migration_intent_v1');
        vi.mocked(idb.del).mockRejectedValueOnce(new Error('interrupted IndexedDB cleanup'));

        await expect(DB.purgeAllLocalUserData('user:test-user-id')).rejects.toThrow('Pulizia locale incompleta');
        const frozen = localStorage.getItem('logbook:local-purge-legacy-snapshot:v1:user:test-user-id');
        expect(frozen).not.toBeNull();
        // A newly created snapshot records null for guest/Auth ownership.
        const record = JSON.parse(frozen!) as { hashes: Array<string | null> };
        expect(record.hashes[11]).toBeNull();
        expect(localStorage.getItem('guest_migration_intent_v1')).toBe(raw);

        await DB.purgeAllLocalUserData('user:test-user-id');

        expect(localStorage.getItem('guest_migration_intent_v1')).toBe(raw);
        expect(raw).toContain(intent.id);
        expect(localStorage.getItem('logbook:local-purge-legacy-snapshot:v1:user:test-user-id')).toBeNull();
    });

    it('resumes an older fingerprint snapshot without claiming guest/Auth ownership', async () => {
        const owner = 'user:test-user-id';
        const key = 'logbook:local-purge-legacy-snapshot:v1:' + owner;
        const original = beginGuestMigrationIntent('merge', 'google');
        const raw = localStorage.getItem('guest_migration_intent_v1');
        // A frozen snapshot from 1.114.0 could have tracked the ownerless
        // guest intent. It is not proof that the old account owned it.
        const hashes: (string | null)[] = Array(13).fill(null);
        hashes[11] = 'a'.repeat(64);
        localStorage.setItem(key, JSON.stringify({ version: 1, owner, hashes }));
        beginLocalPurge(owner);

        await DB.purgeAllLocalUserData(owner);

        expect(localStorage.getItem('guest_migration_intent_v1')).toBe(raw);
        expect(raw).toContain(original.id);
        expect(localStorage.getItem(key)).toBeNull();
        expect(isLocalPurgePending(owner)).toBe(true);
    });

    it('purges only owner-scoped IndexedDB data when no ambiguous legacy record exists', async () => {
        await DB.purgeAllLocalUserData();
        expect(idb.del).toHaveBeenCalledWith('logbook:v2:user:test-user-id');
        for (const key of ['logbook_cached_user_data', 'pending_sync_token', 'pending_sync_payload', 'sync_failed']) {
            expect(idb.del).not.toHaveBeenCalledWith(key);
            expect(idb.get).toHaveBeenCalledWith(key);
        }
    });

    it.each(['logbook_cached_user_data', 'pending_sync_token', 'pending_sync_payload', 'sync_failed'])(
        'refuses to purge unowned legacy IndexedDB data in %s before deleting anything', async key => {
            const foreignRecord = { owner: 'new-session', data: 'preserve' };
            vi.mocked(idb.get).mockImplementation(async name => name === key ? foreignRecord : undefined);
            await expect(DB.purgeAllLocalUserData()).rejects.toThrow('senza proprietario verificabile');
            expect(idb.del).not.toHaveBeenCalled();
            expect(await idb.get(key)).toBe(foreignRecord);
            expect(isLocalPurgeIncomplete('user:test-user-id')).toBe(true);
        },
    );

    it('retains a global IDB value written by a legacy tab while owner deletion is in flight', async () => {
        const records = new Map<string, unknown>();
        const foreignRecord = { owner: 'next-account', payload: 'do-not-delete' };
        let entered!: () => void;
        let release!: () => void;
        const pending = new Promise<void>(resolve => { entered = resolve; });
        const resume = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(idb.get).mockImplementation(async key => records.get(String(key)));
        vi.mocked(idb.del).mockImplementation(async key => {
            if (key === 'logbook:v2:user:test-user-id') {
                entered();
                await resume;
            }
            records.delete(String(key));
        });

        const first = DB.purgeAllLocalUserData();
        await pending;
        records.set('pending_sync_payload', foreignRecord);
        release();
        await expect(first).rejects.toThrow('senza proprietario verificabile');
        expect(records.get('pending_sync_payload')).toBe(foreignRecord);
        expect(idb.del).toHaveBeenCalledTimes(1);
        expect(isLocalPurgeIncomplete('user:test-user-id')).toBe(true);

        // Reload/retry must not adopt the foreign payload and delete it.
        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('senza proprietario verificabile');
        expect(records.get('pending_sync_payload')).toBe(foreignRecord);
        expect(idb.del).toHaveBeenCalledTimes(1);
    });

    it('refuses legacy IDB data discovered during the finalization phase', async () => {
        const foreignRecord = { owner: 'new-guest' };
        let reads = 0;
        vi.mocked(idb.get).mockImplementation(async key => {
            if (key === 'sync_failed' && ++reads >= 3) return foreignRecord;
            return undefined;
        });
        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('senza proprietario verificabile');
        expect(idb.del).not.toHaveBeenCalledWith('sync_failed');
        expect(isLocalPurgeIncomplete('user:test-user-id')).toBe(true);
    });

    it('preserves a new account recovery UID swapped during the old owner purge inventory', async () => {
        const recoveryKey = 'logbook_guest_migration_sync_recovery';
        localStorage.setItem(recoveryKey, 'test-user-id');
        const originalGet = localStorageMock.getItem.getMockImplementation()!;
        let switched = false;
        localStorageMock.getItem.mockImplementation((key: string) => {
            const value = originalGet(key);
            if (key === recoveryKey && value === 'test-user-id' && !switched) {
                switched = true;
                localStorage.setItem(recoveryKey, 'second-user');
            }
            return value;
        });

        await DB.purgeAllLocalUserData('user:test-user-id');

        expect(switched).toBe(true);
        expect(localStorage.getItem(recoveryKey)).toBe('second-user');
        expect(isLocalPurgePending('user:test-user-id')).toBe(true);
    });

    it('purgeAllLocalUserData removes only the current owner guest migration recovery marker', async () => {
        localStorage.setItem('logbook_guest_migration_sync_recovery', 'test-user-id');
        await DB.purgeAllLocalUserData(storageOwner());
        expect(localStorage.getItem('logbook_guest_migration_sync_recovery')).toBeNull();

        localStorage.setItem('logbook_guest_migration_sync_recovery', 'another-user');
        await DB.purgeAllLocalUserData(storageOwner());
        expect(localStorage.getItem('logbook_guest_migration_sync_recovery')).toBe('another-user');
    });

    it('purgeAllLocalUserData preserves local recovery data if IndexedDB deletion fails', async () => {
        vi.mocked(idb.del).mockRejectedValueOnce(new Error('IndexedDB quota exceeded'));
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        localStorage.setItem('draft_measurement', 'draft_data');

        await expect(DB.purgeAllLocalUserData()).rejects.toThrow('Pulizia locale incompleta');

        // Deleting drafts before the IndexedDB failure is resolved can orphan
        // the encrypted journal. All remaining local bytes stay recoverable.
        expect(localStorage.getItem('draft_measurement')).toBe('draft_data');
        expect(isLocalPurgePending(storageOwner())).toBe(true);

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
            if (!compacted && index === 0 && storageKey === first) {
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
        localStorage.setItem('logbook_local_workout', 'data');

        await DB.purgeAllLocalUserData();
        expect(localStorage.getItem('logbook_local_workout')).toBeNull();

        await expect(DB.purgeAllLocalUserData()).resolves.toBeUndefined();
        
        expect(consoleWarnSpy).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
    });

    it('keeps a pending cloud withdrawal and archive intact before any account sign-out or ordinary purge', async () => {
        const { auth } = await import('../src/lib/firebase');
        const owner = storageOwner();
        expect(owner.startsWith('user:')).toBe(true);
        const marker = `logbook:v2:${owner}:health-consent-withdrawal`;
        localStorage.setItem(marker, 'pending:0');
        const purgeSpy = vi.spyOn(DB, 'purgeAllLocalUserData');

        await expect(DB.secureLogOut()).rejects.toThrow('non è ancora riconciliata');
        await expect(DB.purgeAllLocalUserData(owner)).rejects.toThrow('non è ancora riconciliata');
        expect(auth.signOut).not.toHaveBeenCalled();
        expect(idb.del).not.toHaveBeenCalled();
        expect(purgeSpy).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(marker)).toBe('pending:0');
        purgeSpy.mockRestore();
    });

    it('accepts a verified positive consent generation when the journal is clean', async () => {
        const { auth } = await import('../src/lib/firebase');
        const owner = storageOwner();
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({
            pending: [], consentRevision: 12,
        } as any);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '12');

        try {
            await DB.secureLogOut();
            expect(auth.signOut).toHaveBeenCalledTimes(1);
            expect(idb.del).toHaveBeenCalledWith('logbook:v2:' + owner);
        } finally {
            read.mockRestore();
        }
    });

    it('rejects malformed and unsafe consent revisions without sign-out or purge', async () => {
        const { auth } = await import('../src/lib/firebase');
        const owner = storageOwner();
        const key = `logbook:v2:${owner}:health-consent-generation`;
        for (const revision of ['0', '01', '1junk', '9007199254740992']) {
            localStorage.setItem(key, revision);
            await expect(DB.secureLogOut({ discardUnsynced: true }))
                .rejects.toThrow('non è ancora riconciliata');
            expect(auth.signOut).not.toHaveBeenCalled();
            expect(idb.del).not.toHaveBeenCalled();
            expect(localStorage.getItem(key)).toBe(revision);
            expect(isLocalPurgePending(owner)).toBe(false);
        }
    });

    it('preserves a previous-epoch pending journal even if forced logout is requested', async () => {
        const { auth } = await import('../src/lib/firebase');
        const owner = storageOwner();
        const key = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(key, '2');
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({
            pending: [{ seq: 1 }], consentRevision: 1,
        } as any);

        try {
            await expect(DB.secureLogOut({ discardUnsynced: true }))
                .rejects.toThrow('non è ancora riconciliata');
            expect(auth.signOut).not.toHaveBeenCalled();
            expect(idb.del).not.toHaveBeenCalled();
            expect(localStorage.getItem(key)).toBe('2');
            expect(isLocalPurgePending(owner)).toBe(false);
        } finally {
            read.mockRestore();
        }
    });

    it('keeps a clean account intact if another tab withdraws consent during the journal read', async () => {
        const { auth } = await import('../src/lib/firebase');
        const owner = storageOwner();
        const marker = `logbook:v2:${owner}:health-consent-withdrawal`;
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '2');
        let resolveRead!: (value: Awaited<ReturnType<typeof localRepository.readLocal>>) => void;
        const read = vi.spyOn(localRepository, 'readLocal').mockImplementationOnce(
            () => new Promise<Awaited<ReturnType<typeof localRepository.readLocal>>>(
                resolve => { resolveRead = resolve; },
            ),
        );
        try {
            const logout = DB.secureLogOut();
            await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
            localStorage.setItem(marker, 'pending:2');
            resolveRead(undefined);
            await expect(logout).rejects.toThrow('non è ancora riconciliata');
            expect(auth.signOut).not.toHaveBeenCalled();
            expect(idb.del).not.toHaveBeenCalled();
            expect(localStorage.getItem(marker)).toBe('pending:2');
            expect(isLocalPurgePending(owner)).toBe(false);
        } finally {
            read.mockRestore();
        }
    });

    it('allows an ordinary logout after server-confirmed withdrawal', async () => {
        const { auth } = await import('../src/lib/firebase');
        const owner = storageOwner();
        expect(owner.startsWith('user:')).toBe(true);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-withdrawal`, 'withdrawn');
        await DB.secureLogOut();
        expect(auth.signOut).toHaveBeenCalledTimes(1);
        expect(idb.del).toHaveBeenCalledWith(`logbook:v2:${owner}`);
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
        // The guarded logout owns the purge directly under the Web Lock; fail
        // its actual IndexedDB deletion boundary instead of spying on the old hook.
        vi.mocked(idb.del).mockRejectedValueOnce(new Error('local purge failed'));

        await expect(DB.secureLogOut()).rejects.toThrow('Pulizia locale incompleta');
        expect(localStorage.getItem(recoveryKey)).not.toBeNull();
        expect(isLocalPurgePending(owner)).toBe(true);
    });

    it('secureLogOut preserves the local archive and rejects when auth.signOut fails', async () => {
        const { auth } = await import('../src/lib/firebase');
        vi.mocked(auth.signOut).mockRejectedValueOnce(new Error('Network offline'));
        
        await expect(DB.secureLogOut()).rejects.toThrow('Network offline');
        expect(idb.del).not.toHaveBeenCalled();
        expect(isLocalPurgePending(storageOwner())).toBe(false);
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
