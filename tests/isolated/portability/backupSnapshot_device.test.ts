import { describe, expect, it } from 'vitest';
import { backupSnapshotMocks, sdk, issuedCloudKeys, parse, initializeSealedLocal } from './backupSnapshotFixture';
import { get } from 'idb-keyval';
import { collectBackupSnapshot } from '../../../src/lib/db/backupSnapshot';
import { createBackup, decodeImport } from '../../../src/lib/backup';
import { readLocal } from '../../../src/lib/sync/localRepository';
import { LocalVaultLockedError, lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { SEALED_LOCAL_PREFIX } from '../../../src/lib/sync/secureArchiveCipher';

const { sdk, issuedCloudKeys } = backupSnapshotMocks;

describe('Backup: key hygiene and device-only recovery', () => {
it('wipes only owned cloud backup ADKs on success, failure and retry', async () => {
    const base = parse({ profile: { height: '170', gender: 'M' } });
    await initializeSealedLocal(base);
    const complete = await collectBackupSnapshot(base, true);
    expect(complete.coverage.scope).toBe('cloud-and-device');
    expect(issuedCloudKeys).toHaveLength(1);
    expect(issuedCloudKeys[0]).toEqual(new Uint8Array(32));

    sdk.page.mockRejectedValueOnce(new Error('offline'));
    await expect(collectBackupSnapshot(base, true)).rejects.toThrow('offline');
    expect(issuedCloudKeys).toHaveLength(2);
    expect(issuedCloudKeys[1]).toEqual(new Uint8Array(32));

    const borrowed = new Uint8Array(32).fill(18);
    await collectBackupSnapshot(base, true, 0, borrowed);
    expect(borrowed).toEqual(new Uint8Array(32).fill(18));
    // Even with a caller-provided buffer the rights/sync gate acquires a fresh key.
    expect(issuedCloudKeys).toHaveLength(3);
    expect(issuedCloudKeys[2]).toEqual(new Uint8Array(32));
});


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
});
