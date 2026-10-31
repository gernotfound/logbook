import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } }, root: vi.fn(), control: vi.fn(), page: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth, getDb: () => ({}), ensureAppCheck: async () => {} }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => ({ exercises: [], foods: [] }) }));
// Cloud backups require a verified active session and the online account key.
// Supply those trusted boundaries explicitly; device recovery and AEAD parsing remain real.
vi.mock('../../src/lib/healthConsent', async () => ({
    ...await vi.importActual<typeof import('../../src/lib/healthConsent')>('../../src/lib/healthConsent'),
    currentHealthConsentStatus: () => 'active',
    requireHealthConsentWritable: () => undefined,
    hasUnreconciledOfflineReaccept: () => false,
    getVerifiedHealthConsentRevision: () => 0,
}));
vi.mock('../../src/lib/sync/cloudAccountKeyAccess', () => ({
    requireCloudAccountDataKey: async () => new Uint8Array(32).fill(18),
    requireRightsExportAccountDataKey: async () => new Uint8Array(32).fill(18),
}));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, ...path: string[]) => path.join('/'), collection: (_db: unknown, ...path: string[]) => path.join('/'),
    documentId: () => 'id', orderBy: () => ({}), limit: (count: number) => ({ count }), startAfter: (item: { id: string }) => ({ after: item.id }),
    query: (path: string, ...parts: object[]) => Object.assign({ path }, ...parts),
    getDocFromServer: (path: string) => path.endsWith('/sync_control/state') ? sdk.control(path) : sdk.root(path),
    getDocsFromServer: sdk.page,
}));
import { collectBackupSnapshot, hasDeviceRecoveryBackupSource } from '../../src/lib/db/backupSnapshot';
import { createBackup, decodeImport } from '../../src/lib/backup';
import { acknowledgeThrough, initializeLocal, commitLocal, readLocal } from '../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { LocalVaultLockedError, lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { SEALED_LOCAL_PREFIX } from '../../src/lib/sync/secureArchiveCipher';
import { readDeviceValueStrict, writeDeviceValue } from '../../src/lib/sync/deviceStorage';
import { UserDataSchema } from '../../src/lib/schema';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../../src/lib/schemaEvolution';
import { invalidateSession } from '../../src/lib/sync/session';
import type { UserData } from '../../src/types';
import { sealCloudDocument, CloudCiphertextError } from '../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../src/lib/sync/semanticProjection/contracts';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const emptySync = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'backup-seed', generation: 1, seq: 0 } };
const testKey = new Uint8Array(32).fill(18);
const currentCloudDoc = (business: Record<string, unknown>, sync: SyncMeta = emptySync, path = '') =>
    sealCloudDocument(testKey, 'a', path, business, sync);

const initializeSealedLocal = async (data: UserData) => {
    await createAndMigrateVault('user:a');
    await initializeLocal('user:a', data);
};

// Carry the real vault control and sealed records into a controllable storage
// snapshot; race injections must not accidentally simulate a missing DEK.
function copyDeviceStorage(): Map<string, string> {
    const values = new Map<string, string>();
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key === null) throw new Error('Incomplete device fixture inventory');
        const value = localStorage.getItem(key);
        if (value === null) throw new Error('Missing device fixture value');
        values.set(key, value);
    }
    return values;
}

function stubConcurrentStorage(values: Map<string, string>, overrides: Partial<Pick<Storage, 'key' | 'getItem'>> = {}): void {
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, String(value)); },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => { values.clear(); },
        ...overrides,
    });
}

beforeEach(async () => {
    lockAllVaults();
    await clear(); vi.resetAllMocks(); invalidateSession(); sdk.auth.currentUser = { uid: 'a' };
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        get length() { return storage.size; },
        key: (index: number) => [...storage.keys()][index] ?? null,
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)); },
        removeItem: (key: string) => { storage.delete(key); },
        clear: () => { storage.clear(); },
    });
    vi.stubGlobal('navigator', {
        locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() },
    });
    sdk.root.mockResolvedValue({ exists: () => true, data: () => currentCloudDoc({ profile: { height: '170', gender: 'M' } }) });
    sdk.control.mockResolvedValue({ exists: () => true, data: () => ({ protocolVersion: 3, replicas: { s00: { lastSeq: 1 } } }) });
    sdk.page.mockResolvedValue({ size: 0, docs: [] });
});
afterEach(() => { lockAllVaults(); vi.unstubAllGlobals(); });


