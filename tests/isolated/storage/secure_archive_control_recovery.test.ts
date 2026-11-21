import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { del, get, set } from 'idb-keyval';
vi.mock('../../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn() }));
vi.mock('../../../src/lib/healthConsent', () => ({
    requireHealthConsentWritable: vi.fn(), isHealthConsentWritable: vi.fn(() => true),
    getVerifiedHealthConsentRevision: vi.fn(() => 0),
}));

import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { purgeCompletedAccountLocalData } from '../../../src/lib/db/db_account';
import { isLocalPurgePending } from '../../../src/lib/sync/localPurgeFence';
import { vaultControlMirrorId } from '../../../src/lib/sync/secureArchiveControlRecovery';
import { deviceVaultKeyId } from '../../../src/lib/sync/secureArchiveKeys';
import { LocalVaultLockedError, lockVault, readVaultControl, vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';
import { BrowserStorageError } from '../../../src/lib/sync/browserStorage';
import { OWNER_UI_PREFERENCES, ownerUiPreferenceKey } from '../../../src/lib/uiPreferenceKeys';

import { owner, day, base, resetSecureArchiveMigrationFixture } from './secureArchiveMigrationFixture';

beforeEach(resetSecureArchiveMigrationFixture);

describe('vault control recovery and concurrency', () => {
    it('does not activate provisioning while a second tab compacts owner metadata indexes', async () => {
        const safeKey = ownerUiPreferenceKey(owner, OWNER_UI_PREFERENCES[0]);
        const raw = '"session"';
        const decoy = 'logbook:other-tab';
        localStorage.setItem(decoy, 'other-tab');
        localStorage.setItem(safeKey, raw);
        const nativeKey = localStorage.key.bind(localStorage);
        let shifted = false;
        const spy = vi.spyOn(localStorage, 'key').mockImplementation(index => {
            const seen = nativeKey(index);
            if (index === 0 && !shifted && readVaultControl(owner)?.phase === 'migrating') {
                shifted = true;
                localStorage.removeItem(decoy);
            }
            return seen;
        });

        await expect(createAndMigrateVault(owner)).rejects.toThrow('Inventario localStorage modificato');
        spy.mockRestore();
        expect(shifted).toBe(true);
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        const migratingEpoch = readVaultControl(owner)!.epoch;
        expect(localStorage.getItem(safeKey)).toBe(raw);

        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(readVaultControl(owner)?.epoch).toBe(migratingEpoch);
        expect(localStorage.getItem(safeKey)).toBe(raw);
        await initializeLocal(owner, base());
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);
    });

    it('rejects different control epochs instead of selecting a conflicting key', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        const primary = readVaultControl(owner)!;
        const ciphertext = await get('logbook:v2:' + owner);
        await set(vaultControlMirrorId(owner), { ...primary, epoch: 'b'.repeat(32) });
        lockVault(owner);
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
        expect(readVaultControl(owner)).toEqual(primary);
    });

    it('does not misclassify a missing device key as an empty archive', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        const before = await get('logbook:v2:' + owner);
        await del(deviceVaultKeyId(owner));
        lockVault(owner);
        await expect(createAndMigrateVault(owner)).rejects.toThrow();
        expect(await get('logbook:v2:' + owner)).toEqual(before);
    });

    it('resumes activation if the mirror is active but synchronous control is still migrating', async () => {
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
        await initializeLocal(owner, base());
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);
    });

    it('refuses to overwrite malformed primary control even with a good mirror', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
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
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(BrowserStorageError);
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
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(localStorage.getItem(consentCacheKey)).toBe('2');
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);
    });

    it('recognizes only the registered owner-scoped UI flags without blocking vault activation', async () => {
        const preferences = new Map(OWNER_UI_PREFERENCES.map(preference => [
            ownerUiPreferenceKey(owner, preference),
            JSON.stringify(preference.startsWith('creating-') ? false : 'session'),
        ]));
        for (const [key, value] of preferences) localStorage.setItem(key, value);

        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
        for (const [key, value] of preferences) {
            expect(localStorage.getItem(key)).toBe(value);
        }
    });

    it('continues to reject unknown owner UI keys before transforming an archive', async () => {
        const unknown = 'logbook:v2:' + owner + ':ui:unknown-field';
        localStorage.setItem(unknown, 'true');
        await expect(createAndMigrateVault(owner)).rejects.toThrow('chiavi sconosciute');
        expect(localStorage.getItem(unknown)).toBe('true');
        // Fresh-start preflight fails before persisting a new key or control.
        expect(readVaultControl(owner)).toBeNull();
        expect(await get(vaultControlMirrorId(owner))).toBeUndefined();
    });

    it('serializes simultaneous provisioning attempts without replacing a durable key', async () => {
        const data = base();
        expect(await get('logbook:v2:' + owner)).toBeUndefined();

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
        await initializeLocal(owner, data);
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
});
