import { describe, expect, it } from 'vitest';
import { backupSnapshotMocks, parse, initializeSealedLocal } from './backupSnapshotFixture';
import { collectBackupSnapshot } from '../../../src/lib/db/backupSnapshot';
import { hydrateLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { invalidateSession } from '../../../src/lib/sync/session';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

const { sdk } = backupSnapshotMocks;

describe('Backup: completeness and session fencing', () => {
it('refuses a full backup when a locally acknowledged month is absent on server', async () => {
    const data = parse({ nutrition: { '2025-01-01': { date: '2025-01-01', weight: 70 } } });
    await initializeSealedLocal(data);
    const knownMonth = 'nutrition_months/2025-01';
    const confirmedMeta: SyncMeta = {
        protocolVersion: CURRENT_SYNC_PROTOCOL,
        clock: { s00: 1 },
        fields: { '2025-01-01': { actorId: 's00', seq: 1, clock: { s00: 1 } } },
        writer: { slot: 's00', replicaId: 'backup-seed', generation: 1, seq: 1 },
    };
    await hydrateLocal('user:a', data, ['2025-01'], new Map([[knownMonth, {
        '2025-01-01': data.nutrition?.['2025-01-01'], _sync: confirmedMeta,
    }]]));
    expect((await readLocal('user:a'))?.syncMetaByDocument[knownMonth]).toEqual(confirmedMeta);
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

it('refuses to finish a cloud backup after an Auth replacement with the same UID and unchanged local epoch', async () => {
    const data = parse({ profile: { height: '170' } });
    await initializeSealedLocal(data);
    let replaced = false;
    sdk.page.mockImplementation(async ({ path }) => {
        if (!replaced && path.endsWith('history_months')) {
            replaced = true;
            // Firebase can publish the replacement User before the local Auth
            // observer advances the epoch; comparing only the UID is insufficient.
            sdk.auth.currentUser = { uid: 'a' };
        }
        return { size: 0, docs: [] };
    });

    await expect(collectBackupSnapshot(data, true)).rejects.toThrow('Account cambiato durante il backup.');
    expect(replaced).toBe(true);
    expect(sdk.page).toHaveBeenCalledTimes(1);
    expect(sdk.control).toHaveBeenCalledTimes(1);
});

it('aborts if the account changes between pages', async () => {
    await initializeSealedLocal(parse({}));
    sdk.page.mockImplementation(async () => { sdk.auth.currentUser = { uid: 'b' }; invalidateSession(); return { size: 0, docs: [] }; });
    await expect(collectBackupSnapshot(parse({}), true)).rejects.toThrow('Sessione cambiata');
});
});