it('persists a backup fixture as AEAD ciphertext and rejects access after vault lock', async () => {
    const data = parse({ profile: { height: '171' } });
    await initializeSealedLocal(data);
    const raw = await get<unknown>('logbook:v2:user:a');
    expect(typeof raw).toBe('string');
    expect((raw as string).startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
    expect((await readLocal('user:a'))?.data.profile?.height).toBe('171');
    lockAllVaults();
    await expect(readLocal('user:a')).rejects.toBeInstanceOf(LocalVaultLockedError);
});

it('preserves business import when optional device recovery exceeds its bounded limit', () => {
    const device = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [
        'draft:activity-cardio-cardio' + index + ':2026-10-04', '{"duration":"20"}',
    ]));
    const original = createBackup(parse({ profile: { height: '175' } }), 'user:a',
        { scope: 'device', months: [] }, { device });
    const decoded = decodeImport(original, 'user:a');
    expect(decoded.data).toMatchObject({ profile: { height: '175' } });
    expect(decoded.deviceDrafts).toEqual([]);
    expect(decoded.deviceDraftRecoveryWarning).toContain('troppe bozze');
    expect((original.recovery as { device: Record<string, string> }).device).toEqual(device);
});


it('does not count raw independent witnesses against optional portable-draft recovery limits', () => {
    const witnesses = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [
        'draft:buffered-intent:' + index.toString(16).padStart(32, '0'), '{}',
    ]));
    const device = { ...witnesses, draft_routine: '{"name":"restorable"}' };
    const original = createBackup(parse({ profile: { height: '175' } }), 'user:a',
        { scope: 'device', months: [] }, { device });
    const decoded = decodeImport(original, 'user:a');
    expect(decoded.deviceDrafts).toEqual([{ name: 'draft_routine', value: '{"name":"restorable"}' }]);
    expect(decoded.deviceDraftRecoveryWarning).toBeNull();
    expect((original.recovery as { device: Record<string, string> }).device).toEqual(device);
});

it('does not silently drop an explicit malformed device recovery section', () => {
    const original = createBackup(parse({ profile: { height: '175' } }), 'user:a',
        { scope: 'device', months: [] }, { device: [] });
    const decoded = decodeImport(original, 'user:a');
    expect(decoded.data).toMatchObject({ profile: { height: '175' } });
    expect(decoded.deviceDrafts).toEqual([]);
    expect(decoded.deviceDraftRecoveryWarning).toContain('sezione bozze');
});

it('makes a malformed optional device draft visible without blocking valid business data', () => {
    const original = createBackup(parse({ profile: { height: '175' } }), 'user:a',
        { scope: 'device', months: [] }, { device: { draft_routine: '{' } });
    const decoded = decodeImport(original, 'user:a');
    expect(decoded.data).toMatchObject({ profile: { height: '175' } });
    expect(decoded.deviceDrafts).toEqual([]);
    expect(decoded.deviceDraftRecoveryWarning).toContain('non JSON');
});

