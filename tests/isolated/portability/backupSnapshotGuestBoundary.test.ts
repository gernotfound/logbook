import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw new Error('Device-only backup must not initialize Firebase');
});

const readGate = vi.hoisted(() => ({
    entered: null as null | (() => void),
    wait: null as null | Promise<void>,
}));
vi.mock('../../../src/lib/sync/localRepository', async importOriginal => {
    const original = await importOriginal<typeof import('../../../src/lib/sync/localRepository')>();
    return {
        ...original,
        readLocal: async (owner: string) => {
            readGate.entered?.();
            if (readGate.wait) await readGate.wait;
            return original.readLocal(owner);
        },
    };
});

import { collectBackupSnapshot } from '../../../src/lib/db/backupSnapshot';
import { UserDataSchema } from '../../../src/lib/schema';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_SESSION_KEY, revokeGuestSession } from '../../../src/lib/sync/session';
import { writeDeviceValue } from '../../../src/lib/sync/deviceStorage';

const data = UserDataSchema.parse({ profile: { height: '174' } });

beforeEach(async () => {
    readGate.entered = null;
    readGate.wait = null;
    await clear();
    localStorage.clear();
    lockAllVaults();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'device-backup-generation');
    activateGuestSession('device-backup-generation');
    await createAndMigrateVault('guest');
});

afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Device-only backup without Firebase', () => {
    it('exports an encrypted guest archive and recovery witness with device-only coverage', async () => {
        await initializeLocal('guest', data);
        writeDeviceValue('workout-intent:' + 'a'.repeat(32), '{"sequence":1}', 'guest');

        const snapshot = await collectBackupSnapshot(data, false);
        expect(snapshot.owner).toBe('guest');
        expect(snapshot.data.profile.height).toBe('174');
        expect(snapshot.coverage).toMatchObject({ scope: 'device' });
        expect(snapshot.recovery.cloudDocuments).toEqual({});
        expect(snapshot.recovery.device).toMatchObject({ ['workout-intent:' + 'a'.repeat(32)]: '{"sequence":1}' });
        expect(snapshot.recovery.envelope?.data.profile.height).toBe('174');
    });

    it('does not replace an absent local archive with a fabricated cloud snapshot', async () => {
        const snapshot = await collectBackupSnapshot(data, false);
        expect(snapshot.recovery.envelope).toBeUndefined();
        expect(snapshot.recovery.cloudDocuments).toEqual({});
        expect(snapshot.coverage).toEqual({ scope: 'device', months: [] });
    });

    it('rejects a guest-generation change during an in-flight device read', async () => {
        await initializeLocal('guest', data);
        let enter!: () => void;
        let release!: () => void;
        const entered = new Promise<void>(resolve => { enter = resolve; });
        readGate.wait = new Promise<void>(resolve => { release = resolve; });
        readGate.entered = enter;

        const pending = collectBackupSnapshot(data, false);
        await entered;
        revokeGuestSession();
        release();
        // The vault may reject the stale read before the facade reaches its
        // session check; neither error is allowed to produce a backup.
        await expect(pending).rejects.toThrow();
    });

    it('loads the legacy transport only for an explicitly cloud-inclusive export', async () => {
        // Vitest wraps a deliberately throwing mock factory. Only an explicit
        // cloud export should reach that factory.
        await expect(collectBackupSnapshot(data, true)).rejects.toThrow(/error when mocking a module/);
    });
});
