import { describe, expect, it } from 'vitest';
import { parse, initializeSealedLocal, copyDeviceStorage, stubConcurrentStorage } from './backupSnapshotFixture';
import { collectBackupSnapshot, hasDeviceRecoveryBackupSource } from '../../../src/lib/db/backupSnapshot';
import { createBackup, decodeImport } from '../../../src/lib/backup';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { SEALED_LOCAL_PREFIX } from '../../../src/lib/sync/secureArchiveCipher';
import { readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';

describe('Backup: encrypted witness inventory and concurrent local storage', () => {
it('exports only allowlisted recovery device data and excludes account-deletion receipts', async () => {
    const data = parse({ profile: { height: '171' } });
    await initializeSealedLocal(data);
    const deviceRecords = [
        ['workout', '{"id":"w1"}'],
        ['draft:measurement:2026-10-04', '{"weight":"80"}'],
        ['history-editor-context', '{"version":1,"editorId":"e1"}'],
        ['workout-intent:' + 'a'.repeat(32), '{"__logbookWorkoutIntent":1}'],
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
    const unrelated = 'logbook:v2:user:a:storage_marker';
    const name = 'workout-intent:' + 'f'.repeat(32);
    const witness = 'logbook:v2:user:a:sealed:' + name;
    const original = '{"__logbookWorkoutIntent":1,"sequence":1}';
    await createAndMigrateVault('user:a');
    writeDeviceValue(name, original, 'user:a');
    const values = new Map<string, string>([[unrelated, '{"version":1,"timestamp":1}'], ...copyDeviceStorage()]);
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
});