it('exports a complete authenticated cloud snapshot without leaking ciphertext or accepting plaintext under an ADK', async () => {
    const key = testKey;
    const sync: SyncMeta = {
        protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's00', replicaId: 'backup-seed', generation: 1, seq: 0 },
    };
    const base = parse({ profile: { height: '175' } });
    await initializeSealedLocal(base);
    const root = sealCloudDocument(key, 'a', '', { profile: { height: '174', gender: 'M' } }, sync);
    const month = sealCloudDocument(key, 'a', 'history_months/2026-05',
        { w1: { id: 'w1', date: '2026-05-11', exercises: [] } }, sync);
    sdk.root.mockResolvedValue({ exists: () => true, data: () => root });
    sdk.page.mockImplementation(async ({ path }) => path.endsWith('/history_months')
        ? { size: 1, docs: [{ id: '2026-05', data: () => month }] }
        : { size: 0, docs: [] });
    const backup = await collectBackupSnapshot(base, true, 0, key);
    expect(backup.coverage.scope).toBe('cloud-and-device');
    expect(backup.data.profile?.height).toBe('174');
    expect(backup.data.history?.map(w => w.id)).toEqual(['w1']);
    expect((backup.recovery.cloudDocuments as Record<string, any>)['']).not.toHaveProperty('_sealed');
    expect((backup.recovery.cloudDocuments as Record<string, any>)['history_months/2026-05']).not.toHaveProperty('_sealed');

    sdk.root.mockResolvedValue({ exists: () => true, data: () =>
        ({ profile: { height: 'plaintext' }, _schemaVersion: CURRENT_DATA_SCHEMA, _sync: emptySync }) });
    await expect(collectBackupSnapshot(base, true, 0, key)).rejects.toBeInstanceOf(CloudCiphertextError);
});

it('collects every page of historical documents beyond the 3-month view and retains a concurrent local edit', async () => {
    const base = parse({ profile: { height: '170', gender: 'M' } });
    await initializeSealedLocal(base);
    const months = Array.from({ length: 105 }, (_, index) => (2017 + Math.floor(index / 12)) + '-' + String(index % 12 + 1).padStart(2, '0'));
    let mutated = false;
    sdk.page.mockImplementation(async ({ path, after, count }) => {
        if (path.endsWith('nutrition_months')) return { size: 0, docs: [] };
        const ids = months.filter(id => !after || id > after).slice(0, count);
        if (after && !mutated) {
            mutated = true;
            await commitLocal('user:a', parse({ profile: { height: '175', gender: 'M' } }), base);
        }
        return { size: ids.length, docs: ids.map(id => ({ id, data: () => currentCloudDoc({ ['h' + id]: { id: 'h' + id, date: id + '-01' } }, emptySync, 'history_months/' + id) })) };
    });
    const backup = await collectBackupSnapshot(base, true);
    expect(backup.data.history).toHaveLength(105);
    expect(backup.data.profile?.height).toBe('175');
    expect(backup.coverage).toMatchObject({ scope: 'cloud-and-device', months });
    expect(sdk.page).toHaveBeenCalledTimes(8);
    expect(backup.recovery.envelope?.pending.length).toBeGreaterThan(0);
});

it('retries when an edit is acknowledged while the cloud scan is in flight', async () => {
    const base = parse({ profile: { height: '170', gender: 'M' } });
    const updated = parse({ profile: { height: '175', gender: 'M' } });
    await initializeSealedLocal(base);
    let advanced = false;

    sdk.page.mockImplementation(async ({ path }) => {
        if (!advanced && path.endsWith('history_months')) {
            advanced = true;
            await commitLocal('user:a', updated, base);
            const envelope = await readLocal('user:a');
            expect(envelope?.pending.length).toBeGreaterThan(0);
            sdk.root.mockResolvedValue({ exists: () => true, data: () => currentCloudDoc({ profile: { height: '175', gender: 'M' } }) });
            await acknowledgeThrough('user:a', envelope!.actorSeq, updated);
            expect((await readLocal('user:a'))?.pending).toHaveLength(0);
        }
        return { size: 0, docs: [] };
    });

    const backup = await collectBackupSnapshot(base, true);
    expect(backup.data.profile?.height).toBe('175');
    expect(sdk.root).toHaveBeenCalledTimes(2);
});

it('retries when another device updates the replica control during the cloud scan', async () => {
    const data = parse({ profile: { height: '170' } });
    await initializeSealedLocal(data);
    let reads = 0;
    sdk.control.mockImplementation(async () => {
        reads += 1;
        const lastSeq = reads === 1 ? 1 : 2;
        return { exists: () => true, data: () => ({ protocolVersion: 3, replicas: { s00: { lastSeq } } }) };
    });

    const backup = await collectBackupSnapshot(data, true);
    expect(backup.coverage.scope).toBe('cloud-and-device');
    expect(sdk.control).toHaveBeenCalledTimes(4);
    expect(sdk.page).toHaveBeenCalledTimes(4);
});

