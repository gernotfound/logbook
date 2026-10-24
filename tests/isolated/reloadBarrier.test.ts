import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({ state: { userData: null as any, localWorkout: null as any, dataOwner: 'user:a' as string | null }, flush: vi.fn(), auth: { currentUser: { uid: 'a' } }, suspendedConsent: null as null | 'erasure-required' }));
vi.mock('../../src/store/useAppStore', () => ({ useAppStore: {
    getState: () => ({ ...app.state, flushPendingSyncs: app.flush }),
    setState: (patch: any) => { app.state = { ...app.state, ...(typeof patch === 'function' ? patch(app.state) : patch) }; },
} }));
vi.mock('../../src/lib/firebase', () => ({ auth: app.auth }));
// Reload tests assume verified, still-active account consent at revision zero.
// Consent epoch and revocation fences also have dedicated suites.
vi.mock('../../src/lib/healthConsent', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/healthConsent')>('../../src/lib/healthConsent');
    const writable = (owner: string) => owner.startsWith('user:')
        ? owner === 'user:' + app.auth.currentUser?.uid
        : actual.isHealthConsentWritable(owner);
    return {
        ...actual,
        currentHealthConsentStatus: (uid: string) => app.suspendedConsent ?? actual.currentHealthConsentStatus(uid),
        isHealthConsentWritable: writable,
        isHealthConsentCloudWritable: writable,
        requireHealthConsentWritable: (owner: string) => {
            if (!writable(owner)) throw new Error('Utente non autorizzato dal consenso');
        },
        getVerifiedHealthConsentRevision: () => 0,
    };
});
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackError: vi.fn() } }));
import { isReloadSessionCurrent, prepareForReload, UnverifiedTabSnapshotError } from '../../src/lib/sync/reloadBarrier';
import { requiredUpdateHardReload, safeHardReload } from '../../src/lib/sync/safeReload';
import { commitLocal, initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../src/lib/schema';
import { activateGuestSession, captureSession, GUEST_SESSION_KEY, invalidateSession } from '../../src/lib/sync/session';
import { markTabSnapshotClean, markTabSnapshotDirty } from '../../src/lib/sync/tabSnapshotCausality';
import { draftRegistry } from '../../src/lib/utils/draftRegistry';
import { BrowserStorageError } from '../../src/lib/sync/browserStorage';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../src/lib/sync/deviceStorage';
import { lockAllVaults, lockVault, requireUnlockedLocalKey, LocalVaultLockedError } from '../../src/lib/sync/secureArchiveSession';
import { LocalCiphertextError, openLocalJson, sealLocalJson } from '../../src/lib/sync/secureArchiveCipher';
import type { UserData } from '../../src/types';
const parse = (height: number) => UserDataSchema.parse({ profile: { height } }) as unknown as UserData;
let disk: Map<string, string>;
beforeEach(async () => {
    lockAllVaults();
    await clear(); invalidateSession(); vi.resetAllMocks(); app.auth.currentUser = { uid: 'a' }; app.suspendedConsent = null;
    disk = new Map();
    vi.stubGlobal('localStorage', { get length() { return disk.size; }, key: (index: number) => Array.from(disk.keys())[index] ?? null, getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) });
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() } });
    // Authenticated hydration is permitted only after the owner vault is ready.
    await createAndMigrateVault('user:a');
    app.state = { userData: parse(170), localWorkout: { id: 'active', exercises: [] }, dataOwner: 'user:a' };
    await initializeLocal('user:a', app.state.userData);
    markTabSnapshotClean(captureSession(), app.state.userData);
});
afterEach(() => { lockAllVaults(); vi.unstubAllGlobals(); });
it('allows offline update only with the durable copy and synchronous active workout snapshot', async () => {
    app.flush.mockRejectedValue(new Error('offline'));
    await prepareForReload();
    expect(JSON.parse(readDeviceValueStrict('workout', 'user:a')!)).toEqual(app.state.localWorkout);
    expect(disk.has(deviceKey('workout', 'user:a'))).toBe(false);
    expect(disk.get(protectedDeviceKey('workout', 'user:a'))).toMatch(/^tlb-sealed:/);
    expect(await get('logbook:v2:user:a')).toMatch(/^tlb-sealed:/);
    expect((await readLocal('user:a'))?.data).toEqual(UserDataSchema.parse(app.state.userData));
});
it('protects the active workout with authenticated ciphertext before a safe reload', async () => {
    app.flush.mockRejectedValue(new Error('offline'));
    await prepareForReload();
    expect(disk.has(deviceKey('workout', 'user:a'))).toBe(false);
    const ciphertext = disk.get(protectedDeviceKey('workout', 'user:a'));
    expect(ciphertext).toMatch(/^tlb-sealed:/);
    expect(JSON.parse(readDeviceValueStrict('workout', 'user:a')!)).toEqual(app.state.localWorkout);
});
it('fails closed on corrupted ciphertext and preserves the original bytes', async () => {
    writeDeviceValue('workout', JSON.stringify(app.state.localWorkout), 'user:a');
    const key = protectedDeviceKey('workout', 'user:a');
    const corrupted = 'tlb-sealed:v1:invalid-ciphertext';
    disk.set(key, corrupted);
    const reload = vi.fn();
    await expect(safeHardReload(reload)).rejects.toBeInstanceOf(LocalCiphertextError);
    expect(reload).not.toHaveBeenCalled();
    expect(disk.get(key)).toBe(corrupted);
});

