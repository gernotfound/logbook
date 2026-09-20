import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { create } from 'zustand';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ auth: { currentUser: { uid: 'A' } as { uid: string } | null }, save: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth }));
vi.mock('../../src/lib/db', () => ({ DB: { saveUserData: sdk.save } }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
vi.mock('../../src/lib/storageTelemetry', () => ({ updateStorageMarker: vi.fn(), clearStorageMarker: vi.fn() }));
import { createDataSlice } from '../../src/store/slices/createDataSlice';
import { createWorkoutSlice } from '../../src/store/slices/createWorkoutSlice';
import { createSyncSlice } from '../../src/store/slices/createSyncSlice';
import type { AppState } from '../../src/store/useAppStore';
import { readLocal, initializeLocal, acknowledgeThrough } from '../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import { getNutritionConflictFingerprint } from '../../src/lib/utils/object';
const data = (height: number) => UserDataSchema.parse({ profile: { height } }) as unknown as UserData;
const store = create<AppState>()((...args) => ({ ...createDataSlice(...args), ...createWorkoutSlice(...args), ...createSyncSlice(...args) }));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(async () => {
    vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(() => null),
        length: 0,
    });
    store.getState().resetStore();
    await clear();
    sdk.auth.currentUser = { uid: 'A' };
    sdk.save.mockReset().mockImplementation(async () => { const saved = await readLocal(`user:${sdk.auth.currentUser?.uid}`); if (saved) await acknowledgeThrough(saved.owner, saved.revision, saved.data); return { ok: true, status: 'synced' }; });
    store.setState({ userData: data(170) });
    await initializeLocal('user:A', data(170));
});
afterEach(() => { store.getState().cancelPendingSyncs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('store with real IndexedDB commits', () => {
    it('preserves the nutrition alternative in memory and IndexedDB when resolution is rejected', async () => {
        const conflicted = UserDataSchema.parse({ ...data(170), nutritionPlanning: { onDaysCount: 3 }, pendingConflicts: { nutritionPlanning: { onDaysCount: 0 } } }) as unknown as UserData;
        store.setState({ userData: conflicted });
        await initializeLocal('user:A', conflicted);
        sdk.save.mockResolvedValue({ ok: false, status: 'rejected', error: { code: 'permission-denied' } });
        const result = store.getState().resolveNutritionConflict({ resolution: 'local', expectedUid: 'A', expectedConflictFingerprint: getNutritionConflictFingerprint(conflicted.pendingConflicts?.nutritionPlanning) });
        const rejected = expect(result).rejects.toThrow('rifiutata');
        await store.getState().flushPendingSyncs(); await rejected;
        expect(store.getState().userData?.pendingConflicts?.nutritionPlanning?.onDaysCount).toBe(0);
        expect((await readLocal('user:A'))?.data.pendingConflicts?.nutritionPlanning?.onDaysCount).toBe(0);
    });
    it('refuses a nutrition resolution submitted for another account', async () => {
        const conflicted = UserDataSchema.parse({ ...data(170), pendingConflicts: { nutritionPlanning: { onDaysCount: 0 } } }) as unknown as UserData;
        store.setState({ userData: conflicted });
        const result = await store.getState().resolveNutritionConflict({ resolution: 'cloud', expectedUid: 'B', expectedConflictFingerprint: getNutritionConflictFingerprint(conflicted.pendingConflicts?.nutritionPlanning) });
        expect(result.ok).toBe(false);
        expect(store.getState().userData?.pendingConflicts).toEqual(conflicted.pendingConflicts);
        expect(sdk.save).not.toHaveBeenCalled();
    });
    it('is dirty immediately and durably stages the edit before the cloud debounce', async () => {
        const saving = store.getState().saveUserData(data(171));
        expect(store.getState().syncHealth).toBe('saving');
        await vi.waitFor(async () => expect((await readLocal('user:A'))?.pending).toHaveLength(1));
        expect((await readLocal('user:A'))?.data.profile.height).toBe('171');
        expect(sdk.save).not.toHaveBeenCalled();
        await store.getState().flushPendingSyncs();
        await expect(saving).resolves.toEqual({ ok: true, status: 'synced' });
    });
    it('never calls the cloud or confirms success after a local quota failure', async () => {
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
        const saving = store.getState().saveUserData(data(171));
        const observed = expect(saving).rejects.toThrow('quota');
        await store.getState().flushPendingSyncs();
        await observed;
        expect(sdk.save).not.toHaveBeenCalled();
        expect(store.getState().syncHealth).toBe('failed');
        expect((await readLocal('user:A'))?.data.profile.height).toBe('170');
    });
    it('retains the journal on server rejection', async () => {
        sdk.save.mockResolvedValue({ ok: false, status: 'rejected', error: { code: 'permission-denied' } });
        const saving = store.getState().saveUserData(data(171));
        const observed = expect(saving).rejects.toThrow('rifiutata');
        await store.getState().flushPendingSyncs();
        await observed;
        expect(store.getState().syncHealth).toBe('rejected');
        expect((await readLocal('user:A'))?.pending).toHaveLength(1);
    });
    it('keeps a newer edit dirty while an older remote request completes', async () => {
        const remote = deferred<{ ok: true; status: 'synced' }>();
        sdk.save.mockReturnValueOnce(remote.promise);
        const first = store.getState().saveUserData(data(171));
        const flushing = store.getState().flushPendingSyncs();
        await vi.waitFor(() => expect(sdk.save).toHaveBeenCalledTimes(1));
        const second = store.getState().saveUserData(data(172));
        remote.resolve({ ok: true, status: 'synced' });
        await flushing; await first;
        expect(store.getState().syncHealth).toBe('saving');
        expect((await readLocal('user:A'))?.data.profile.height).toBe('172');
        await store.getState().flushPendingSyncs(); await second;
        expect((await readLocal('user:A'))?.pending).toEqual([]);
    });
    it('rejects a stale completion after A to B to A without acknowledging the old journal', async () => {
        const remote = deferred<{ ok: true; status: 'synced' }>();
        sdk.save.mockReturnValueOnce(remote.promise);
        const saving = store.getState().saveUserData(data(171));
        const observed = expect(saving).rejects.toThrow('cambio sessione');
        const flushing = store.getState().flushPendingSyncs();
        await vi.waitFor(() => expect(sdk.save).toHaveBeenCalledTimes(1));
        sdk.auth.currentUser = { uid: 'B' }; store.getState().resetStore();
        sdk.auth.currentUser = { uid: 'A' }; store.getState().resetStore();
        store.setState({ userData: data(180), syncHealth: 'local-pending' });
        remote.resolve({ ok: true, status: 'synced' });
        await flushing; await observed;
        expect(store.getState().userData?.profile.height).toBe('180');
        expect(store.getState().syncHealth).toBe('local-pending');
        expect((await readLocal('user:A'))?.pending).toHaveLength(1);
    });
});