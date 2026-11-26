import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw new Error('Guest journal must not initialize Firebase');
});

const readGate = vi.hoisted(() => ({
    entered: null as null | (() => void),
    wait: null as null | Promise<void>,
}));
vi.mock('../../../src/lib/sync/localArchiveBootstrap', async importOriginal => {
    const original = await importOriginal<typeof import('../../../src/lib/sync/localArchiveBootstrap')>();
    return {
        ...original,
        readLocal: async (owner: string) => {
            readGate.entered?.();
            if (readGate.wait) await readGate.wait;
            return original.readLocal(owner);
        },
    };
});

import { DB } from '../../../src/lib/db';
import { UserDataSchema } from '../../../src/lib/schema';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_SESSION_KEY, revokeGuestSession } from '../../../src/lib/sync/session';
import { initializeLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { getGuestHealthConsentStatus, markGuestHealthConsentWithdrawn } from '../../../src/lib/guestHealthConsent';

const initialData = UserDataSchema.parse({ profile: { height: '175' } });

beforeEach(async () => {
    readGate.entered = null;
    readGate.wait = null;
    await clear();
    localStorage.clear();
    lockAllVaults();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    const generation = 'guest-transport-boundary';
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, generation);
    activateGuestSession(generation);
    await createAndMigrateVault('guest');
});

afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Guest journal status without Firebase', () => {
    it('reports local success only after reading an encrypted durable archive', async () => {
        expect(await DB.saveUserData(initialData)).toMatchObject({ ok: false, status: 'failed' });
        await initializeLocal('guest', initialData);
        expect(await DB.saveUserData(initialData)).toEqual({ ok: true, status: 'synced' });
    });

    it('keeps the archive when consent is withdrawn, without remote acknowledgement', async () => {
        await initializeLocal('guest', initialData);
        expect(getGuestHealthConsentStatus()).toBe('active');
        markGuestHealthConsentWithdrawn();
        expect(await DB.saveUserData(initialData)).toMatchObject({ ok: false, status: 'local-pending' });
    });

    it('fails closed when the guest generation is revoked', async () => {
        await initializeLocal('guest', initialData);
        revokeGuestSession();
        expect(await DB.saveUserData(initialData)).toMatchObject({ ok: false, status: 'local-pending' });
    });

    it('does not turn an in-flight archive read into success after consent changes', async () => {
        await initializeLocal('guest', initialData);
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        readGate.wait = new Promise<void>(resolve => { release = resolve; });
        readGate.entered = entered;

        const saving = DB.saveUserData(initialData);
        await started;
        markGuestHealthConsentWithdrawn();
        release();

        expect(await saving).toMatchObject({ ok: false, status: 'failed' });
    });
});