it('blocks a reload when the owner vault is locked without modifying ciphertext', async () => {
    writeDeviceValue('workout', JSON.stringify(app.state.localWorkout), 'user:a');
    const key = protectedDeviceKey('workout', 'user:a');
    const ciphertext = disk.get(key);
    const envelope = await get('logbook:v2:user:a');
    lockVault('user:a');
    const reload = vi.fn();
    await expect(safeHardReload(reload)).rejects.toBeInstanceOf(LocalVaultLockedError);
    expect(reload).not.toHaveBeenCalled();
    expect(disk.get(key)).toBe(ciphertext);
    expect(await get('logbook:v2:user:a')).toBe(envelope);
});

it('blocks stale plaintext reappearing alongside owner ciphertext instead of overwriting either copy', async () => {
    writeDeviceValue('workout', JSON.stringify(app.state.localWorkout), 'user:a');
    const sealedKey = protectedDeviceKey('workout', 'user:a');
    const sealed = disk.get(sealedKey);
    const plainKey = deviceKey('workout', 'user:a');
    const stale = JSON.stringify({ id: 'stale-tab', exercises: [] });
    disk.set(plainKey, stale);
    const reload = vi.fn();
    await expect(safeHardReload(reload)).rejects.toBeInstanceOf(LocalCiphertextError);
    expect(reload).not.toHaveBeenCalled();
    expect(disk.get(sealedKey)).toBe(sealed);
    expect(disk.get(plainKey)).toBe(stale);
});

