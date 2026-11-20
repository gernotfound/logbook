import { describe, expect, it } from 'vitest';
import { backupSnapshotMocks, parse, emptySync, currentCloudDoc, initializeSealedLocal } from './backupSnapshotFixture';
import { collectBackupSnapshot } from '../../../src/lib/db/backupSnapshot';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { CloudCiphertextError } from '../../../src/lib/sync/cloudDocumentCipher';

const { sdk } = backupSnapshotMocks;

describe('Backup: lossless cloud validation and schema version fences', () => {
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

it('accepts an explicitly absent nutrition plan without misclassifying a valid cloud root', async () => {
    const base = parse({});
    await initializeSealedLocal(base);
    sdk.root.mockResolvedValue({ exists: () => true, data: () => currentCloudDoc({
        profile: { height: '174' }, nutritionPlanning: null,
    }) });

    const backup = await collectBackupSnapshot(base, true);
    expect(backup.coverage.scope).toBe('cloud-and-device');
    expect(backup.data.profile?.height).toBe('174');
});

it('rejects a complete cloud backup if an authenticated root contains business fields lost by Zod', async () => {
    const base = parse({});
    await initializeSealedLocal(base);
    const remote = currentCloudDoc({ profile: { height: '174' }, unmodeledBusinessField: { value: 'must-preserve' } });
    sdk.root.mockResolvedValue({ exists: () => true, data: () => remote });

    await expect(collectBackupSnapshot(base, true)).rejects.toThrow('Dati cloud non validi');
    expect((await collectBackupSnapshot(base, false)).coverage.scope).toBe('device');
    expect(remote._sealed.ciphertext).toBeTruthy();
});

it('rejects a complete cloud backup if a nutrition scalar is silently normalized away', async () => {
    const base = parse({});
    await initializeSealedLocal(base);
    const month = currentCloudDoc({
        '2026-09-10': { date: '2026-09-10', weight: 'not-a-number' },
    }, emptySync, 'nutrition_months/2026-09');
    sdk.page.mockImplementation(async ({ path }) => path.endsWith('/nutrition_months')
        ? { size: 1, docs: [{ id: '2026-09', data: () => month }] }
        : { size: 0, docs: [] });

    await expect(collectBackupSnapshot(base, true)).rejects.toThrow('Dati cloud non validi');
    expect((await collectBackupSnapshot(base, false)).coverage.scope).toBe('device');
    expect(month._sealed.ciphertext).toBeTruthy();
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
});