it('fails closed after repeated concurrent remote changes instead of exporting mixed data', async () => {
    const data = parse({});
    await initializeSealedLocal(data);
    let revision = 0;
    sdk.control.mockImplementation(async () => ({
        exists: () => true,
        data: () => ({ lastSeq: ++revision }),
    }));
    await expect(collectBackupSnapshot(data, true)).rejects.toThrow('cloud è cambiato durante il backup');
    expect(sdk.page).toHaveBeenCalledTimes(4);
});

it('uses root _sync metadata when replaying pending local operations', async () => {
    const base = parse({ profile: { height: '170', gender: 'M' } });
    const local = parse({ profile: { height: '175', gender: 'M' } });
    await initializeSealedLocal(base);
    await commitLocal('user:a', local, base);
    const envelope = await readLocal('user:a');
    expect(envelope?.pending.length).toBeGreaterThan(0);

    const actorId = envelope!.actorId;
    const remoteSeq = envelope!.actorSeq + 1;
    sdk.root.mockResolvedValue({
        exists: () => true,
        data: () => sealCloudDocument(testKey, 'a', '', { profile: { height: '180', gender: 'M' } }, {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { [actorId]: remoteSeq },
            fields: {
                'profile/height': { clock: { [actorId]: remoteSeq }, actorId, seq: remoteSeq }
            },
            writer: { slot: 's00', replicaId: 'backup-seed', generation: 1, seq: remoteSeq }
        })
    });

    const backup = await collectBackupSnapshot(base, true);
    expect(backup.data.profile?.height).toBe('180');
});