it('repairs a lagging durable snapshot before reload', async () => {
    markTabSnapshotDirty(captureSession(), app.state.userData);
    app.state.userData = parse(171);
    app.flush.mockRejectedValue(new Error('offline'));
    await prepareForReload();
    const durable = await readLocal('user:a');
    expect(durable?.data).toEqual(UserDataSchema.parse(app.state.userData));
    expect(durable?.pending.length).toBeGreaterThan(0);
});
it('repairs a lagging guest snapshot without creating a cloud journal', async () => {
    await clear();
    disk.set('logbook_is_guest', 'true');
    disk.set(GUEST_SESSION_KEY, 'reload-test-guest');
    (app.auth as any).currentUser = null;
    activateGuestSession('reload-test-guest');
    await createAndMigrateVault('guest');
    const base = parse(170);
    app.state.userData = base;
    app.state.dataOwner = 'guest';
    await initializeLocal('guest', base);
    markTabSnapshotClean(captureSession(), base);
    markTabSnapshotDirty(captureSession(), base);
    app.state.userData = parse(171);
    app.flush.mockRejectedValue(new Error('offline'));
    await prepareForReload();
    const durable = await readLocal('guest');
    expect(durable?.data).toEqual(UserDataSchema.parse(app.state.userData));
    expect(durable?.pending).toHaveLength(0);
    expect(await get('logbook:v2:guest')).toMatch(/^tlb-sealed:/);
});
it('still blocks reload when the durable envelope is missing', async () => {
    await clear();
    app.flush.mockRejectedValue(new Error('offline'));
    await expect(prepareForReload()).rejects.toThrow('non sono ancora salvate');
    expect(disk.has(protectedDeviceKey('workout', 'user:a'))).toBe(false);
});
it('blocks reload when the synchronous workout snapshot fails', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(prepareForReload()).rejects.toBeInstanceOf(BrowserStorageError);
});
it('blocks reload on identity changes while awaiting persistence', async () => {
    app.flush.mockImplementation(async () => { app.auth.currentUser = { uid: 'b' }; invalidateSession(); });
    await expect(prepareForReload()).rejects.toThrow('Sessione cambiata');
    expect(disk.has(protectedDeviceKey('workout', 'user:a'))).toBe(false);
});
it('propagates a failed input flush and does not proceed to reload', async () => {
    const badDraft = () => { throw new Error('invalid draft'); };
    draftRegistry.register(badDraft);
    try {
        await expect(prepareForReload()).rejects.toThrow('bozze');
        expect(app.flush).not.toHaveBeenCalled();
    } finally { draftRegistry.unregister(badDraft); }
});
it('updates from the login screen without an active guest session or deleting an account archive', async () => {
    const existing = await get('logbook:v2:user:a');
    app.auth.currentUser = null as any;
    app.state = { userData: null, localWorkout: null, dataOwner: null };
    const reload = vi.fn();

    await safeHardReload(reload);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(app.flush).not.toHaveBeenCalled();
    expect(await get('logbook:v2:user:a')).toEqual(existing);
    expect(disk.has('logbook_is_guest')).toBe(false);
});
it('keeps the reload blocked if the login screen still holds unowned business data', async () => {
    app.auth.currentUser = null as any;
    const reload = vi.fn();

    await expect(safeHardReload(reload)).rejects.toThrow('Sessione cambiata');
    expect(reload).not.toHaveBeenCalled();
});
it('does not treat a revoked guest marker as a safe login-screen update', async () => {
    app.auth.currentUser = null as any;
    app.state = { userData: null, localWorkout: null, dataOwner: null };
    disk.set('logbook_is_guest', 'true');
    disk.set('logbook_guest_revoked_v1', 'revoked');
    const reload = vi.fn();

    await expect(safeHardReload(reload)).rejects.toThrow('Sessione cambiata');
    expect(reload).not.toHaveBeenCalled();
});
it('fences a login-screen update if the session changes after preparation', async () => {
    app.auth.currentUser = null as any;
    app.state = { userData: null, localWorkout: null, dataOwner: null };
    const prepared = await prepareForReload();
    invalidateSession();
    expect(isReloadSessionCurrent(prepared)).toBe(false);
});
it('hard reloads only after the durable reload barrier succeeds', async () => {
    app.flush.mockRejectedValue(new Error('offline'));
    const reload = vi.fn();
    await safeHardReload(reload);
    expect(reload).toHaveBeenCalledTimes(1);
});
it('never hard reloads when the durable reload barrier rejects', async () => {
    await clear();
    app.flush.mockRejectedValue(new Error('offline'));
    const reload = vi.fn();
    await expect(safeHardReload(reload)).rejects.toThrow('non sono ancora salvate');
    expect(reload).not.toHaveBeenCalled();
});
it('reloads an update-required app without parsing a future local envelope and preserves the active workout snapshot', async () => {
    const archiveKey = 'logbook:v2:user:a';
    const sealed = await get<string>(archiveKey);
    expect(sealed).toMatch(/^tlb-sealed:/);
    const key = requireUnlockedLocalKey('user:a');
    const raw = openLocalJson(key, 'user:a', archiveKey, sealed!) as Record<string, unknown>;
    await set(archiveKey, sealLocalJson(key, 'user:a', archiveKey, { ...raw, dataSchemaVersion: 99 }));

    await expect(prepareForReload()).rejects.toThrow(/aggiorna TheLogBook/i);

    const reload = vi.fn();
    await requiredUpdateHardReload(reload);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readDeviceValueStrict('workout', 'user:a')!)).toEqual(app.state.localWorkout);
    expect(disk.has(deviceKey('workout', 'user:a'))).toBe(false);
    expect(disk.get(protectedDeviceKey('workout', 'user:a'))).toMatch(/^tlb-sealed:/);
});
it('waits for the replacement service worker to install before a required-update reload', async () => {
    const worker = Object.assign(new EventTarget(), {
        state: 'installing' as ServiceWorkerState,
        postMessage: vi.fn(),
    });
    const stateListener = vi.spyOn(worker, 'addEventListener');
    const registration = {
        waiting: null as ServiceWorker | null,
        installing: worker as unknown as ServiceWorker,
        update: vi.fn(async () => undefined),
    };
    vi.stubGlobal('navigator', {
        serviceWorker: {
            getRegistration: vi.fn(async () => registration),
            controller: null,
        },
    });

    const reload = vi.fn();
    const attempt = requiredUpdateHardReload(reload);
    await vi.waitFor(() => expect(stateListener).toHaveBeenCalledWith('statechange', expect.any(Function)));
    expect(reload).not.toHaveBeenCalled();

    registration.waiting = worker as unknown as ServiceWorker;
    worker.state = 'installed';
    worker.dispatchEvent(new Event('statechange'));
    await attempt;

    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).toHaveBeenCalledTimes(1);
});
it('blocks required-update snapshot when the installed dataset belongs to another owner', async () => {
    app.state.dataOwner = 'guest';
    const reload = vi.fn();

    await expect(requiredUpdateHardReload(reload)).rejects.toThrow('non attribuibile');
    expect(reload).not.toHaveBeenCalled();
    expect(disk.get(protectedDeviceKey('workout', 'user:a'))).toBeUndefined();
});

