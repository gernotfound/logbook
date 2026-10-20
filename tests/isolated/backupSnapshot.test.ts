import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } }, root: vi.fn(), control: vi.fn(), page: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth, getDb: () => ({}), ensureAppCheck: async () => {} }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => ({ exercises: [], foods: [] }) }));
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
import { UserDataSchema } from '../../src/lib/schema';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL, FutureVersionError } from '../../src/lib/schemaEvolution';
import { invalidateSession } from '../../src/lib/sync/session';
import type { UserData } from '../../src/types';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const emptySync = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'backup-seed', generation: 1, seq: 0 } };
const currentCloudDoc = (business: Record<string, unknown>, sync: unknown = emptySync) => ({ ...business, _schemaVersion: CURRENT_DATA_SCHEMA, _sync: sync });

beforeEach(async () => {
    await clear(); vi.resetAllMocks(); invalidateSession(); sdk.auth.currentUser = { uid: 'a' };
    vi.stubGlobal('localStorage', { length: 0, getItem: () => null });
    sdk.root.mockResolvedValue({ exists: () => true, data: () => currentCloudDoc({ profile: { height: '170', gender: 'M' } }) });
    sdk.control.mockResolvedValue({ exists: () => true, data: () => ({ protocolVersion: 3, replicas: { s00: { lastSeq: 1 } } }) });
    sdk.page.mockResolvedValue({ size: 0, docs: [] });
});
afterEach(() => vi.unstubAllGlobals());


it('preserves business import when optional device recovery exceeds its bounded limit', () => {
    const device = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [
        'draft:buffered-intent:' + index.toString(16).padStart(32, '0'), '{}',
    ]));
    const original = createBackup(parse({ profile: { height: '175' } }), 'user:a',
        { scope: 'device', months: [] }, { device });
    const decoded = decodeImport(original, 'user:a');
    expect(decoded.data).toMatchObject({ profile: { height: '175' } });
    expect(decoded.deviceDrafts).toEqual([]);
    expect(decoded.deviceDraftRecoveryWarning).toContain('troppe bozze');
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