it('keeps schema/sync metadata out of history and nutrition business data while preserving raw recovery docs', async () => {
    const base = parse({});
    await initializeSealedLocal(base);
    sdk.page.mockImplementation(async ({ path }) => {
        if (path.endsWith('history_months')) {
            return {
                size: 1,
                docs: [{ id: '2026-09', data: () => currentCloudDoc({
                    w1: { id: 'w1', date: '2026-09-10', routineName: 'A', duration: '20m', exercises: [] },
                }, emptySync, 'history_months/2026-09') }]
            };
        }
        return {
            size: 1,
            docs: [{ id: '2026-09', data: () => currentCloudDoc({
                '2026-09-10': { date: '2026-09-10', weight: 80 },
            }, emptySync, 'nutrition_months/2026-09') }]
        };
    });

    const backup = await collectBackupSnapshot(base, true);
    expect(backup.data.history?.map(item => item.id)).toEqual(['w1']);
    expect(Object.keys(backup.data.nutrition ?? {})).toEqual(['2026-09-10']);
    expect((backup.data.nutrition as any)?._sync).toBeUndefined();
    const rawHistory = (backup.recovery.cloudDocuments as any)['history_months/2026-09'];
    expect(rawHistory._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(rawHistory._sync).toEqual(emptySync);
});

it('refuses to label a cloud backup complete if any monthly record would be silently omitted', async () => {
    const data = parse({});
    await initializeSealedLocal(data);
    sdk.page.mockImplementation(async ({ path }) => path.endsWith('history_months')
        ? { size: 1, docs: [{ id: '2026-09', data: () => currentCloudDoc({
            good: { id: 'good', date: '2026-09-10', exercises: [] },
            damaged: { id: 'different', date: '2026-09-11', exercises: [] },
        }, emptySync, 'history_months/2026-09') }] }
        : { size: 0, docs: [] });
    await expect(collectBackupSnapshot(data, true)).rejects.toThrow('Shard storico 2026-09 non integro');
    expect((await collectBackupSnapshot(data, false)).coverage.scope).toBe('device');
});

it('fails safe when cloud causal metadata is malformed', async () => {
    const base = parse({ profile: { height: '170' } });
    await initializeSealedLocal(base);
    sdk.root.mockResolvedValue({
        exists: () => true,
        data: () => ({
            ...currentCloudDoc({ profile: { height: '180' } }),
            _sync: { ...emptySync, fields: { broken: 'invalid' } }
        })
    });

    await expect(collectBackupSnapshot(base, true)).rejects.toBeInstanceOf(CloudCiphertextError);
});

it('refuses future data or sync versions before producing a backup snapshot', async () => {
    const base = parse({ profile: { height: '170' } });
    await initializeSealedLocal(base);

    sdk.root.mockResolvedValue({
        exists: () => true,
        data: () => ({
            ...currentCloudDoc({ profile: { height: '180' } }),
            _schemaVersion: CURRENT_DATA_SCHEMA + 1,
        })
    });
    await expect(collectBackupSnapshot(base, true)).rejects.toBeInstanceOf(CloudCiphertextError);

    sdk.root.mockResolvedValue({
        exists: () => true,
        data: () => ({
            ...currentCloudDoc({ profile: { height: '180' } }),
            _sync: { ...emptySync, protocolVersion: CURRENT_SYNC_PROTOCOL + 1 }
        })
    });
    await expect(collectBackupSnapshot(base, true)).rejects.toBeInstanceOf(CloudCiphertextError);
});

it('exports only allowlisted recovery device data and excludes account-deletion receipts', async () => {
    const data = parse({ profile: { height: '171' } });
    await initializeSealedLocal(data);
    const deviceRecords = [
        ['workout', '{"id":"w1"}'],
        ['draft:measurement:2026-10-04', '{"weight":"80"}'],
        ['history-editor-context', '{"version":1,"editorId":"e1"}'],
        ['workout-intent:' + 'a'.repeat(32), '{"__logbookWorkoutIntent":1}'],
        ['telemetry_queue', '[{"event":"x"}]'],
    ];
    for (const [name, value] of deviceRecords) writeDeviceValue(name, value, 'user:a');
    expect(localStorage.getItem('logbook:v2:user:a:workout')).toBeNull();
    expect(localStorage.getItem('logbook:v2:user:a:sealed:workout')?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);

    localStorage.setItem('logbook:v2:user:a:workout-intent:not-valid', '{"bad":true}');
    localStorage.setItem('logbook:v2:user:b:workout', '{"id":"foreign"}');
    localStorage.setItem('logbook:v2:user:a:account-deletion', '{"receiptToken":"super-secret-receipt"}');
    localStorage.setItem('logbook:v2:user:a:storage_marker', '{"timestamp":1}');

    const backup = await collectBackupSnapshot(data, false);
    expect(backup.recovery.device).toEqual({
        workout: '{"id":"w1"}',
        'draft:measurement:2026-10-04': '{"weight":"80"}',
        'history-editor-context': '{"version":1,"editorId":"e1"}',
        ['workout-intent:' + 'a'.repeat(32)]: '{"__logbookWorkoutIntent":1}',
    });
    expect(JSON.stringify(backup.recovery)).not.toContain('super-secret-receipt');
    expect(backup.recovery.device).not.toHaveProperty('account-deletion');
    expect(backup.recovery.device).not.toHaveProperty('telemetry_queue');
    expect(backup.recovery.device).not.toHaveProperty('storage_marker');
});


it('aborts instead of exporting a stale value if another tab changes a witness during backup', async () => {
    const name = 'draft:dated-intent:' + 'a'.repeat(32);
    const key = 'logbook:v2:user:a:sealed:' + name;
    await initializeSealedLocal(parse({}));
    writeDeviceValue(name, '{"weight":"75"}', 'user:a');
    const values = copyDeviceStorage();
    let changed = false;
    stubConcurrentStorage(values, {
        getItem: (readKey: string) => {
            const value = values.get(readKey) ?? null;
            if (readKey === key && !changed) {
                changed = true;
                // Simulate another tab's valid AEAD update between the two reads.
                writeDeviceValue(name, '{"weight":"76"}', 'user:a');
            }
            return value;
        },
    });
    await expect(collectBackupSnapshot(parse({}), false))
        .rejects.toThrow('I valori di recupero sono cambiati');
    expect(changed).toBe(true);
    expect(values.get(key)?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
    expect(readDeviceValueStrict(name, 'user:a')).toBe('{"weight":"76"}');
});


it('aborts instead of omitting a newly added independent witness mid-export', async () => {
    const firstName = 'draft:buffered-intent:' + 'a'.repeat(32);
    const secondName = 'draft:buffered-intent:' + 'b'.repeat(32);
    const first = 'logbook:v2:user:a:sealed:' + firstName;
    const second = 'logbook:v2:user:a:sealed:' + secondName;
    await initializeSealedLocal(parse({}));
    writeDeviceValue(firstName, '{"value":"editor A"}', 'user:a');
    const values = copyDeviceStorage();
    let added = false;
    stubConcurrentStorage(values, {
        getItem: (readKey: string) => {
            const value = values.get(readKey) ?? null;
            if (readKey === first && !added) {
                added = true;
                writeDeviceValue(secondName, '{"value":"editor B"}', 'user:a');
            }
            return value;
        },
    });
    await expect(collectBackupSnapshot(parse({}), false))
        .rejects.toThrow('Le copie di recupero sono cambiate');
    expect(added).toBe(true);
    expect(values.get(first)?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
    expect(values.get(second)?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
    expect(readDeviceValueStrict(secondName, 'user:a')).toBe('{"value":"editor B"}');
});


it('aborts if a witness disappears during collection instead of reporting a complete device backup', async () => {
    const name = 'workout-intent:' + 'e'.repeat(32);
    const key = 'logbook:v2:user:a:sealed:' + name;
    await initializeSealedLocal(parse({}));
    writeDeviceValue(name, '{"sequence":1}', 'user:a');
    const values = copyDeviceStorage();
    let removed = false;
    stubConcurrentStorage(values, {
        getItem: (readKey: string) => {
            const value = values.get(readKey) ?? null;
            if (readKey === key && !removed) {
                removed = true;
                values.delete(key);
            }
            return value;
        },
    });
    await expect(collectBackupSnapshot(parse({}), false))
        .rejects.toThrow('Le copie di recupero sono cambiate');
    expect(removed).toBe(true);
    expect(values.has(key)).toBe(false);
});


it('refuses a false no-source result when a concurrent tab shifts the localStorage key indexes', async () => {
    const unrelated = 'logbook:v2:user:a:telemetry_queue';
    const name = 'workout-intent:' + 'f'.repeat(32);
    const witness = 'logbook:v2:user:a:sealed:' + name;
    const original = '{"__logbookWorkoutIntent":1,"sequence":1}';
    await createAndMigrateVault('user:a');
    writeDeviceValue(name, original, 'user:a');
    const values = new Map<string, string>([[unrelated, '[]'], ...copyDeviceStorage()]);
    const ciphertext = values.get(witness);
    expect(ciphertext?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
    let shifted = false;
    stubConcurrentStorage(values, {
        key: (index: number) => {
            const key = [...values.keys()][index] ?? null;
            if (index === 0 && !shifted) {
                shifted = true;
                values.delete(unrelated);
            }
            return key;
        },
    });

    // A one-pass index scan would miss the witness and falsely deny export.
    // The stable snapshot preflight must detect the changing membership.
    expect(() => hasDeviceRecoveryBackupSource('user:a'))
        .toThrow('Le copie di recupero sono cambiate durante il backup');
    expect(shifted).toBe(true);
    expect(values.get(witness)).toBe(ciphertext);
    expect(hasDeviceRecoveryBackupSource('user:a')).toBe(true);

    values.delete(witness);
    expect(hasDeviceRecoveryBackupSource('user:a')).toBe(false);
});


it('rejects duplicate index observations rather than exporting only one of two physical witnesses', async () => {
    const firstName = 'workout-intent:' + 'a'.repeat(32);
    const secondName = 'workout-intent:' + 'b'.repeat(32);
    const a = 'logbook:v2:user:a:sealed:' + firstName;
    await createAndMigrateVault('user:a');
    writeDeviceValue(firstName, '{"__logbookWorkoutIntent":1,"sequence":1}', 'user:a');
    writeDeviceValue(secondName, '{"__logbookWorkoutIntent":1,"sequence":2}', 'user:a');
    const values = copyDeviceStorage();
    let shifting = true;
    stubConcurrentStorage(values, {
        // A key shifting between index observations may be returned twice,
        // even though two distinct physical recovery records still exist.
        key: (index: number) => shifting ? a : [...values.keys()][index] ?? null,
    });

    expect(() => hasDeviceRecoveryBackupSource('user:a'))
        .toThrow('Le copie di recupero sono cambiate durante il backup');
    expect(values.size).toBeGreaterThanOrEqual(3);

    shifting = false;
    const backup = await collectBackupSnapshot(parse({}), false);
    expect(Object.keys(backup.recovery.device)).toEqual([firstName, secondName]);
});


it('retains a crash-only private workout witness in an explicit partial backup without replaying it on import', async () => {
    const source = '{"__logbookWorkoutIntent":1,"sequence":1}';
    const key = 'workout-intent:' + 'f'.repeat(32);
    await createAndMigrateVault('user:a');
    writeDeviceValue(key, source, 'user:a');
    const witness = 'logbook:v2:user:a:sealed:' + key;
    const values = copyDeviceStorage();
    const ciphertext = values.get(witness);
    expect(ciphertext?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
    values.set('logbook:v2:user:b:workout', '{"id":"foreign"}');
    values.set('logbook:v2:user:a:account-deletion', '{"secret":"do-not-export"}');
    stubConcurrentStorage(values);
    expect(hasDeviceRecoveryBackupSource('user:a')).toBe(true);

    const backup = await collectBackupSnapshot(parse({}), false);
    expect(backup.coverage.scope).toBe('device');
    expect(backup.recovery.envelope).toBeUndefined();
    expect(backup.recovery.device).toEqual({ [key]: source });
    expect(values.get(witness)).toBe(ciphertext);
    const exported = createBackup(backup.data, 'user:a', backup.coverage, backup.recovery);
    const decoded = decodeImport(exported, 'user:a');
    expect((exported.recovery as { device: Record<string, string> }).device[key]).toBe(source);
    expect(decoded.deviceWorkoutRaw).toBeNull();
    expect(decoded.deviceDrafts).toEqual([]);
    expect(JSON.stringify(exported)).not.toContain('do-not-export');
    expect(JSON.stringify(exported)).not.toContain('foreign');
});

it('refuses a full backup when a locally acknowledged month is absent on server', async () => {
    const data = parse({ nutrition: { '2025-01-01': { date: '2025-01-01', weight: 70 } } });
    await initializeSealedLocal(data);
    await acknowledgeThrough('user:a', 0, data, [], {
        'nutrition_months/2025-01': { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
    });
    await expect(collectBackupSnapshot(data, true)).rejects.toThrow(/Backup cloud incompleto/);
    const device = await collectBackupSnapshot(data, false);
    expect(device.coverage.scope).toBe('device');
    expect(device.data.nutrition?.['2025-01-01']?.weight).toBe(70);
});

it('never labels a failed cloud scan complete; explicit device export still works', async () => {
    const data = parse({ profile: { height: '171' } });
    await initializeSealedLocal(data);
    sdk.page.mockRejectedValue(new Error('offline'));
    await expect(collectBackupSnapshot(data, true)).rejects.toThrow('offline');
    expect((await collectBackupSnapshot(data, false)).coverage.scope).toBe('device');
});

it('aborts if the account changes between pages', async () => {
    await initializeSealedLocal(parse({}));
    sdk.page.mockImplementation(async () => { sdk.auth.currentUser = { uid: 'b' }; invalidateSession(); return { size: 0, docs: [] }; });
    await expect(collectBackupSnapshot(parse({}), true)).rejects.toThrow('Sessione cambiata');
});
