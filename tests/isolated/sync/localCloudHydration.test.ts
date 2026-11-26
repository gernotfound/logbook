import { get } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { hydrateLocal, IncompleteCloudSnapshotError, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../../src/lib/sync/session';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { stageCloudflareReplicaRetirement } from '../../../src/lib/sync/cloudReplicaRetirementRecovery';
import { stageCloudflareDelivery } from '../../../src/lib/sync/cloudReplicaDurableDelivery';
import type { CachedGlobalCatalog } from '../../../src/types';
import {
    owner, key, accountKey, catalog, state, workout, serverSnapshot, snapshot, registerAndEdit,
    expectFencedArchive, installLocalCloudHydrationFixture,
} from './localCloudHydrationFixture';

installLocalCloudHydrationFixture(() => { catalogSource.read.mockReset().mockResolvedValue(catalog); });

describe('diagnostic cloud hydration through the encrypted local archive', () => {
    it('installs a verified full checkpoint into a previously empty account vault', async () => {
        const remote = serverSnapshot(state('170'));

        const result = await hydrateLocal(owner, remote.data, [], remote.documents, 'all',
            () => true, { consentRevision: 1, localRevision: null });

        expect(result).toMatchObject({ owner, revision: 0, consentRevision: 1,
            pending: [], syncMetaByDocument: remote.metadata });
        expect(await snapshot()).toEqual(result);
        expect(await get(key)).toMatch(/^tlb-sealed:v1:/);
    });

    it('never writes a checkpoint without full cloud evidence, a live guard and a valid consent epoch', async () => {
        const remote = serverSnapshot(state('170'));
        const expected = { consentRevision: 1, localRevision: null };
        const before = await get(key);
        const attempts = [
            () => hydrateLocal(owner, remote.data, [], remote.documents, 'window', () => true, expected),
            () => hydrateLocal(owner, remote.data, [], undefined, 'all', () => true, expected),
            () => hydrateLocal(owner, remote.data, [], remote.documents, 'all', undefined, expected),
            () => hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => true,
                { consentRevision: 0, localRevision: null }),
            () => hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => true,
                { consentRevision: 1.5, localRevision: null }),
            () => hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => true,
                { consentRevision: 1, localRevision: 0 }),
        ];

        for (const attempt of attempts) {
            await expect(attempt()).rejects.toThrow('Checkpoint locale modificato');
            expect(await get(key)).toBe(before);
            expect(await readLocal(owner)).toBeUndefined();
        }

        const guestSessionId = 'hydration-checkpoint-guest-session';
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, guestSessionId);
        activateGuestSession(guestSessionId);
        await createAndMigrateVault('guest');
        const guestKey = 'logbook:v2:guest';
        const originalGuest = await get(guestKey);
        await expect(hydrateLocal('guest', remote.data, [], remote.documents, 'all',
            () => true, expected)).rejects.toThrow('Checkpoint locale modificato');
        expect(await get(guestKey)).toBe(originalGuest);
        expect(await readLocal('guest')).toBeUndefined();
    });

    it('refuses a stale revision or changed consent when checkpointing an existing vault', async () => {
        const remote = serverSnapshot(state('170'));
        const initial = await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        const before = await get(key);

        await expect(hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => true,
            { consentRevision: 1, localRevision: null })).rejects.toThrow('Checkpoint locale modificato');
        await expect(hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => true,
            { consentRevision: 2, localRevision: initial.revision })).rejects.toThrow('Checkpoint locale modificato');
        expect(await get(key)).toBe(before);
        expect(await snapshot()).toEqual(initial);

        const unchanged = await hydrateLocal(owner, remote.data, [], remote.documents, 'all',
            () => true, { consentRevision: 1, localRevision: initial.revision });
        expect(unchanged).toEqual(initial);
        expect(await get(key)).toBe(before);
    });

    it('cannot replace an integrity-fenced archive even with matching revision and a fresh scan', async () => {
        const original = serverSnapshot(state('170', {}, [workout('covered', '2026-09-01')]));
        await hydrateLocal(owner, original.data, ['2026-09'], original.documents, 'all');
        const pending = await registerAndEdit();
        const incomplete = serverSnapshot(state('170'));
        await expect(hydrateLocal(owner, incomplete.data, ['2026-09'], incomplete.documents, 'all'))
            .rejects.toBeInstanceOf(IncompleteCloudSnapshotError);
        const fenced = await snapshot();
        expectFencedArchive(fenced, pending);
        expect(fenced.consentRevision).toBe(1);
        const ciphertext = await get(key);

        await expect(hydrateLocal(owner, original.data, ['2026-09'], original.documents, 'all',
            () => true, { consentRevision: 1, localRevision: fenced.revision }))
            .rejects.toThrow('Checkpoint locale modificato');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(fenced);
    });

    it('does not replace an outstanding authenticated D1 replica claim with a hydration checkpoint', async () => {
        const remote = serverSnapshot(state('170'));
        const original = await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        const verified = await readAuthenticatedCloudflareCheckpoint(
            async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] }),
            'a', accountKey, 1, () => true,
        );
        await stageCloudflareReplicaClaim(owner, verified,
            { revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            'hydration-candidate-device', () => true, original.revision);
        const staged = await snapshot();
        expect(staged.cloudflareReplicaClaim).toBeDefined();
        const ciphertext = await get(key);

        await expect(hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => true,
            { consentRevision: 1, localRevision: staged.revision }))
            .rejects.toThrow('Checkpoint locale modificato');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(staged);
    });

    it('preserves an outstanding D1 retirement request across a competing hydration', async () => {
        const remote = serverSnapshot(state('170'));
        await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        const now = Date.now();
        const target = { slot: 's02', replicaId: 'expired-hydration-device', generation: 1,
            checkpointAtMs: now - 86400000, leaseUntilMs: now - 600000 };
        await stageCloudflareReplicaRetirement(owner, {
            uid: 'a', revision: 0, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active', lastSeq: 8, checkpointClock: { s01: 4 } } },
        }, target, () => true);
        const pending = await snapshot();
        expect(pending.cloudflareReplicaRetirement).toBeDefined();
        const ciphertext = await get(key);

        await expect(hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => true,
            { consentRevision: 1, localRevision: pending.revision }))
            .rejects.toThrow('Checkpoint locale modificato');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(pending);
    });

    it('keeps the journal and sealed D1 delivery attempt intact when hydration competes', async () => {
        const remote = serverSnapshot(state('170'));
        await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        const edited = await registerAndEdit();
        if (!edited.replica) throw new Error('Expected registered replica');
        await stageCloudflareDelivery(owner, edited.pending,
            { revision: 0, fenceEpoch: 5, consentRevision: 1,
                documents: [{ path: '', revision: null, document: null }] },
            { uid: 'a', revision: 0, fenceEpoch: 5, consentRevision: 1,
                replicas: { [edited.replica.slot]: { ...edited.replica,
                    status: 'active', lastSeq: 0, checkpointClock: {} } } },
            edited.replica, 'batch000000000191', accountKey, () => true);
        const pending = await snapshot();
        expect(pending.cloudflareDelivery).toBeDefined();
        const ciphertext = await get(key);

        await expect(hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => true,
            { consentRevision: 1, localRevision: pending.revision }))
            .rejects.toThrow('Checkpoint locale modificato');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(pending);
    });

    it('creates the first envelope with current versions, consent and the joined server frontier', async () => {
        const remote = serverSnapshot(state('170',
            { '2026-09-01': { date: '2026-09-01', weight: 80 } },
            [workout('january', '2026-01-01')]), {
            '': { s01: 7 },
            'history_months/2026-01': { s01: 3, s02: 4 },
            'nutrition_months/2026-09': { s01: 5 },
        });
        const inputImage = structuredClone(remote);

        const result = await hydrateLocal(owner, remote.data, ['2026-01', '2026-09'], remote.documents, 'all');
        expect(result).toMatchObject({
            version: CURRENT_LOCAL_ENVELOPE, dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL, owner, actorSeq: 0, consentRevision: 1,
            clock: { s01: 7, s02: 4 }, replica: null, revision: 0, pending: [],
            completeMonths: ['2026-01', '2026-09'],
        });
        expect(result.actorId).toEqual(expect.any(String));
        expect(result.actorId.length).toBeGreaterThan(0);
        expect(result.data).toEqual(remote.data);
        expect(result.baseline).toEqual(remote.data);
        expect(result.syncMetaByDocument).toEqual(remote.metadata);
        expect(await snapshot()).toEqual(result);
        expect(await get(key)).toMatch(/^tlb-sealed:v1:/);
        expect(remote).toEqual(inputImage);
    });

    it('keeps exact ciphertext and revision when the confirmed snapshot is unchanged', async () => {
        const remote = serverSnapshot(state('170'));
        await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        const before = await snapshot();
        const ciphertext = await get(key);

        const returned = await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        expect(returned).toEqual(before);
        expect(await snapshot()).toEqual(before);
        expect(await get(key)).toBe(ciphertext);
    });

    it('uses default window coverage for both monthly collections and retains older confirmed metadata', async () => {
        const old = state('170', {
            '2026-01-01': { date: '2026-01-01', weight: 70 },
            '2026-09-01': { date: '2026-09-01', weight: 80 },
        }, [workout('old-january', '2026-01-01'), workout('removed-september', '2026-09-01')]);
        const initial = serverSnapshot(old, { '': { s01: 7 } });
        await hydrateLocal(owner, initial.data, ['2026-01', '2026-09'], initial.documents, 'all');
        const before = await snapshot();
        const remote = serverSnapshot(state('175'), {
            '': { s01: 9 }, 'history_months/2026-09': { s01: 4 },
            'nutrition_months/2026-09': { s01: 4 },
        }, ['history_months/2026-09', 'nutrition_months/2026-09']);

        const result = await hydrateLocal(owner, remote.data, ['2026-11', '2026-10', '2026-09'], remote.documents);
        expect(result.data.history?.map(item => item.id)).toEqual(['old-january']);
        expect(result.baseline.history?.map(item => item.id)).toEqual(['old-january']);
        expect(result.data.nutrition?.['2026-01-01']?.weight).toBe(70);
        expect(result.data.nutrition?.['2026-09-01']).toBeUndefined();
        expect(result.baseline.nutrition?.['2026-09-01']).toBeUndefined();
        expect(result.data.profile?.height).toBe('175');
        expect(result.clock).toEqual({ s01: 9 });
        expect(result.completeMonths).toEqual(['2026-01', '2026-09', '2026-11', '2026-10']);
        expect(result.syncMetaByDocument['history_months/2026-01'])
            .toEqual(before.syncMetaByDocument['history_months/2026-01']);
        expect(result.syncMetaByDocument['nutrition_months/2026-01'])
            .toEqual(before.syncMetaByDocument['nutrition_months/2026-01']);
        expect(await snapshot()).toEqual(result);
    });

    it('replaces full history coverage, installs a new month and keeps the fresh root', async () => {
        const initial = serverSnapshot(state('170',
            { '2026-01-01': { date: '2026-01-01', weight: 70 } },
            [workout('removed-january', '2026-01-01')]));
        await hydrateLocal(owner, initial.data, ['2026-01'], initial.documents, 'all');
        const window = serverSnapshot(state('170'));
        await hydrateLocal(owner, window.data, ['2026-11', '2026-10', '2026-09'], window.documents, 'window');
        const remote = serverSnapshot(state('175', {}, [workout('new-october', '2026-10-01')]), {
            '': { s01: 3 }, 'history_months/2026-01': { s01: 2 },
            'nutrition_months/2026-01': { s01: 2 }, 'history_months/2026-10': { s01: 4 },
        }, ['history_months/2026-01', 'nutrition_months/2026-01']);

        const result = await hydrateLocal(owner, remote.data, ['2026-01', '2026-10'], remote.documents, 'all');
        expect(result.data.history?.map(item => item.id)).toEqual(['new-october']);
        expect(result.baseline.history?.map(item => item.id)).toEqual(['new-october']);
        expect(result.data.nutrition).toEqual({});
        expect(result.baseline.nutrition).toEqual({});
        expect(result.data.profile?.height).toBe('175');
        expect(result.baseline.profile?.height).toBe('175');
        expect(result.completeMonths).toEqual(['2026-01', '2026-10']);
        expect(result.syncMetaByDocument).toEqual(remote.metadata);
        expect(await snapshot()).toEqual(result);
    });

    it('replays pending intent without promoting its causal dot to confirmed cloud metadata', async () => {
        const initial = serverSnapshot(state('170'));
        await hydrateLocal(owner, initial.data, [], initial.documents, 'all');
        const before = await registerAndEdit();
        const remote = serverSnapshot(state('170',
            { '2026-09-01': { date: '2026-09-01', weight: 80 } }), {
            '': { s01: 1 }, 'nutrition_months/2026-09': { s02: 4 },
        });

        const result = await hydrateLocal(owner, remote.data, ['2026-11', '2026-10', '2026-09'], remote.documents, 'window');
        expect(result.pending).toEqual(before.pending);
        expect(result.data.pendingConflicts).toEqual(before.data.pendingConflicts);
        expect(result.data.pendingConflicts?.nutritionPlanning?.weight).toBe(78);
        expect(result.actorId).toBe(before.actorId);
        expect(result.actorSeq).toBe(before.actorSeq);
        expect(result.clock).toEqual({ s01: 1, s00: 1, s02: 4 });
        expect(result.data.profile?.height).toBe('181');
        expect(result.baseline.profile?.height).toBe('170');
        expect(result.data.nutrition?.['2026-09-01']?.weight).toBe(80);
        expect(result.syncMetaByDocument).toEqual(remote.metadata);
        expect(result.syncMetaByDocument[''].clock).not.toHaveProperty('s00');
        expect(result.revision).toBe(before.revision + 1);
        expect(await snapshot()).toEqual(result);
    });

    it.each(['history_months/2026-09', 'nutrition_months/2026-09'])(
        'fences a missing covered %s while retaining the entire pending archive', async path => {
            const business = path.startsWith('history_months/')
                ? state('170', {}, [workout('covered', '2026-09-01')])
                : state('170', { '2026-09-01': { date: '2026-09-01', weight: 80 } });
            const initial = serverSnapshot(business);
            await hydrateLocal(owner, initial.data, ['2026-09'], initial.documents, 'all');
            const before = await registerAndEdit();
            const remote = serverSnapshot(state('170'));
            const pending = hydrateLocal(owner, remote.data, ['2026-11', '2026-10', '2026-09'], remote.documents, 'window');

            await expect(pending).rejects.toBeInstanceOf(IncompleteCloudSnapshotError);
            await expect(pending).rejects.toMatchObject({
                causeKind: 'missing-document', documentPaths: [path],
                evidence: 'cloud-snapshot-integrity', name: 'IncompleteCloudSnapshotError',
                message: expect.stringContaining('Snapshot cloud incompleto'),
            });
            expectFencedArchive(await snapshot(), before);
        },
    );

    it.each([
        ['history_months/2026-09', 'all'], ['history_months/2026-09', 'window'],
        ['nutrition_months/2026-09', 'all'], ['nutrition_months/2026-09', 'window'],
    ] as const)(
        'rejects delayed causal evidence for %s with %s coverage before a checkpoint', async (path, coverage) => {
            const business = path.startsWith('history_months/')
                ? state('170', {}, [workout('covered', '2026-09-01')])
                : state('170', { '2026-09-01': { date: '2026-09-01', weight: 80 } });
            const initial = serverSnapshot(business, { '': { s01: 7 }, [path]: { s01: 14 } });
            await hydrateLocal(owner, initial.data, ['2026-09'], initial.documents, 'all');
            const before = await registerAndEdit();
            const delayed = serverSnapshot(business, { '': { s01: 7 }, [path]: { s01: 13 } });
            const pending = hydrateLocal(owner, delayed.data, ['2026-09'], delayed.documents, coverage);

            await expect(pending).rejects.toBeInstanceOf(IncompleteCloudSnapshotError);
            await expect(pending).rejects.toMatchObject({
                causeKind: 'stale-document', documentPaths: [path],
                evidence: 'cloud-snapshot-integrity', name: 'IncompleteCloudSnapshotError',
                message: expect.stringContaining('Snapshot cloud non aggiornato'),
            });
            expectFencedArchive(await snapshot(), before);
        },
    );

    it.each([{ existing: false, path: '' }, { existing: true, path: 'nutrition_months/2026-09' }])(
        'preserves the local error contract for invalid metadata (existing=$existing, path=$path)', async scenario => {
            const remote = serverSnapshot(state('170'));
            if (scenario.existing) {
                await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
                await registerAndEdit();
            }
            const before = await readLocal(owner);
            const ciphertext = await get(key);
            // Deliberately malformed metadata tests this defensive boundary.
            // The ordinary cloud reader rejects such documents before hydration.
            const invalid = new Map(remote.documents);
            invalid.set(scenario.path, {
                _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL + 1, clock: {}, fields: {} },
            });
            const pending = hydrateLocal(owner, remote.data, ['2026-09'], invalid, 'all');
            await expect(pending).rejects.toMatchObject({
                code: 'invalid-cloud-sync-metadata', name: 'InvalidCloudSyncMetadataError',
                documentPath: scenario.path, originalError: expect.any(Error),
                message: expect.stringContaining(scenario.path || 'root'),
            });
            expect(await get(key)).toBe(ciphertext);
            expect(await readLocal(owner)).toEqual(before);
        },
    );

    it.each([false, true])('checks the guard after the catalog wait even for creation or a no-op (existing=%s)', async existing => {
        const remote = serverSnapshot(state('170'));
        if (existing) await hydrateLocal(owner, remote.data, [], remote.documents, 'all');
        const before = await readLocal(owner);
        const ciphertext = await get(key);
        let finishCatalog!: (value: CachedGlobalCatalog) => void;
        const catalogWait = new Promise<CachedGlobalCatalog>(resolve => { finishCatalog = resolve; });
        catalogSource.read.mockReturnValueOnce(catalogWait);
        let current = true;
        const pending = hydrateLocal(owner, remote.data, [], remote.documents, 'all', () => current);
        current = false;
        finishCatalog(catalog);

        await expect(pending).rejects.toThrow('Hydration locale invalidata dal cambio sessione');
        expect(await get(key)).toBe(ciphertext);
        expect(await readLocal(owner)).toEqual(before);
    });

    it('preserves ciphertext when the integrity fence cannot commit, then fences the retained journal on retry', async () => {
        const initial = serverSnapshot(state('170', {}, [workout('covered', '2026-09-01')]));
        await hydrateLocal(owner, initial.data, ['2026-09'], initial.documents, 'all');
        const before = await registerAndEdit();
        const ciphertext = await get(key);
        const incomplete = serverSnapshot(state('170'));
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });

        await expect(hydrateLocal(owner, incomplete.data, ['2026-09'], incomplete.documents, 'window'))
            .rejects.toThrow('Quota exceeded');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
        put.mockRestore();

        await expect(hydrateLocal(owner, incomplete.data, ['2026-09'], incomplete.documents, 'window'))
            .rejects.toMatchObject({ causeKind: 'missing-document', documentPaths: ['history_months/2026-09'] });
        expectFencedArchive(await snapshot(), before);
    });
});
