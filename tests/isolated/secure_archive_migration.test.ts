import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, del, get, set } from 'idb-keyval';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';

vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn() }));
vi.mock('../../src/lib/healthConsent', () => ({
    requireHealthConsentWritable: vi.fn(), isHealthConsentWritable: vi.fn(() => true),
    getVerifiedHealthConsentRevision: vi.fn(() => 0),
}));

import { commitDomainOperations, initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { deviceKey, protectedDeviceKey, readDeviceValue, readDeviceValueStrict, writeDeviceValue } from '../../src/lib/sync/deviceStorage';
import { createAndMigrateVault, resumeVaultMigration } from '../../src/lib/sync/secureArchiveMigration';
import { purgeCompletedAccountLocalData } from '../../src/lib/db/db_account';
import { isLocalPurgePending } from '../../src/lib/sync/localPurgeFence';
import { vaultControlMirrorId } from '../../src/lib/sync/secureArchiveControlRecovery';
import { deviceVaultKeyId } from '../../src/lib/sync/secureArchiveKeys';
import { LocalVaultLockedError, lockAllVaults, lockVault, readVaultControl, unlockVaultForOwner, vaultControlKey } from '../../src/lib/sync/secureArchiveSession';
import { LocalCiphertextError, SEALED_LOCAL_PREFIX } from '../../src/lib/sync/secureArchiveCipher';
import { BrowserStorageError } from '../../src/lib/sync/browserStorage';
import { activateGuestSession, GUEST_SESSION_KEY, GUEST_REVOCATION_KEY } from '../../src/lib/sync/session';
import { collectBackupSnapshot } from '../../src/lib/db/backupSnapshot';
import { OWNER_UI_PREFERENCES, ownerUiPreferenceKey } from '../../src/lib/uiPreferenceKeys';

const owner = 'user:secure-migration';
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

        await createAndMigrateVault(owner);
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
        await unlockVaultForOwner(owner);
        expect(readDeviceValueStrict('workout', owner)).toBe(workout);
    });

    it('fences stale encrypted and legacy writers and provisions a new vault only after purge', async () => {
        await initializeLocal(owner, base());
        await createAndMigrateVault(owner);
        writeDeviceValue('draft_exercise', '{"name":"private"}', owner);
        await purgeCompletedAccountLocalData(owner);
        expect(isLocalPurgePending(owner)).toBe(true);
        expect(await get(vaultControlMirrorId(owner))).toBeUndefined();
        await expect(readLocal(owner)).rejects.toThrow('Pulizia archivio locale');
        expect(() => writeDeviceValue('draft_exercise', '{"name":"stale"}', owner)).toThrow('Pulizia archivio locale');
        await createAndMigrateVault(owner);
        expect(isLocalPurgePending(owner)).toBe(false);
        expect((await readLocal(owner))).toBeUndefined();
        expect(readDeviceValueStrict('draft_exercise', owner)).toBeNull();
    });

    it('does not provision a competing key after control metadata disappears', async () => {
        await initializeLocal(owner, base());
        await createAndMigrateVault(owner);
        writeDeviceValue('draft_exercise', '{"name":"recoverable"}', owner);
        const ciphertext = await get<string>('logbook:v2:' + owner);
        const sealedDevice = localStorage.getItem(protectedDeviceKey('draft_exercise', owner));
        localStorage.removeItem(vaultControlKey(owner));
        lockVault(owner);

        // The authenticated mirror reconstructs the missing synchronous
        // control without minting a different DEK or touching any ciphertext.
        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);
        expect(readDeviceValueStrict('draft_exercise', owner)).toBe('{"name":"recoverable"}');
        expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
        expect(localStorage.getItem(protectedDeviceKey('draft_exercise', owner))).toBe(sealedDevice);
    });

    it('rebuilds an absent mirror only after authenticating the primary control', async () => {
        await initializeLocal(owner, base());
        await createAndMigrateVault(owner);
        const original = readVaultControl(owner);
        await del(vaultControlMirrorId(owner));
        lockVault(owner);
        await createAndMigrateVault(owner);
        expect(await get(vaultControlMirrorId(owner))).toEqual(original);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
    });

    it('preserves ciphertext and fails closed when BOTH controls disappear', async () => {
        await initializeLocal(owner, base());
        await createAndMigrateVault(owner);
        const ciphertext = await get('logbook:v2:' + owner);
        await del(vaultControlMirrorId(owner));
        localStorage.removeItem(vaultControlKey(owner));
        lockVault(owner);
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
        expect(localStorage.getItem(vaultControlKey(owner))).toBeNull();
    });

    it('rejects different control epochs instead of selecting a conflicting key', async () => {
        await initializeLocal(owner, base());
        await createAndMigrateVault(owner);
        const primary = readVaultControl(owner)!;
        const ciphertext = await get('logbook:v2:' + owner);
        await set(vaultControlMirrorId(owner), { ...primary, epoch: 'b'.repeat(32) });
        lockVault(owner);
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
        expect(readVaultControl(owner)).toEqual(primary);
    });

    it('does not misclassify a missing device key as an empty archive', async () => {
        await initializeLocal(owner, base());
        await createAndMigrateVault(owner);
        const before = await get('logbook:v2:' + owner);
        await del(deviceVaultKeyId(owner));
        lockVault(owner);
        await expect(createAndMigrateVault(owner)).rejects.toThrow();
        expect(await get('logbook:v2:' + owner)).toEqual(before);
    });

    it('resumes activation if the mirror is active but synchronous control is still migrating', async () => {
        await initializeLocal(owner, base());
        const nativeSet = localStorage.setItem.bind(localStorage);
        const stop = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            if (key === vaultControlKey(owner) && value.includes('"phase":"active"')) throw new Error('interrupted activation');
            nativeSet(key, value);
        });
        await expect(createAndMigrateVault(owner)).rejects.toThrow();
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect((await get<{ phase: string }>(vaultControlMirrorId(owner)))?.phase).toBe('active');
        stop.mockRestore();
        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);
    });

    it('refuses to overwrite malformed primary control even with a good mirror', async () => {
        await initializeLocal(owner, base());
        await createAndMigrateVault(owner);
        localStorage.setItem(vaultControlKey(owner), '{broken');
        lockVault(owner);
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(localStorage.getItem(vaultControlKey(owner))).toBe('{broken');
    });

    it('resumes a retired-fence crash after the mirror write but before publishing control', async () => {
        await createAndMigrateVault(owner);
        await purgeCompletedAccountLocalData(owner);
        const originalSet = localStorage.setItem.bind(localStorage);
        const fail = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            if (key === vaultControlKey(owner)) throw new Error('crash after writing mirror');
            originalSet(key, value);
        });
        await expect(createAndMigrateVault(owner)).rejects.toThrow('crash after writing mirror');
        expect(readVaultControl(owner)).toBeNull();
        expect((await get<{ phase: string }>(vaultControlMirrorId(owner)))?.phase).toBe('migrating');
        expect(isLocalPurgePending(owner)).toBe(true);
        fail.mockRestore();
        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect((await get<{ phase: string }>(vaultControlMirrorId(owner)))?.phase).toBe('active');
        expect(isLocalPurgePending(owner)).toBe(false);
    });

    it('recovers a crash between replacement control and retired fence release', async () => {
        await createAndMigrateVault(owner);
        await purgeCompletedAccountLocalData(owner);
        const remove = localStorage.removeItem.bind(localStorage);
        const fence = 'logbook:local-purge-fence:v1:' + owner;
        const failure = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
            if (key === fence) throw new Error('storage transient');
            remove(key);
        });
        await expect(createAndMigrateVault(owner)).rejects.toThrow();
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect(isLocalPurgePending(owner)).toBe(true);
        failure.mockRestore();
        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(isLocalPurgePending(owner)).toBe(false);
    });

    it('treats last confirmed consent revision as a safe lifecycle marker, not private plaintext', async () => {
        const consentCacheKey = 'logbook:v2:' + owner + ':health-consent-last-active';
        localStorage.setItem(consentCacheKey, '2');
        await initializeLocal(owner, base());
        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(localStorage.getItem(consentCacheKey)).toBe('2');
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);
    });

    it('recognizes only the registered owner-scoped UI flags without blocking vault activation', async () => {
        await initializeLocal(owner, base());
        const preferences = new Map(OWNER_UI_PREFERENCES.map(preference => [
            ownerUiPreferenceKey(owner, preference),
            JSON.stringify(preference.startsWith('creating-') ? false : 'session'),
        ]));
        for (const [key, value] of preferences) localStorage.setItem(key, value);

        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
        for (const [key, value] of preferences) {
            expect(localStorage.getItem(key)).toBe(value);
        }
    });

    it('continues to reject unknown owner UI keys before transforming an archive', async () => {
        await initializeLocal(owner, base());
        const unknown = 'logbook:v2:' + owner + ':ui:unknown-field';
        localStorage.setItem(unknown, 'true');
        await expect(createAndMigrateVault(owner)).rejects.toThrow('chiavi sconosciute');
        expect(localStorage.getItem(unknown)).toBe('true');
        expect(readVaultControl(owner)?.phase).toBe('migrating');
    });

    it('serializes simultaneous provisioning attempts without replacing a durable key', async () => {
        const data = base();
        await initializeLocal(owner, data);
        const original = await get('logbook:v2:' + owner);
        expect(original).toBeDefined();

        // Match actual Web Locks serialization; both callers checked for no
        // control before their exclusive callbacks were permitted to run.
        let tail = Promise.resolve();
        vi.stubGlobal('navigator', {
            locks: {
                request: async <T,>(_name: string, _options: unknown, run: () => Promise<T>): Promise<T> => {
                    const preceding = tail;
                    let release!: () => void;
                    tail = new Promise<void>(resolve => { release = resolve; });
                    await preceding;
                    try { return await run(); } finally { release(); }
                },
            },
        });

        await Promise.all([createAndMigrateVault(owner), createAndMigrateVault(owner)]);
        const control = readVaultControl(owner);
        expect(control?.phase).toBe('active');
        const ciphertext = await get<string>('logbook:v2:' + owner);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);

        // A later stale initializer must still reuse the original epoch/key.
        lockVault(owner);
        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.epoch).toBe(control?.epoch);
        expect(await get('logbook:v2:' + owner)).toBe(ciphertext);
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);
    });

    it('preserves the old snapshot and resumes an interrupted migration idempotently', async () => {
        await initializeLocal(owner, base());
        localStorage.setItem(deviceKey('draft:measurement:' + day, owner), '{"weight":"77"}');
        const originalSet = localStorage.setItem.bind(localStorage);
        const intercepted = vi.spyOn(localStorage, 'setItem').mockImplementation((name, value) => {
            if (name === protectedDeviceKey('draft:measurement:' + day, owner)) throw new Error('device quota');
            originalSet(name, value);
        });
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(BrowserStorageError);
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect(localStorage.getItem(deviceKey('draft:measurement:' + day, owner))).toBe('{"weight":"77"}');
        expect((await get<string>('logbook:v2:' + owner))?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
        intercepted.mockRestore();

        await resumeVaultMigration(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(localStorage.getItem(deviceKey('draft:measurement:' + day, owner))).toBeNull();
        expect(readDeviceValueStrict('draft:measurement:' + day, owner)).toBe('{"weight":"77"}');
    });

    it('preserves corrupted encrypted drafts against replacements and deletions', async () => {
        await createAndMigrateVault(owner);
        const name = 'draft:measurement:' + day;
        writeDeviceValue(name, '{"weight":"76"}', owner);
        const sealedKey = protectedDeviceKey(name, owner);
        const original = localStorage.getItem(sealedKey)!;
        const at = SEALED_LOCAL_PREFIX.length;
        const damaged = original.slice(0, at) + (original[at] === 'A' ? 'B' : 'A') + original.slice(at + 1);
        localStorage.setItem(sealedKey, damaged);
        expect(() => readDeviceValueStrict(name, owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue(name, '{"weight":"77"}', owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue(name, null, owner)).toThrow(LocalCiphertextError);
        expect(localStorage.getItem(sealedKey)).toBe(damaged);
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    });

    it('never converts an unreadable sealed draft into an empty best-effort value', async () => {
        await initializeLocal(owner, base());
        const name = 'draft:measurement:' + day;
        localStorage.setItem(deviceKey(name, owner), '{"weight":"81"}');
        await createAndMigrateVault(owner);
        const protectedKey = protectedDeviceKey(name, owner);
        const ciphertext = localStorage.getItem(protectedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        const getOriginal = localStorage.getItem.bind(localStorage);
        const deniedRead = vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
            if (key === protectedKey) throw new Error('transient storage denied');
            return getOriginal(key);
        });
        expect(() => readDeviceValue(name, owner)).toThrow(BrowserStorageError);
        deniedRead.mockRestore();
        expect(localStorage.getItem(protectedKey)).toBe(ciphertext);
        expect(readDeviceValue(name, owner)).toBe('{"weight":"81"}');
    });

    it('refuses stale legacy-tab writes instead of hiding or deleting conflicting device data', async () => {
        localStorage.setItem(deviceKey('workout', owner), '{"id":"before"}');
        await createAndMigrateVault(owner);
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

        await createAndMigrateVault('guest');
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
        await expect(createAndMigrateVault(owner)).rejects.toThrow();
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect(await get('logbook:v2:' + owner)).toEqual({ incompatible: 'legacy-bad' });
    });
});
