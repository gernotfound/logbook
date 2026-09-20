import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    auth: { currentUser: null as any, signOut: vi.fn() },
    appCheck: vi.fn(),
    reset: vi.fn(),
    cancel: vi.fn(),
    purge: vi.fn(),
    resetCache: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => ({
    auth: boundary.auth,
    getDb: () => ({}),
    ensureAppCheck: async () => {},
    waitForPendingWrites: vi.fn(),
}));
vi.mock('../../src/lib/appCheck', () => ({ getAppCheckToken: boundary.appCheck }));
vi.mock('../../src/store/useAppStore', () => ({
    useAppStore: { getState: () => ({ cancelPendingSyncs: boundary.cancel, resetStore: boundary.reset }) },
}));
vi.mock('../../src/lib/sync/replicateJournal', () => ({ waitForJournalIdle: vi.fn() }));

import { resumeAccountDeletion } from '../../src/lib/db/db_account';
import { isAccountDeletionPending, markAccountDeletion } from '../../src/lib/sync/accountGate';

let disk: Map<string, string>;
const receipt = 'A'.repeat(43);
const context = {
    purgeAllLocalUserData: boundary.purge,
    resetCache: boundary.resetCache,
};

function completeResponse() {
    return new Response(JSON.stringify({ uid: 'a', status: 'complete', attempts: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    disk = new Map();
    vi.stubGlobal('localStorage', {
        get length() { return disk.size; },
        key: (index: number) => [...disk.keys()][index] ?? null,
        getItem: (key: string) => disk.get(key) ?? null,
        setItem: (key: string, value: string) => disk.set(key, value),
        removeItem: (key: string) => disk.delete(key),
    });
    vi.stubGlobal('fetch', boundary.fetch);
    boundary.appCheck.mockResolvedValue('app-check-token');
    boundary.fetch.mockResolvedValue(completeResponse());
    markAccountDeletion('user:a', { receiptToken: receipt, serverAcceptedAt: Date.now() });
});

afterEach(() => { vi.unstubAllGlobals(); });

it('does not sign out or purge account B when account A completes in background', async () => {
    boundary.auth.currentUser = { uid: 'b' };

    await expect(resumeAccountDeletion(context)).resolves.toMatchObject({ status: 'pending' });

    expect(boundary.auth.signOut).not.toHaveBeenCalled();
    expect(boundary.purge).not.toHaveBeenCalled();
    expect(boundary.resetCache).not.toHaveBeenCalled();
    expect(boundary.reset).not.toHaveBeenCalled();
    expect(isAccountDeletionPending('user:a')).toBe(true);
});

it('does not purge shared local drafts while explicit guest mode is active', async () => {
    boundary.auth.currentUser = null;
    disk.set('logbook_is_guest', 'true');

    await expect(resumeAccountDeletion(context)).resolves.toMatchObject({ status: 'pending' });

    expect(boundary.auth.signOut).not.toHaveBeenCalled();
    expect(boundary.purge).not.toHaveBeenCalled();
    expect(boundary.resetCache).not.toHaveBeenCalled();
    expect(boundary.reset).not.toHaveBeenCalled();
    expect(isAccountDeletionPending('user:a')).toBe(true);
});

it('fails closed and preserves local data when guest ownership cannot be read', async () => {
    boundary.auth.currentUser = null;
    const currentStorage = globalThis.localStorage;
    vi.stubGlobal('localStorage', {
        get length() { return disk.size; },
        key: (index: number) => [...disk.keys()][index] ?? null,
        getItem: (key: string) => {
            if (key === 'logbook_is_guest') throw new DOMException('blocked', 'SecurityError');
            return disk.get(key) ?? null;
        },
        setItem: currentStorage.setItem.bind(currentStorage),
        removeItem: currentStorage.removeItem.bind(currentStorage),
    });

    await expect(resumeAccountDeletion(context)).rejects.toThrow('Browser storage read failed');

    expect(boundary.auth.signOut).not.toHaveBeenCalled();
    expect(boundary.purge).not.toHaveBeenCalled();
    expect(boundary.resetCache).not.toHaveBeenCalled();
    expect(boundary.reset).not.toHaveBeenCalled();
    expect(disk.size).toBeGreaterThan(0);
});
