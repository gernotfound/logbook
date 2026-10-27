import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { create } from 'zustand';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ auth: { currentUser: { uid: 'A' } as { uid: string } | null }, save: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth }));
vi.mock('../../src/lib/db', () => ({ DB: { saveUserData: sdk.save } }));
// This suite exercises legacy sync/reconciliation under an already-authorized
// authenticated account (server revision 0). Consent revocation and epoch
// enforcement are tested separately with the real policy and emulator Rules.
vi.mock('../../src/lib/healthConsent', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/healthConsent')>('../../src/lib/healthConsent');
    const writable = (owner: string) => owner === 'user:' + sdk.auth.currentUser?.uid;
    return {
        ...actual,
        isHealthConsentWritable: writable,
        isHealthConsentCloudWritable: writable,
        requireHealthConsentWritable: (owner: string) => {
            if (!writable(owner)) throw new Error('Utente non autorizzato dal consenso');
        },
        getVerifiedHealthConsentRevision: () => 0,
    };
});
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackError: vi.fn() } }));
vi.mock('../../src/lib/storageTelemetry', () => ({ updateStorageMarker: vi.fn(), clearStorageMarker: vi.fn() }));
import { createDataSlice } from '../../src/store/slices/createDataSlice';
import { createWorkoutSlice } from '../../src/store/slices/createWorkoutSlice';
import { createSyncSlice } from '../../src/store/slices/createSyncSlice';
import type { AppState } from '../../src/store/useAppStore';
import { readLocal, initializeLocal, acknowledgeThrough, adoptReplicaCheckpoint, commitDomainOperations, advanceLocalConsentRevisionIfClean } from '../../src/lib/sync/localRepository';
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
    sdk.save.mockReset().mockImplementation(async () => {
        const owner = `user:${sdk.auth.currentUser?.uid}`;
        let saved = await readLocal(owner);
        if (!saved) throw new Error('Missing durable journal for test cloud delivery');
        if (saved.pending.length && !saved.replica) {
            const now = Date.now();
            await adoptReplicaCheckpoint(owner, { identity: {
                slot: 's00', replicaId: 'store-journal-test', generation: 1,
                checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000,
            }, baseSeq: 0 }, { clock: {}, syncMetaByDocument: {} });
            saved = await readLocal(owner);
        }
        if (saved?.pending.length) {
            if (!saved.replica) throw new Error('Missing replica identity for test acknowledgement');
            const delivered = structuredClone(saved.pending);
            await acknowledgeThrough(saved.owner, delivered[delivered.length - 1].seq, saved.data,
                [], undefined, { operations: delivered, replica: saved.replica });
        }
        return { ok: true, status: 'synced' };
    });
    store.setState({ userData: data(170), dataOwner: 'user:A' });
    await initializeLocal('user:A', data(170));
});
afterEach(() => { store.getState().cancelPendingSyncs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('store with real IndexedDB commits', () => {
    it('preserves the nutrition alternative in memory and IndexedDB when resolution is rejected', async () => {
        const conflicted = UserDataSchema.parse({ ...data(170), nutritionPlanning: { onDaysCount: 3 }, pendingConflicts: { nutritionPlanning: { onDaysCount: 0 } } }) as unknown as UserData;
        store.setState({ userData: conflicted });
        // Bootstrap is now create-if-absent; reset this test fixture rather than
        // relying on a production initializer to overwrite durable state.
        await clear();
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
    it('does not mistake metadata-only revision for a delivered journal sequence', async () => {
        const initial = data(170);
        await commitDomainOperations('user:A', {
            type: 'active-workout.set', workout: null, deletedWorkoutId: 'closed-without-operation',
        }, initial);
        const metadataOnly = (await readLocal('user:A'))!;
        expect(metadataOnly.revision).toBeGreaterThan(metadataOnly.actorSeq);
        const saving = store.getState().saveUserData(data(171));
        await store.getState().flushPendingSyncs();
        await expect(saving).resolves.toMatchObject({ ok: true, status: 'synced' });
        const saved = (await readLocal('user:A'))!;
        expect(saved.pending).toEqual([]);
        expect(saved.data.profile?.height).toBe('171');
        expect(saved.actorSeq).toBeGreaterThan(0);
    });
    it('is dirty immediately and durably stages the edit before the cloud debounce', async () => {
        const saving = store.getState().saveUserData(data(171));
        expect(store.getState().syncHealth).toBe('saving');
        await vi.waitFor(async () => expect((await readLocal('user:A'))?.pending).toHaveLength(1));
        expect((await readLocal('user:A'))?.data.profile?.height).toBe('171');
        expect(sdk.save).not.toHaveBeenCalled();
        await store.getState().flushPendingSyncs();
        await expect(saving).resolves.toEqual({ ok: true, status: 'synced' });
    });
    it('blocks further edits after a same-sequence workout collision instead of clearing the unsaved draft', async () => {
        const workout = { id: 'w-collision', date: '2026-10-14', routineName: 'Base', exercises: [] };
        const base = UserDataSchema.parse({ activeWorkout: workout }) as unknown as UserData;
        await clear();
        await initializeLocal('user:A', base);
        store.setState({ userData: base, dataOwner: 'user:A', localWorkout: workout });
        const intent = { generation: 'a'.repeat(32), sequence: 1, intentId: 'b'.repeat(32), baseline: workout };
        await commitDomainOperations('user:A', {
            type: 'active-workout.set', workout: { ...workout, routineName: 'Scheda A' },
        }, base, undefined, intent);
        const committed = await readLocal('user:A');

        const pending = store.getState().dispatchDomainOperation({
            type: 'active-workout.set', workout: { ...workout, routineName: 'Scheda B' },
        }, { workoutIntent: { ...intent, intentId: 'c'.repeat(32) } });
        const observed = expect(pending).rejects.toThrow('Conflitto tra modifiche concorrenti');
        await store.getState().flushPendingSyncs();
        await observed;

        expect(sdk.save).not.toHaveBeenCalled();
        expect(await readLocal('user:A')).toEqual(committed);
        expect(store.getState().localPersistenceBlocked).toBe(true);
        expect(store.getState().saveError).toContain('Conflitto tra modifiche concorrenti');
        await expect(store.getState().dispatchDomainOperation({
            type: 'profile.patch', patch: { height: '190' },
        })).rejects.toThrow('Archivio locale non leggibile');
    });

    it('commits a newly edited workout after consent reacceptance with its proven source revision', async () => {
        const physical = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => physical.get(key) ?? null,
            setItem: (key: string, value: string) => { physical.set(key, String(value)); },
            removeItem: (key: string) => { physical.delete(key); },
            clear: () => physical.clear(),
            key: (index: number) => [...physical.keys()][index] ?? null,
            get length() { return physical.size; },
        });
        physical.set('logbook:v2:user:A:health-consent-generation', '3');

        const previous = { id: 'epoch-3-workout', date: '2026-10-14', routineName: 'Before', exercises: [] };
        const baseline = UserDataSchema.parse({ activeWorkout: previous }) as unknown as UserData;
        await clear();
        await initializeLocal('user:A', baseline);
        expect(await advanceLocalConsentRevisionIfClean('user:A', 3)).toBe(true);
        store.setState({
            userData: baseline, dataOwner: 'user:A', localWorkout: previous,
            localPersistenceBlocked: false, syncHealth: 'synced', syncing: false, saveError: null,
        });

        const updated = { ...previous, routineName: 'Edited in consent revision 3' };
        const saving = store.getState().setSyncedLocalWorkout(updated);
        await store.getState().flushPendingSyncs();
        await expect(saving).resolves.toMatchObject({ ok: true });

        const durable = await readLocal('user:A');
        expect(durable?.consentRevision).toBe(3);
        expect(durable?.data.activeWorkout?.routineName).toBe(updated.routineName);
        expect(durable?.lastWorkoutDeviceIntent?.intentId).toMatch(/^[a-f0-9]{32}$/);
        expect(store.getState().localPersistenceBlocked).toBe(false);
        expect(store.getState().localWorkout?.routineName).toBe(updated.routineName);
    });

    it('never calls the cloud or confirms success after a local quota failure', async () => {
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
        const saving = store.getState().saveUserData(data(171));
        const observed = expect(saving).rejects.toThrow('quota');
        await store.getState().flushPendingSyncs();
        await observed;
        expect(sdk.save).not.toHaveBeenCalled();
        expect(store.getState().syncHealth).toBe('failed');
        expect((await readLocal('user:A'))?.data.profile?.height).toBe('170');
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
    it('keeps an offline completed workout durable and replays it after reconnection without duplication', async () => {
        const workout = {
            id: 'offline-workout',
            routineName: 'Offline workout',
            date: '2026-10-03',
            globalStartTime: 1_791_014_400_000,
            globalEndTime: 1_791_017_100_000,
            globalDurationStr: '00:45:00',
            exercises: [],
        };
        const base = UserDataSchema.parse({
            ...data(170),
            activeWorkout: workout,
            history: [],
            activePains: [],
        }) as unknown as UserData;

        store.setState({ userData: base, localWorkout: workout });
        await initializeLocal('user:A', base);

        sdk.save.mockResolvedValueOnce({
            ok: false,
            status: 'local-pending',
            error: new Error('Connessione assente'),
        });

        const completing = store.getState().dispatchDomainOperation({
            type: 'workout.complete',
            workout,
            expectedActiveWorkoutId: String(workout.id),
            activePains: [],
        });
        await store.getState().flushPendingSyncs();
        await expect(completing).resolves.toMatchObject({ ok: false, status: 'local-pending' });

        const offlineEnvelope = await readLocal('user:A');
        expect(offlineEnvelope?.data.activeWorkout).toBeNull();
        expect(offlineEnvelope?.data.history?.filter(item => item.id === workout.id)).toHaveLength(1);
        expect(offlineEnvelope?.pending.length).toBeGreaterThan(0);
        expect(store.getState().syncHealth).toBe('local-pending');

        // Mirrors useWorkoutSession.endWorkout(): once the local-first completion settles,
        // the device-local draft can be cleared even though cloud replication is pending.
        store.getState().setLocalWorkout(null);
        expect(store.getState().localWorkout).toBeNull();
        expect(store.getState().userData?.activeWorkout).toBeNull();

        await store.getState().flushPendingSyncs();

        const replayedEnvelope = await readLocal('user:A');
        expect(replayedEnvelope?.pending).toEqual([]);
        expect(replayedEnvelope?.data.activeWorkout).toBeNull();
        expect(replayedEnvelope?.data.history?.filter(item => item.id === workout.id)).toHaveLength(1);
        expect(store.getState().syncHealth).toBe('synced');
        expect(store.getState().saveError).toBeNull();
    });

    it('clears stale local-pending feedback after durable acknowledgement already drained the journal', async () => {
        expect((await readLocal('user:A'))?.pending).toHaveLength(0);
        store.setState({
            syncHealth: 'local-pending',
            saveError: 'Salvato localmente. Sincronizzazione in attesa.',
        });
        await store.getState().flushPendingSyncs();
        expect(store.getState().syncHealth).toBe('synced');
        expect(store.getState().saveError).toBeNull();
        expect(sdk.save).not.toHaveBeenCalled();
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
        expect((await readLocal('user:A'))?.data.profile?.height).toBe('172');
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
        store.setState({ userData: data(180), dataOwner: 'user:A', syncHealth: 'local-pending' });
        remote.resolve({ ok: true, status: 'synced' });
        await flushing; await observed;
        expect(store.getState().userData?.profile?.height).toBe('180');
        expect(store.getState().syncHealth).toBe('local-pending');
        expect((await readLocal('user:A'))?.pending).toHaveLength(1);
    });

    it('settles a debounced save on local persistence failure without contacting Firestore', async () => {
        const saving = store.getState().saveUserData(data(171));
        const observed = expect(saving).rejects.toThrow('Archivio locale non leggibile');
        store.setState({ localPersistenceBlocked: true, syncHealth: 'failed' });
        store.getState().settleBlockedSyncJobs();
        await observed;
        await store.getState().flushPendingSyncs();
        expect(sdk.save).not.toHaveBeenCalled();
        expect(store.getState().syncing).toBe(false);
        expect(store.getState().syncHealth).toBe('failed');
    });

    it('does not publish an old cloud success after a later local draft failure', async () => {
        const remote = deferred<{ ok: true; status: 'synced' }>();
        sdk.save.mockReturnValueOnce(remote.promise);
        const saving = store.getState().saveUserData(data(171));
        const observed = expect(saving).rejects.toThrow('Archivio locale non leggibile');
        const flushing = store.getState().flushPendingSyncs();
        await vi.waitFor(() => expect(sdk.save).toHaveBeenCalledTimes(1));
        store.setState({ localPersistenceBlocked: true, syncHealth: 'failed', saveError: 'Bozza non salvata' });
        store.getState().settleBlockedSyncJobs();
        remote.resolve({ ok: true, status: 'synced' });
        await flushing;
        await observed;
        expect(store.getState().syncHealth).toBe('failed');
        expect(store.getState().saveError).toBe('Bozza non salvata');
        expect(store.getState().localPersistenceBlocked).toBe(true);
    });

});