it('still blocks update-required reload when the device-critical workout snapshot cannot be persisted', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const reload = vi.fn();

    await expect(requiredUpdateHardReload(reload)).rejects.toBeInstanceOf(BrowserStorageError);
    expect(reload).not.toHaveBeenCalled();
});
it('does not delete an authenticated change written by another tab when this tab is clean and stale', async () => {
    const base = app.state.userData as UserData;
    const concurrent = UserDataSchema.parse({
        ...base,
        routines: [{ id: 'routine-a', name: 'Tab A', exercises: [] }],
    }) as unknown as UserData;
    await commitLocal('user:a', concurrent, base);
    app.flush.mockRejectedValue(new Error('offline'));

    await prepareForReload();

    const durable = await readLocal('user:a');
    expect(durable?.data.routines?.map(routine => routine.id)).toContain('routine-a');
    expect(durable?.pending.some(op => op.isDelete && op.path.includes('routine-a'))).toBe(false);
    expect(app.state.userData.routines?.map((routine: any) => routine.id)).toContain('routine-a');
});
it('preserves a concurrent authenticated change while durably replaying this tab local intent', async () => {
    const base = app.state.userData as UserData;
    markTabSnapshotDirty(captureSession(), base);
    app.state.userData = parse(171);
    const concurrent = UserDataSchema.parse({
        ...base,
        routines: [{ id: 'routine-a', name: 'Tab A', exercises: [] }],
    }) as unknown as UserData;
    await commitLocal('user:a', concurrent, base);
    app.flush.mockRejectedValue(new Error('offline'));

    await prepareForReload();

    const durable = await readLocal('user:a');
    expect(durable?.data.profile?.height).toBe('171');
    expect(durable?.data.routines?.map(routine => routine.id)).toContain('routine-a');
    expect(durable?.pending.some(op => op.isDelete && op.path.includes('routine-a'))).toBe(false);
});
it('does not erase a concurrent guest change from a clean stale tab', async () => {
    await clear();
    disk.set('logbook_is_guest', 'true');
    disk.set(GUEST_SESSION_KEY, 'reload-test-guest');
    (app.auth as any).currentUser = null;
    activateGuestSession('reload-test-guest');
    await createAndMigrateVault('guest');
    const base = parse(170);
    app.state.userData = base;
    app.state.dataOwner = 'guest';
    await initializeLocal('guest', base);
    markTabSnapshotClean(captureSession(), base);
    const concurrent = UserDataSchema.parse({
        ...base,
        routines: [{ id: 'guest-routine-a', name: 'Guest tab A', exercises: [] }],
    }) as unknown as UserData;
    await commitLocal('guest', concurrent, base);
    app.flush.mockRejectedValue(new Error('offline'));

    await prepareForReload();

    const durable = await readLocal('guest');
    expect(durable?.data.routines?.map(routine => routine.id)).toContain('guest-routine-a');
    expect(durable?.pending).toHaveLength(0);
    expect(await get('logbook:v2:guest')).toMatch(/^tlb-sealed:/);
});

