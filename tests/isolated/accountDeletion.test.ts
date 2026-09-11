import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ auth: { currentUser: null as any }, token: vi.fn(), removeAuth: vi.fn(), idle: vi.fn(), pending: vi.fn(), read: vi.fn(), commit: vi.fn(), readRoot: vi.fn(), reset: vi.fn(), cancel: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ auth: boundary.auth, getDb: () => ({}), deleteUser: boundary.removeAuth, ensureAppCheck: async () => {}, waitForPendingWrites: boundary.pending }));
vi.mock('../../src/store/useAppStore', () => ({ useAppStore: { getState: () => ({ cancelPendingSyncs: boundary.cancel, resetStore: boundary.reset }) } }));
vi.mock('../../src/lib/sync/replicateJournal', () => ({ waitForJournalIdle: boundary.idle }));
vi.mock('firebase/firestore', () => ({
    collection: (_db: unknown, ...path: string[]) => path.join('/'), doc: (_db: unknown, ...path: string[]) => path.join('/'),
    limit: (count: number) => count, query: (path: string, count: number) => ({ path, count }),
    getDocsFromServer: boundary.read, getDocFromServer: boundary.readRoot,
    writeBatch: () => { const deleted: string[] = []; return { delete: (ref: string) => deleted.push(ref), commit: () => boundary.commit(deleted) }; },
}));
import { deleteAccount, purgeAllLocalUserData } from '../../src/lib/db/db_account';
import { invalidateSession } from '../../src/lib/sync/session';
import { isAccountDeletionPending } from '../../src/lib/sync/accountGate';
const context = { purgeAllLocalUserData, resetCache: vi.fn() };
let documents: Set<string>;
let disk: Map<string, string>;
beforeEach(async () => {
    vi.resetAllMocks(); await clear(); invalidateSession();
    disk = new Map();
    vi.stubGlobal('localStorage', { get length() { return disk.size; }, key: (index: number) => [...disk.keys()][index] ?? null, getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) });
    boundary.token.mockResolvedValue({ authTime: new Date().toISOString() });
    boundary.auth.currentUser = { uid: 'a', getIdTokenResult: boundary.token };
    boundary.cancel.mockImplementation(invalidateSession);
    documents = new Set(['users/a']);
    boundary.read.mockImplementation(async ({ path, count }) => {
        const docs = [...documents].filter(key => key.startsWith(path + '/')).slice(0, count).map(ref => ({ ref }));
        return { docs, empty: !docs.length };
    });
    boundary.commit.mockImplementation(async (refs: string[]) => { refs.forEach(ref => documents.delete(ref)); });
    boundary.readRoot.mockImplementation(async (ref: string) => ({ exists: () => documents.has(ref) }));
    await set('logbook:v2:user:a', { original: 'recoverable' });
    await set('logbook:v2:user:b', { original: 'other owner' });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('deletes 1201 documents in bounded pages, verifies emptiness, then removes Auth and only its local archive', async () => {
    for (let i = 0; i < 600; i++) { documents.add('users/a/history_months/h' + i); documents.add('users/a/nutrition_months/n' + i); }
    boundary.removeAuth.mockImplementation(async () => { expect(documents.size).toBe(0); expect(await get('logbook:v2:user:a')).toBeDefined(); });
    await deleteAccount(context);
    expect(boundary.commit.mock.calls.map(([refs]) => refs.length)).toEqual([400, 200, 400, 200, 1]);
    expect(boundary.removeAuth).toHaveBeenCalledTimes(1);
    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
});
it('checks recent authentication before any destructive operation', async () => {
    boundary.token.mockResolvedValue({ authTime: '2020-01-01T00:00:00Z' });
    await expect(deleteAccount(context)).rejects.toThrow('Nessun dato');
    expect(boundary.read).not.toHaveBeenCalled(); expect(boundary.commit).not.toHaveBeenCalled();
    expect(isAccountDeletionPending('user:a')).toBe(false);
});
it.each(['history_months', 'nutrition_months', 'telemetry_errors', 'telemetry_events', 'telemetry_anomalies'])('retains Auth and local recovery when querying %s is denied', async name => {
    const read = boundary.read.getMockImplementation()!;
    boundary.read.mockImplementation(async (request) => { if (request.path.endsWith(name)) throw new Error('permission-denied'); return read(request); });
    await expect(deleteAccount(context)).rejects.toThrow('Cancellazione non completata');
    expect(boundary.removeAuth).not.toHaveBeenCalled(); expect(await get('logbook:v2:user:a')).toBeDefined();
    expect(isAccountDeletionPending('user:a')).toBe(true);
});
it('keeps partial deletion resumable after a batch rejection', async () => {
    for (let i = 0; i < 450; i++) documents.add('users/a/history_months/h' + i);
    const commit = boundary.commit.getMockImplementation()!;
    boundary.commit.mockImplementationOnce(commit).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(deleteAccount(context)).rejects.toThrow('permission-denied');
    expect(documents.size).toBe(51); expect(boundary.removeAuth).not.toHaveBeenCalled();
    expect(await get('logbook:v2:user:a')).toBeDefined();
    await deleteAccount(context);
    expect(documents.size).toBe(0); expect(boundary.removeAuth).toHaveBeenCalledTimes(1);
});
it('never removes Auth if a concurrent client creates residual data', async () => {
    boundary.readRoot.mockImplementation(async () => { documents.add('users/a/nutrition_months/late'); return { exists: () => false }; });
    await expect(deleteAccount(context)).rejects.toThrow('residui');
    expect(boundary.removeAuth).not.toHaveBeenCalled();
});
it('waits for an earlier writer and rejects an intervening identity change', async () => {
    let release!: () => void;
    boundary.idle.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const operation = deleteAccount(context);
    await vi.waitFor(() => expect(boundary.idle).toHaveBeenCalled());
    expect(boundary.read).not.toHaveBeenCalled();
    boundary.auth.currentUser = { uid: 'b' }; invalidateSession(); release();
    await expect(operation).rejects.toThrow('Sessione cambiata');
    expect(boundary.commit).not.toHaveBeenCalled(); expect(boundary.removeAuth).not.toHaveBeenCalled();
});
it('retains local data when Auth deletion fails after the cloud scan', async () => {
    boundary.removeAuth.mockRejectedValue(new Error('requires-recent-login'));
    await expect(deleteAccount(context)).rejects.toThrow('requires-recent-login');
    expect(await get('logbook:v2:user:a')).toBeDefined(); expect(boundary.reset).not.toHaveBeenCalled();
});
it('reports storage deletion failures while continuing cleanup of other keys', async () => {
    disk.set('logbook:v2:user:a:workout', 'draft'); disk.set('logbook:v2:user:a:timer_state', 'running');
    vi.spyOn(localStorage, 'removeItem').mockImplementation(key => { if (key.endsWith(':workout')) throw new Error('blocked'); disk.delete(key); });
    await expect(purgeAllLocalUserData('user:a')).rejects.toThrow('Pulizia locale incompleta');
    expect(disk.has('logbook:v2:user:a:workout')).toBe(true); expect(disk.has('logbook:v2:user:a:timer_state')).toBe(false);
});