it('collects every page of historical documents beyond the 3-month view and retains a concurrent local edit', async () => {
    const base = parse({ profile: { height: '170', gender: 'M' } });
    await initializeLocal('user:a', base);
    const months = Array.from({ length: 105 }, (_, index) => (2017 + Math.floor(index / 12)) + '-' + String(index % 12 + 1).padStart(2, '0'));
    let mutated = false;
    sdk.page.mockImplementation(async ({ path, after, count }) => {
        if (path.endsWith('nutrition_months')) return { size: 0, docs: [] };
        const ids = months.filter(id => !after || id > after).slice(0, count);
        if (after && !mutated) {
            mutated = true;
            await commitLocal('user:a', parse({ profile: { height: '175', gender: 'M' } }), base);
        }
        return { size: ids.length, docs: ids.map(id => ({ id, data: () => currentCloudDoc({ ['h' + id]: { id: 'h' + id, date: id + '-01' } }) })) };
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
    await initializeLocal('user:a', base);
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
    await initializeLocal('user:a', data);
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
    await initializeLocal('user:a', data);
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
    await initializeLocal('user:a', base);
    await commitLocal('user:a', local, base);
    const envelope = await readLocal('user:a');
    expect(envelope?.pending.length).toBeGreaterThan(0);

    const actorId = envelope!.actorId;
    const remoteSeq = envelope!.actorSeq + 1;
    sdk.root.mockResolvedValue({
        exists: () => true,
        data: () => ({
            profile: { height: '180', gender: 'M' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: {
                protocolVersion: CURRENT_SYNC_PROTOCOL,
                clock: { [actorId]: remoteSeq },
                fields: {
                    'profile/height': {
                        clock: { [actorId]: remoteSeq },
                        actorId,
                        seq: remoteSeq
                    }
                },
                writer: { slot: 's00', replicaId: 'backup-seed', generation: 1, seq: remoteSeq }
            }
        })
    });

    const backup = await collectBackupSnapshot(base, true);
    expect(backup.data.profile?.height).toBe('180');
});

it('keeps schema/sync metadata out of history and nutrition business data while preserving raw recovery docs', async () => {
    const base = parse({});
    await initializeLocal('user:a', base);
    sdk.page.mockImplementation(async ({ path }) => {
        if (path.endsWith('history_months')) {
            return {
                size: 1,
                docs: [{ id: '2026-09', data: () => ({
                    w1: { id: 'w1', date: '2026-09-10', routineName: 'A', duration: '20m', exercises: [] },
                    _schemaVersion: CURRENT_DATA_SCHEMA,
                    _sync: emptySync
                }) }]
            };
        }
        return {
            size: 1,
            docs: [{ id: '2026-09', data: () => ({
                '2026-09-10': { date: '2026-09-10', weight: 80 },
                _schemaVersion: CURRENT_DATA_SCHEMA,
                _sync: emptySync
            }) }]
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
    await initializeLocal('user:a', data);
    sdk.page.mockImplementation(async ({ path }) => path.endsWith('history_months')
        ? { size: 1, docs: [{ id: '2026-09', data: () => currentCloudDoc({
            good: { id: 'good', date: '2026-09-10', exercises: [] },
            damaged: { id: 'different', date: '2026-09-11', exercises: [] },
        }) }] }
        : { size: 0, docs: [] });
    await expect(collectBackupSnapshot(data, true)).rejects.toThrow('Shard storico 2026-09 non integro');
    expect((await collectBackupSnapshot(data, false)).coverage.scope).toBe('device');
});

it('fails safe when cloud causal metadata is malformed', async () => {
    const base = parse({ profile: { height: '170' } });
    await initializeLocal('user:a', base);
    sdk.root.mockResolvedValue({
        exists: () => true,
        data: () => currentCloudDoc({ profile: { height: '180' } }, { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: { broken: 'invalid' }, writer: { slot: 's00', replicaId: 'backup-seed', generation: 1, seq: 0 } })
    });

    await expect(collectBackupSnapshot(base, true)).rejects.toThrow('Metadati _sync non validi');
});

it('refuses future data or sync versions before producing a backup snapshot', async () => {
    const base = parse({ profile: { height: '170' } });
    await initializeLocal('user:a', base);

    sdk.root.mockResolvedValue({
        exists: () => true,
        data: () => ({
            profile: { height: '180' },
            _schemaVersion: CURRENT_DATA_SCHEMA + 1,
            _sync: emptySync,
        })
    });
    await expect(collectBackupSnapshot(base, true)).rejects.toThrow(FutureVersionError);

    sdk.root.mockResolvedValue({
        exists: () => true,
        data: () => ({
            profile: { height: '180' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL + 1, clock: {}, fields: {} }
        })
    });
    await expect(collectBackupSnapshot(base, true)).rejects.toThrow(FutureVersionError);
});

it('exports only allowlisted recovery device data and excludes account-deletion receipts', async () => {
    const data = parse({ profile: { height: '171' } });
    await initializeLocal('user:a', data);
    const values = new Map<string, string>([
        ['logbook:v2:user:a:workout', '{"id":"w1"}'],
        ['logbook:v2:user:a:draft:measurement:2026-10-04', '{"weight":"80"}'],
        ['logbook:v2:user:a:history-editor-context', '{"version":1,"editorId":"e1"}'],
        ['logbook:v2:user:a:workout-intent:' + 'a'.repeat(32), '{"__logbookWorkoutIntent":1}'],
        ['logbook:v2:user:a:workout-intent:not-valid', '{"bad":true}'],
        ['logbook:v2:user:b:workout', '{"id":"foreign"}'],
        ['logbook:v2:user:a:account-deletion', '{"receiptToken":"super-secret-receipt"}'],
        ['logbook:v2:user:a:telemetry_queue', '[{"event":"x"}]'],
        ['logbook:v2:user:a:storage_marker', '{"timestamp":1}'],
    ]);
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
    });

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
    const key = 'logbook:v2:user:a:' + name;
    const values = new Map([[key, '{"weight":"75"}']]);
    let changed = false;
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (readKey: string) => {
            const value = values.get(readKey) ?? null;
            if (readKey === key && !changed) {
                changed = true;
                values.set(key, '{"weight":"76"}');
            }
            return value;
        },
    });
    await expect(collectBackupSnapshot(parse({}), false))
        .rejects.toThrow('I valori di recupero sono cambiati');
    expect(changed).toBe(true);
    expect(values.get(key)).toBe('{"weight":"76"}');
});

it('aborts instead of omitting a newly added independent witness mid-export', async () => {
    const first = 'logbook:v2:user:a:draft:buffered-intent:' + 'a'.repeat(32);
    const second = 'logbook:v2:user:a:draft:buffered-intent:' + 'b'.repeat(32);
    const values = new Map([[first, '{"value":"editor A"}']]);
    let added = false;
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (readKey: string) => {
            const value = values.get(readKey) ?? null;
            if (readKey === first && !added) {
                added = true;
                values.set(second, '{"value":"editor B"}');
            }
            return value;
        },
    });
    await expect(collectBackupSnapshot(parse({}), false))
        .rejects.toThrow('Le copie di recupero sono cambiate');
    expect(added).toBe(true);
    expect(values.size).toBe(2);
});

