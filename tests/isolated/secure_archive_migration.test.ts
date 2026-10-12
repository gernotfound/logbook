import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';

vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn() }));
vi.mock('../../src/lib/healthConsent', () => ({
    requireHealthConsentWritable: vi.fn(), isHealthConsentWritable: vi.fn(() => true),
    getVerifiedHealthConsentRevision: vi.fn(() => 0),
}));

import { commitDomainOperations, initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../src/lib/sync/deviceStorage';
import { createAndMigrateVault, resumeVaultMigration } from '../../src/lib/sync/secureArchiveMigration';
import { LocalVaultLockedError, lockAllVaults, lockVault, readVaultControl, unlockVaultWithPassphrase } from '../../src/lib/sync/secureArchiveSession';
import { LocalCiphertextError, SEALED_LOCAL_PREFIX } from '../../src/lib/sync/secureArchiveCipher';
import { activateGuestSession, GUEST_SESSION_KEY, GUEST_REVOCATION_KEY } from '../../src/lib/sync/session';
import { collectBackupSnapshot } from '../../src/lib/db/backupSnapshot';

const owner = 'user:secure-migration';
const phrase = 'unique local strong passphrase 2026';
const day = '2026-10-12';
const base = (): UserData => UserDataSchema.parse({
    profile: { height: '170', gender: 'M' },
    nutrition: { [day]: { date: day, weight: 75, kcal: 0, pro: 0, carbs: 0, fat: 0, meals: [] } },
}) as unknown as UserData;

beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() } });
    await clear();
});

describe('durable secure archive migration', () => {
    it('migrates existing business journal and device-critical records without retaining plaintext', async () => {
        const initial = base();
        await initializeLocal(owner, initial);
        const workout = JSON.stringify({ id: 'workout-test', notes: 'private health note' });
        localStorage.setItem(deviceKey('workout', owner), workout);
        localStorage.setItem(deviceKey('draft:measurement:' + day, owner), JSON.stringify({ weight: '76' }));

        const { recoveryCode } = await createAndMigrateVault(owner, phrase);
        expect(recoveryCode).toMatch(/^[0-9a-f]{64}$/);
        expect(readVaultControl(owner)?.phase).toBe('active');
        const raw = await get('logbook:v2:' + owner);
        expect(typeof raw).toBe('string');
        expect(raw).toContain(SEALED_LOCAL_PREFIX);
        expect(raw).not.toContain('"weight"');
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
        expect(localStorage.getItem(deviceKey('draft:measurement:' + day, owner))).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).not.toContain('private health note');
        expect(readDeviceValueStrict('workout', owner)).toBe(workout);
        expect(readDeviceValueStrict('draft:measurement:' + day, owner)).toContain('76');
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);

        const next = await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '171' } }, initial);
        expect(next.operations).toHaveLength(1);
        expect((await readLocal(owner))?.data.profile?.height).toBe('171');
        expect((await readLocal(owner))?.pending).toEqual(next.operations);
        expect((await get<string>('logbook:v2:' + owner))?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);

        lockVault(owner);
        await expect(readLocal(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(() => readDeviceValueStrict('workout', owner)).toThrow(LocalVaultLockedError);
        await unlockVaultWithPassphrase(owner, phrase);
        expect(readDeviceValueStrict('workout', owner)).toBe(workout);
    });

    it('preserves the old snapshot and resumes an interrupted migration idempotently', async () => {
        await initializeLocal(owner, base());
        localStorage.setItem(deviceKey('draft:measurement:' + day, owner), '{"weight":"77"}');
        const originalSet = localStorage.setItem.bind(localStorage);
        const intercepted = vi.spyOn(localStorage, 'setItem').mockImplementation((name, value) => {
            if (name === protectedDeviceKey('draft:measurement:' + day, owner)) throw new Error('device quota');
            originalSet(name, value);
        });
        await expect(createAndMigrateVault(owner, phrase)).rejects.toThrow('device quota');
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect(localStorage.getItem(deviceKey('draft:measurement:' + day, owner))).toBe('{"weight":"77"}');
        expect((await get<string>('logbook:v2:' + owner))?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
        intercepted.mockRestore();

        await resumeVaultMigration(owner, phrase, 'passphrase');
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(localStorage.getItem(deviceKey('draft:measurement:' + day, owner))).toBeNull();
        expect(readDeviceValueStrict('draft:measurement:' + day, owner)).toBe('{"weight":"77"}');
    });

    it('refuses stale legacy-tab writes instead of hiding or deleting conflicting device data', async () => {
        localStorage.setItem(deviceKey('workout', owner), '{"id":"before"}');
        await createAndMigrateVault(owner, phrase);
        localStorage.setItem(deviceKey('workout', owner), '{"id":"newer-old-tab"}');
        expect(() => readDeviceValueStrict('workout', owner)).toThrow(LocalCiphertextError);
        expect(localStorage.getItem(deviceKey('workout', owner))).toContain('newer-old-tab');
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).not.toContain('newer-old-tab');
    });

    it('exports decrypted device snapshots in an explicit guest JSON backup without exposing plaintext in storage', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'secure-backup-fixture');
        localStorage.removeItem(GUEST_REVOCATION_KEY);
        activateGuestSession('secure-backup-fixture');
        const data = base();
        await initializeLocal('guest', data);
        const notes = '{"notes":"sensitive offline workout"}';
        const draft = '{"weight":"77"}';
        localStorage.setItem(deviceKey('workout', 'guest'), notes);
        localStorage.setItem(deviceKey('draft:measurement:' + day, 'guest'), draft);

        await createAndMigrateVault('guest', phrase);
        const snapshot = await collectBackupSnapshot(data, false);
        expect(snapshot.owner).toBe('guest');
        expect(snapshot.recovery.device).toMatchObject({
            workout: notes,
            ['draft:measurement:' + day]: draft,
        });
        expect(localStorage.getItem(protectedDeviceKey('workout', 'guest'))).not.toContain('sensitive offline workout');
        expect(localStorage.getItem(deviceKey('workout', 'guest'))).toBeNull();
    });

    it('never activates a corrupt legacy archive or silently seeds empty data', async () => {
        await set('logbook:v2:' + owner, { incompatible: 'legacy-bad' });
        await expect(createAndMigrateVault(owner, phrase)).rejects.toThrow();
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect(await get('logbook:v2:' + owner)).toEqual({ incompatible: 'legacy-bad' });
    });
});
