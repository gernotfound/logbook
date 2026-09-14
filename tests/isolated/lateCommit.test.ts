import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const remote = vi.hoisted(() => ({ apply: vi.fn(), auth: { currentUser: { uid: 'a' } } }));
vi.mock('../../src/lib/firebase', () => ({ auth: remote.auth, getDb: () => ({}), ensureAppCheck: async () => {}, waitForPendingWrites: async () => {} }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => ({ exercises: [], foods: [] }) }));
vi.mock('../../src/lib/sync/transactionWriter', () => ({ applyDocumentChanges: remote.apply }));

import { replicateJournal, waitForJournalIdle } from '../../src/lib/sync/replicateJournal';
import { initializeLocal, commitLocal, readLocal } from '../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../src/lib/schema';
import { invalidateSession } from '../../src/lib/sync/session';
import type { UserData } from '../../src/types';

const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (err: any) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

beforeEach(async () => {
    vi.stubGlobal('navigator', { onLine: true });
    invalidateSession(); await clear();
    remote.auth.currentUser = { uid: 'a' }; remote.apply.mockReset();
    await initializeLocal('user:a', data(170)); await commitLocal('user:a', data(171), data(170));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('retains one writer after timeout and acknowledges its late commit before retrying', async () => {
    const completion = deferred<any>();
    remote.apply.mockReturnValue(completion.promise);
    const first = replicateJournal();
    
    // Allow the microtasks to process so runTransaction starts
    await vi.waitFor(() => expect(remote.apply).toHaveBeenCalledTimes(1));
    
    // Simulate timeout
    await vi.advanceTimersByTimeAsync(7001);
    expect((await first).status).toBe('local-pending');
    expect((await readLocal('user:a'))?.pending).toHaveLength(1);
    
    const retry = replicateJournal();
    await vi.advanceTimersByTimeAsync(50);
    expect(remote.apply).toHaveBeenCalledTimes(1); // Still 1 because late commit is blocking
    
    // Resolve the late commit
    completion.resolve({ documents: new Map(), syncMeta: {} });
    await waitForJournalIdle('user:a');
    
    expect((await retry).status).toBe('synced');
    expect((await readLocal('user:a'))?.pending).toHaveLength(0);
    expect(remote.apply).toHaveBeenCalledTimes(1);
});

it('does not acknowledge a late result after A to B to A even though the uid matches again', async () => {
    const completion = deferred<any>();
    remote.apply.mockReturnValue(completion.promise);
    const first = replicateJournal();
    await vi.waitFor(() => expect(remote.apply).toHaveBeenCalledTimes(1));
    
    remote.auth.currentUser = { uid: 'b' }; invalidateSession();
    remote.auth.currentUser = { uid: 'a' }; invalidateSession();
    
    completion.resolve({ documents: new Map(), syncMeta: {} });
    await waitForJournalIdle('user:a');
    
    expect((await first).status).toBe('failed');
    expect((await readLocal('user:a'))?.pending).toHaveLength(1);
});
