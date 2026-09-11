import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({ state: { userData: null as any, localWorkout: null as any }, flush: vi.fn(), auth: { currentUser: { uid: 'a' } } }));
vi.mock('../../src/store/useAppStore', () => ({ useAppStore: { getState: () => ({ ...app.state, flushPendingSyncs: app.flush }) } }));
vi.mock('../../src/lib/firebase', () => ({ auth: app.auth }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { prepareForReload } from '../../src/lib/sync/reloadBarrier';
import { initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../src/lib/schema';
import { invalidateSession } from '../../src/lib/sync/session';
import { draftRegistry } from '../../src/lib/utils/draftRegistry';
import type { UserData } from '../../src/types';
const parse = (height: number) => UserDataSchema.parse({ profile: { height } }) as unknown as UserData;
let disk: Map<string, string>;
beforeEach(async () => {
    await clear(); invalidateSession(); vi.resetAllMocks(); app.auth.currentUser = { uid: 'a' };
    disk = new Map();
    vi.stubGlobal('localStorage', { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) });
    app.state = { userData: parse(170), localWorkout: { id: 'active', exercises: [] } };
    await initializeLocal('user:a', app.state.userData);
});
afterEach(() => vi.unstubAllGlobals());
it('allows offline update only with the durable copy and synchronous active workout snapshot', async () => {
    app.flush.mockRejectedValue(new Error('offline'));
    await prepareForReload();
    expect(JSON.parse(disk.get('logbook:v2:user:a:workout')!)).toEqual(app.state.localWorkout);
    expect((await readLocal('user:a'))?.data).toEqual(UserDataSchema.parse(app.state.userData));
});
it('blocks reload after local storage failure or a newer uncommitted edit', async () => {
    app.state.userData = parse(171);
    app.flush.mockRejectedValue(new Error('quota'));
    await expect(prepareForReload()).rejects.toThrow('non sono ancora salvate');
    expect(disk.size).toBe(0);
});
it('blocks reload when the synchronous workout snapshot fails', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(prepareForReload()).rejects.toThrow('quota');
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
