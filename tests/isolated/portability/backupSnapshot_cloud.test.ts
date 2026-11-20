import { describe, expect, it, vi } from 'vitest';
import { backupSnapshotMocks, parse, emptySync, testKey, currentCloudDoc, initializeSealedLocal } from './backupSnapshotFixture';
import { collectBackupSnapshot } from '../../../src/lib/db/backupSnapshot';
import { acknowledgeThrough, adoptReplicaCheckpoint, commitLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { sealCloudDocument, CloudCiphertextError } from '../../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

const { sdk, issuedCloudKeys } = backupSnapshotMocks;

describe('Backup: authenticated cloud snapshot and concurrent writes', () => {
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
            const now = Date.now();
            await adoptReplicaCheckpoint('user:a', {
                identity: { slot: 's00', replicaId: 'backup-ack', generation: 1,
                    checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 },
                baseSeq: 0,
            }, { clock: {}, syncMetaByDocument: {} });
            const delivered = (await readLocal('user:a'))!;
            expect(delivered.pending.length).toBeGreaterThan(0);
            const replica = delivered.replica;
            if (!replica) throw new Error('Prova replica mancante nel test backup');
            sdk.root.mockResolvedValue({ exists: () => true, data: () => currentCloudDoc(
                { profile: { height: '175', gender: 'M' } },
                { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s00: delivered.actorSeq }, fields: {},
                    writer: { slot: 's00', replicaId: replica.replicaId, generation: 1, seq: delivered.actorSeq } },
            ) });
            await acknowledgeThrough('user:a', delivered.pending.at(-1)!.seq, updated, [], undefined, {
                operations: structuredClone(delivered.pending), replica,
            });
            expect((await readLocal('user:a'))?.pending).toHaveLength(0);
        }
        return { size: 0, docs: [] };
    });

    const backup = await collectBackupSnapshot(base, true);
    expect(backup.data.profile?.height).toBe('175');
    expect(sdk.root).toHaveBeenCalledTimes(2);
    expect(issuedCloudKeys).toHaveLength(2);
    expect(issuedCloudKeys.every(key => key.every(byte => byte === 0))).toBe(true);
});

it('starts both backup collections before either completes and preserves the final control read', async () => {
    const data = parse({});
    await initializeSealedLocal(data);
    let releasePages!: () => void;
    const pagesReleased = new Promise<void>(resolve => { releasePages = resolve; });
    const started = new Set<string>();
    sdk.page.mockImplementation(async ({ path }: { path: string }) => {
        started.add(path.split('/').at(-1)!);
        await pagesReleased;
        return { size: 0, docs: [] };
    });

    const pending = collectBackupSnapshot(data, true);
    try {
        await vi.waitFor(() => expect([...started].sort()).toEqual(['history_months', 'nutrition_months']));
    } finally {
        releasePages();
    }
    const result = await pending;
    expect(result.coverage.scope).toBe('cloud-and-device');
    expect(sdk.control).toHaveBeenCalledTimes(2);
    expect(issuedCloudKeys).toHaveLength(1);
    expect(issuedCloudKeys[0]).toEqual(new Uint8Array(32));
});

it('keeps the account key alive until both backup reads settle after one fails', async () => {
    const data = parse({});
    await initializeSealedLocal(data);
    let releaseNutrition!: () => void;
    const nutritionReleased = new Promise<void>(resolve => { releaseNutrition = resolve; });
    let nutritionStarted = false;
    sdk.page.mockImplementation(async ({ path }: { path: string }) => {
        if (path.endsWith('/history_months')) throw new Error('history offline');
        nutritionStarted = true;
        await nutritionReleased;
        return { size: 0, docs: [] };
    });

    const pending = collectBackupSnapshot(data, true);
    try {
        await vi.waitFor(() => expect(nutritionStarted).toBe(true));
        expect(issuedCloudKeys).toHaveLength(1);
        expect(issuedCloudKeys[0]).toEqual(new Uint8Array(32).fill(18));
    } finally {
        releaseNutrition();
    }
    await expect(pending).rejects.toThrow('history offline');
    expect(issuedCloudKeys[0]).toEqual(new Uint8Array(32));
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
});
