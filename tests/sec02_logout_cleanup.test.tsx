import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import * as idb from 'idb-keyval';
import { useAppStore } from '../src/store/useAppStore';
import { storageOwner } from '../src/lib/sync/session';
import { isLocalPurgeIncomplete, isLocalPurgePending } from '../src/lib/sync/localPurgeFence';
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

// vi.clearAllMocks does not restore mockImplementation. Reset functions changed by
// concurrency tests so their instrumentation cannot leak across test cases.
const originalStorageKey = localStorageMock.key.getMockImplementation()!;
const originalStorageRemove = localStorageMock.removeItem.getMockImplementation()!;

describe('SEC-02: Logout Cleanup & Sensitive Data Purge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorageMock.key.mockImplementation(originalStorageKey);
        localStorageMock.removeItem.mockImplementation(originalStorageRemove);
        localStorage.removeItem = localStorageMock.removeItem;
        // Later regression cases replace the IDB implementation; prevent
        // their mock storage from becoming the next test's initial state.
        vi.mocked(idb.get).mockReset();
        vi.mocked(idb.del).mockReset();
        Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: string, _options: unknown, action: () => Promise<unknown>) => action() } });
        localStorage.clear();
    });
    afterEach(() => {
        localStorageMock.key.mockImplementation(originalStorageKey);
        localStorageMock.removeItem.mockImplementation(originalStorageRemove);
        localStorage.removeItem = localStorageMock.removeItem;
    });

    it('starts with a working storage enumeration and deletion mock', () => {
        const key = 'logbook:v2:user:test-user-id:draft:baseline';
        localStorage.setItem(key, 'ciphertext');
        expect(localStorage.key(0)).toBe(key);
        localStorage.removeItem(key);
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('does not adopt pre-launch business or IDB globals in owner cleanup', async () => {
        const unsupported = ['logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start',
            'logbook_timer_accumulated', 'draft_measurement', 'draft_exercise', 'draft_routine'];
        for (const key of unsupported) localStorage.setItem(key, 'prelaunch');
        vi.mocked(idb.get).mockImplementation(async key => key === 'pending_sync_payload' ? { old: true } : undefined);
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
        localStorage.setItem('logbook:v2:user:test-user-id:draft:once', 'data');

        await DB.purgeAllLocalUserData();
        expect(localStorage.getItem('logbook:v2:user:test-user-id:draft:once')).toBeNull();

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
