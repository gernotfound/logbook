import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({ state: { userData: null as any, localWorkout: null as any, dataOwner: 'user:a' as string | null }, flush: vi.fn(), auth: { currentUser: { uid: 'a' } } }));
vi.mock('../../src/store/useAppStore', () => ({ useAppStore: {
    getState: () => ({ ...app.state, flushPendingSyncs: app.flush }),
    setState: (patch: any) => { app.state = { ...app.state, ...(typeof patch === 'function' ? patch(app.state) : patch) }; },
} }));
vi.mock('../../src/lib/firebase', () => ({ auth: app.auth }));
// This legacy persistence suite assumes a verified, still-active server consent
// at revision zero. Real revocation/fencing is tested in dedicated suites.
vi.mock('../../src/lib/healthConsent', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/healthConsent')>('../../src/lib/healthConsent');
    const writable = (owner: string) => owner.startsWith('user:')
        ? owner === 'user:' + app.auth.currentUser?.uid
        : actual.isHealthConsentWritable(owner);
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
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { isReloadSessionCurrent, prepareForReload } from '../../src/lib/sync/reloadBarrier';
import { requiredUpdateHardReload, safeHardReload } from '../../src/lib/sync/safeReload';
import { commitLocal, initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../src/lib/schema';
import { captureSession, invalidateSession } from '../../src/lib/sync/session';
import { markTabSnapshotClean, markTabSnapshotDirty } from '../../src/lib/sync/tabSnapshotCausality';
import { draftRegistry } from '../../src/lib/utils/draftRegistry';
import { BrowserStorageError } from '../../src/lib/sync/browserStorage';
import type { UserData } from '../../src/types';
const parse = (height: number) => UserDataSchema.parse({ profile: { height } }) as unknown as UserData;
let disk: Map<string, string>;
beforeEach(async () => {
    await clear(); invalidateSession(); vi.resetAllMocks(); app.auth.currentUser = { uid: 'a' };
    disk = new Map();
    vi.stubGlobal('localStorage', { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) });
    app.state = { userData: parse(170), localWorkout: { id: 'active', exercises: [] }, dataOwner: 'user:a' };
    await initializeLocal('user:a', app.state.userData);
    markTabSnapshotClean(captureSession(), app.state.userData);
});
afterEach(() => vi.unstubAllGlobals());
it('allows offline update only with the durable copy and synchronous active workout snapshot', async () => {
    app.flush.mockRejectedValue(new Error('offline'));
    await prepareForReload();
    expect(JSON.parse(disk.get('logbook:v2:user:a:workout')!)).toEqual(app.state.localWorkout);
    expect((await readLocal('user:a'))?.data).toEqual(UserDataSchema.parse(app.state.userData));
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
    (app.auth as any).currentUser = null;
    invalidateSession();
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
});
it('still blocks reload when the durable envelope is missing', async () => {
    await clear();
    app.flush.mockRejectedValue(new Error('offline'));
    await expect(prepareForReload()).rejects.toThrow('non sono ancora salvate');
    expect(disk.size).toBe(0);
});
it('blocks reload when the synchronous workout snapshot fails', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(prepareForReload()).rejects.toBeInstanceOf(BrowserStorageError);
});
it('blocks reload on identity changes while awaiting persistence', async () => {
    app.flush.mockImplementation(async () => { app.auth.currentUser = { uid: 'b' }; invalidateSession(); });
    await expect(prepareForReload()).rejects.toThrow('Sessione cambiata');
    expect(disk.size).toBe(0);
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
    const raw = await get<any>('logbook:v2:user:a');
    await set('logbook:v2:user:a', { ...raw, dataSchemaVersion: 99 });

    await expect(prepareForReload()).rejects.toThrow(/aggiorna TheLogBook/i);

    const reload = vi.fn();
    await requiredUpdateHardReload(reload);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(disk.get('logbook:v2:user:a:workout')!)).toEqual(app.state.localWorkout);
});
it('blocks required-update snapshot when the installed dataset belongs to another owner', async () => {
    app.state.dataOwner = 'guest';
    const reload = vi.fn();

    await expect(requiredUpdateHardReload(reload)).rejects.toThrow('non attribuibile');
    expect(reload).not.toHaveBeenCalled();
    expect(disk.get('logbook:v2:user:a:workout')).toBeUndefined();
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
    (app.auth as any).currentUser = null;
    invalidateSession();
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
});

it('blocks reload with a readable envelope while an unsaved UI draft has blocked local persistence', async () => {
    app.flush.mockResolvedValue(undefined);
    (app.state as typeof app.state & { localPersistenceBlocked?: boolean }).localPersistenceBlocked = true;
    await expect(prepareForReload()).rejects.toThrow('Persistenza locale bloccata');
    expect(app.flush).not.toHaveBeenCalled();
    expect((await readLocal('user:a'))?.data.profile?.height).toBe('170');
});
