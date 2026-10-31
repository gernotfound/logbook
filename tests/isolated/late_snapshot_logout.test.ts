import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
    auth: { currentUser: null as { uid: string } | null },
}));
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackError: vi.fn() } }));

import { saveUserDataToCache } from '../../src/store/slices/createDataSlice';
import { UserDataSchema } from '../../src/lib/schema';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession, revokeGuestSession } from '../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { writeDeviceValue } from '../../src/lib/sync/deviceStorage';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import type { UserData } from '../../src/types';

const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

beforeEach(async () => {
    lockAllVaults();
    const disk = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        get length() { return disk.size; },
        key: (index: number) => [...disk.keys()][index] ?? null,
        getItem: (key: string) => disk.get(key) ?? null,
        setItem: (key: string, value: string) => { disk.set(key, String(value)); },
        removeItem: (key: string) => { disk.delete(key); },
        clear: () => disk.clear(),
    });
    vi.stubGlobal('navigator', {
        locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() },
    });
    await clear();
    sdk.auth.currentUser = null;
    invalidateSession();
});
afterEach(() => { lockAllVaults(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('refuses an in-flight guest snapshot that would recreate an archive after logout', async () => {
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-before-logout');
    localStorage.setItem('logbook_is_guest', 'true');
    activateGuestSession('guest-before-logout');
    await createAndMigrateVault('guest');

    const inFlight = saveUserDataToCache(data(170));
    revokeGuestSession();
    expect(() => writeDeviceValue('workout', 'obsolete-session', 'guest')).toThrow('revocata');
    await expect(inFlight).rejects.toThrow('Sessione cambiata');
    expect(await get('logbook:v2:guest')).toBeUndefined();
});

it('fences an in-flight authenticated snapshot when logout invalidates its epoch', async () => {
    sdk.auth.currentUser = { uid: 'account-a' };
    await createAndMigrateVault('user:account-a');
    await initializeLocal('user:account-a', data(170));

    const inFlight = saveUserDataToCache(data(180), data(170));
    invalidateSession();
    await expect(inFlight).rejects.toThrow('Sessione cambiata');
    expect((await readLocal('user:account-a'))?.data.profile?.height).toBe('170');
});

it('does not turn bootstrap into an overwrite if another tab initialized first', async () => {
    sdk.auth.currentUser = { uid: 'account-a' };
    await createAndMigrateVault('user:account-a');
    await initializeLocal('user:account-a', data(180));
    await saveUserDataToCache(data(160)); // stale bootstrap has no observed base
    expect((await readLocal('user:account-a'))?.data.profile?.height).toBe('180');
});
