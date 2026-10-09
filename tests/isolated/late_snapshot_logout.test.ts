import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
    auth: { currentUser: null as { uid: string } | null },
}));
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackError: vi.fn(), trackEvent: vi.fn() } }));

import { saveUserDataToCache } from '../../src/store/slices/createDataSlice';
import { UserDataSchema } from '../../src/lib/schema';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession, revokeGuestSession } from '../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import type { UserData } from '../../src/types';

const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

beforeEach(async () => {
    await clear();
    localStorage.clear();
    sdk.auth.currentUser = null;
    invalidateSession();
});
afterEach(() => vi.restoreAllMocks());

it('refuses an in-flight guest snapshot that would recreate an archive after logout', async () => {
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-before-logout');
    localStorage.setItem('logbook_is_guest', 'true');
    activateGuestSession('guest-before-logout');

    const inFlight = saveUserDataToCache(data(170));
    revokeGuestSession();
    await expect(inFlight).rejects.toThrow('Sessione cambiata');
    expect(await get('logbook:v2:guest')).toBeUndefined();
});

it('fences an in-flight authenticated snapshot when logout invalidates its epoch', async () => {
    sdk.auth.currentUser = { uid: 'account-a' };
    await initializeLocal('user:account-a', data(170));

    const inFlight = saveUserDataToCache(data(180), data(170));
    invalidateSession();
    await expect(inFlight).rejects.toThrow('Sessione cambiata');
    expect((await readLocal('user:account-a'))?.data.profile.height).toBe('170');
});

it('does not turn bootstrap into an overwrite if another tab initialized first', async () => {
    sdk.auth.currentUser = { uid: 'account-a' };
    await initializeLocal('user:account-a', data(180));
    await saveUserDataToCache(data(180));
    expect((await readLocal('user:account-a'))?.data.profile.height).toBe('180');
});