it('blocks reload with a readable envelope while an unsaved UI draft has blocked local persistence', async () => {
    app.flush.mockResolvedValue(undefined);
    (app.state as typeof app.state & { localPersistenceBlocked?: boolean }).localPersistenceBlocked = true;
    await expect(prepareForReload()).rejects.toThrow('Persistenza locale bloccata');
    expect(app.flush).not.toHaveBeenCalled();
    expect((await readLocal('user:a'))?.data.profile?.height).toBe('170');
});


it('requires an explicit choice to discard unverified RAM after consent withdrawal', async () => {
    const original = (await readLocal('user:a'))!;
    disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
    invalidateSession(); // Old tab causality proof no longer belongs to this session.
    app.state.userData = parse(171);
    app.flush.mockRejectedValue(new Error('offline'));

    const reload = vi.fn();
    await expect(safeHardReload(reload)).rejects.toBeInstanceOf(UnverifiedTabSnapshotError);
    expect(reload).not.toHaveBeenCalled();
    expect(await readLocal('user:a')).toEqual(original);

    await safeHardReload(reload, { discardUnverifiedInMemoryData: true });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await readLocal('user:a')).toEqual(original);
    expect(app.state.userData).toEqual(original.data);
});

it('never permits an unverified RAM discard while consent is active', async () => {
    const original = (await readLocal('user:a'))!;
    invalidateSession();
    app.state.userData = parse(171);
    app.flush.mockRejectedValue(new Error('offline'));
    const reload = vi.fn();

    await expect(safeHardReload(reload, { discardUnverifiedInMemoryData: true }))
        .rejects.toBeInstanceOf(UnverifiedTabSnapshotError);
    expect(reload).not.toHaveBeenCalled();
    expect(await readLocal('user:a')).toEqual(original);
});

it('never discards unverified RAM when durable local state is missing', async () => {
    disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
    invalidateSession();
    await clear();
    app.flush.mockRejectedValue(new Error('offline'));
    const reload = vi.fn();

    await expect(safeHardReload(reload, { discardUnverifiedInMemoryData: true }))
        .rejects.toThrow('non sono ancora salvate');
    expect(reload).not.toHaveBeenCalled();
});

it('keeps storage failures blocking consent-suspended reload even with explicit discard choice', async () => {
    disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
    invalidateSession();
    app.state.userData = parse(171);
    (app.state as typeof app.state & { localPersistenceBlocked?: boolean }).localPersistenceBlocked = true;
    const reload = vi.fn();

    await expect(safeHardReload(reload, { discardUnverifiedInMemoryData: true }))
        .rejects.toThrow('Persistenza locale bloccata');
    expect(reload).not.toHaveBeenCalled();
});


it('does not erase a stored workout while reloading a consent-suspended screen', async () => {
    const saved = JSON.stringify({ id: 'saved-workout', exercises: [] });
    writeDeviceValue('workout', saved, 'user:a');
    const ciphertext = disk.get(protectedDeviceKey('workout', 'user:a'));
    disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
    app.state.localWorkout = null; // Suspended UI has no active RAM workout.
    app.flush.mockRejectedValue(new Error('offline'));

    const reload = vi.fn();
    await safeHardReload(reload);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(readDeviceValueStrict('workout', 'user:a')).toBe(saved);
    expect(disk.get(protectedDeviceKey('workout', 'user:a'))).toBe(ciphertext);
    expect(disk.has(deviceKey('workout', 'user:a'))).toBe(false);
});

it('does not replace an old stored workout when reloading a server-erased local archive', async () => {
    const saved = JSON.stringify({ id: 'old-acknowledged-workout', exercises: [] });
    writeDeviceValue('workout', saved, 'user:a');
    const ciphertext = disk.get(protectedDeviceKey('workout', 'user:a'));
    app.state.localWorkout = null;
    app.suspendedConsent = 'erasure-required';
    app.flush.mockRejectedValue(new Error('offline'));

    const reload = vi.fn();
    await safeHardReload(reload);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(readDeviceValueStrict('workout', 'user:a')).toBe(saved);
    expect(disk.get(protectedDeviceKey('workout', 'user:a'))).toBe(ciphertext);
    expect(disk.has(deviceKey('workout', 'user:a'))).toBe(false);
});