it('aborts if a witness disappears during collection instead of reporting a complete device backup', async () => {
    const key = 'logbook:v2:user:a:workout-intent:' + 'e'.repeat(32);
    const values = new Map([[key, '{"sequence":1}']]);
    let removed = false;
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        key: (index: number) => [...values.keys()][index] ?? null,
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
});

it('refuses a false no-source result when a concurrent tab shifts the localStorage key indexes', () => {
    const unrelated = 'logbook:v2:user:a:telemetry_queue';
    const witness = 'logbook:v2:user:a:workout-intent:' + 'f'.repeat(32);
    const original = '{"__logbookWorkoutIntent":1,"sequence":1}';
    const values = new Map([[unrelated, '[]'], [witness, original]]);
    let shifted = false;
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        key: (index: number) => {
            const key = [...values.keys()][index] ?? null;
            if (index === 0 && !shifted) {
                shifted = true;
                values.delete(unrelated);
            }
            return key;
        },
        getItem: (key: string) => values.get(key) ?? null,
    });

    // A one-pass index scan would miss the witness and falsely deny export.
    // The stable snapshot preflight must detect the changing membership.
    expect(() => hasDeviceRecoveryBackupSource('user:a'))
        .toThrow('Le copie di recupero sono cambiate durante il backup');
    expect(shifted).toBe(true);
    expect(values.get(witness)).toBe(original);
    expect(hasDeviceRecoveryBackupSource('user:a')).toBe(true);

    values.delete(witness);
    expect(hasDeviceRecoveryBackupSource('user:a')).toBe(false);
});

it('rejects duplicate index observations rather than exporting only one of two physical witnesses', async () => {
    const a = 'logbook:v2:user:a:workout-intent:' + 'a'.repeat(32);
    const b = 'logbook:v2:user:a:workout-intent:' + 'b'.repeat(32);
    const values = new Map([[a, '{"__logbookWorkoutIntent":1,"sequence":1}'],
        [b, '{"__logbookWorkoutIntent":1,"sequence":2}']]);
    let shifting = true;
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        // A key shifting between index observations may be returned twice,
        // even though two distinct physical recovery records still exist.
        key: (index: number) => shifting ? a : [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
    });

    expect(() => hasDeviceRecoveryBackupSource('user:a'))
        .toThrow('Le copie di recupero sono cambiate durante il backup');
    expect(values.size).toBe(2);

    shifting = false;
    const backup = await collectBackupSnapshot(parse({}), false);
    expect(Object.keys(backup.recovery.device)).toEqual([
        'workout-intent:' + 'a'.repeat(32),
        'workout-intent:' + 'b'.repeat(32),
    ]);
});

it('retains a crash-only private workout witness in an explicit partial backup without replaying it on import', async () => {
    const source = '{"__logbookWorkoutIntent":1,"sequence":1}';
    const key = 'workout-intent:' + 'f'.repeat(32);
    const values = new Map<string, string>([
        ['logbook:v2:user:a:' + key, source],
        ['logbook:v2:user:b:workout', '{"id":"foreign"}'],
        ['logbook:v2:user:a:account-deletion', '{"secret":"do-not-export"}'],
    ]);
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (name: string) => values.get(name) ?? null,
    });
    expect(hasDeviceRecoveryBackupSource('user:a')).toBe(true);

    const backup = await collectBackupSnapshot(parse({}), false);
    expect(backup.coverage.scope).toBe('device');
    expect(backup.recovery.envelope).toBeUndefined();
    expect(backup.recovery.device).toEqual({ [key]: source });
    expect(values.get('logbook:v2:user:a:' + key)).toBe(source);
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
    await initializeLocal('user:a', data);
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
    await initializeLocal('user:a', data);
    sdk.page.mockRejectedValue(new Error('offline'));
    await expect(collectBackupSnapshot(data, true)).rejects.toThrow('offline');
    expect((await collectBackupSnapshot(data, false)).coverage.scope).toBe('device');
});

it('aborts if the account changes between pages', async () => {
    sdk.page.mockImplementation(async () => { sdk.auth.currentUser = { uid: 'b' }; invalidateSession(); return { size: 0, docs: [] }; });
    await expect(collectBackupSnapshot(parse({}), true)).rejects.toThrow('Sessione cambiata');
});
