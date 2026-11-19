import 'fake-indexeddb/auto';
import { get } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData } from '../../../src/types';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { adoptReplicaCheckpoint, hydrateLocal, commitLocal, initializeLocal, readLocal, acknowledgeThrough } from '../../../src/lib/sync/localRepository';
import { CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { installLocalRepositoryFixture, data, prepareOwnerVault } from './localRepositoryFixture';

describe('durable owner-scoped journal', () => {
    installLocalRepositoryFixture();

    it('does not resurrect a remote deletion in a complete window and preserves unloaded history', async () => {
        await prepareOwnerVault('user:a');
        const base = UserDataSchema.parse({ nutrition: {
            '2026-09-01': { date: '2026-09-01', weight: 80 },
            '2025-01-01': { date: '2025-01-01', weight: 70 }
        } }) as unknown as UserData;
        await initializeLocal('a', base);

        const cloudWindow = { ...data(170) } as unknown as UserData;
        const hydrated = await hydrateLocal('a', cloudWindow, ['2026-09']);

        expect(hydrated.data.nutrition?.['2026-09-01']).toBeUndefined();
        expect(hydrated.data.nutrition?.['2025-01-01']?.weight).toBe(70);
        expect(hydrated.completeMonths).toEqual(['2026-09']);
    });

    it('rejects malformed cloud containers without changing business data or the pending journal', async () => {
        await prepareOwnerVault('user:a');
        const base = data(170);
        await initializeLocal('a', base);
        await commitLocal('a', data(171), base);
        const before = await get('logbook:v2:user:a');
        expect((await readLocal('a'))?.pending.length).toBeGreaterThan(0);

        for (const malformed of [null, false, []]) {
            await expect(hydrateLocal('a', malformed as unknown as UserData, [], undefined, 'all'))
                .rejects.toThrow('Snapshot cloud non valido');
            expect(await get('logbook:v2:user:a')).toEqual(before);
        }
    });

    it('does not create an account archive from a malformed cloud response', async () => {
        await prepareOwnerVault('user:missing');
        for (const malformed of [null, false, []]) {
            await expect(hydrateLocal('missing', malformed as unknown as UserData, [], undefined, 'all'))
                .rejects.toThrow('Snapshot cloud non valido');
            expect(await get('logbook:v2:user:missing')).toBeUndefined();
        }
    });

    it('never certifies empty window months as cloud documents', async () => {
        await prepareOwnerVault('user:a');
        const root = data(171);
        const remote = new Map<string, any>([['', {
            profile: root.profile,
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        }]]);
        await initializeLocal('a', root);
        await hydrateLocal('a', root, ['2026-10', '2026-09', '2026-08'], remote, 'window');
        const afterWindow = await readLocal('a');
        expect(Object.keys(afterWindow!.syncMetaByDocument)).toEqual(['']);

        // Reopening on a full checkpoint is not evidence that an empty month
        // mysteriously disappeared from Firestore.
        await hydrateLocal('a', root, [], remote, 'all');
        const afterFull = await readLocal('a');
        expect(afterFull?.cloudIntegrityFence).toBeUndefined();
        expect(afterFull?.data.profile).toEqual(root.profile);
        expect(afterFull?.pending).toEqual([]);
    });

    it('does not promote pending-only metadata to acknowledged remote evidence', async () => {
        await prepareOwnerVault('user:a');
        const base = data(170);
        const desired = UserDataSchema.parse({
            ...base,
            nutrition: { '2026-10-01': { date: '2026-10-01', weight: 80 } },
        }) as unknown as UserData;
        await initializeLocal('a', base);
        await commitLocal('a', desired, base);
        const pendingBefore = (await readLocal('a'))!.pending;
        expect(pendingBefore.some(op => op.docPath === 'nutrition_months/2026-10')).toBe(true);
        await hydrateLocal('a', base, [], new Map([['', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        }]]));
        const after = (await readLocal('a'))!;
        expect(after.pending).toEqual(pendingBefore);
        expect(after.data.nutrition?.['2026-10-01']?.weight).toBe(80);
        expect(after.syncMetaByDocument['nutrition_months/2026-10']).toBeUndefined();
    });

    it('fences a missing server-confirmed document even with empty writerless metadata', async () => {
        await prepareOwnerVault('user:a');
        const root = data(170);
        await initializeLocal('a', root);
        // This record is obtained from a real-format server snapshot, not
        // synthesized locally or imported from a prelaunch envelope.
        const confirmedMonth = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} };
        const rootDoc = { _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} } };
        await hydrateLocal('a', root, ['2026-08'], new Map<string, any>([
            ['', rootDoc],
            ['nutrition_months/2026-08', { _sync: confirmedMonth }],
        ]), 'window');
        const before = (await readLocal('a'))!;
        expect(before.syncMetaByDocument['nutrition_months/2026-08']).toEqual(confirmedMonth);
        // The following full server scan is missing that earlier acknowledged
        // document. Its empty causal fields do not waive the integrity guard.
        const remote = new Map<string, any>([['', rootDoc]]);
        await expect(hydrateLocal('a', root, [], remote, 'all'))
            .rejects.toMatchObject({ code: 'replica-fenced', causeKind: 'missing-document',
                documentPaths: ['nutrition_months/2026-08'] });
        const after = (await readLocal('a'))!;
        expect(after.cloudIntegrityFence).toEqual(expect.any(String));
        expect(after.syncMetaByDocument['nutrition_months/2026-08']).toEqual(confirmedMonth);
        expect(after.data).toEqual(before.data);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.pending).toEqual(before.pending);
    });

    it('keeps the integrity fence when local business data exists on a missing month', async () => {
        await prepareOwnerVault('user:a');
        const business = UserDataSchema.parse({
            nutrition: { '2026-08-01': { date: '2026-08-01', weight: 75 } },
        }) as unknown as UserData;
        await initializeLocal('a', business);
        await updateArchiveRecord<any>('user:a', raw => ({
            ...raw,
            syncMetaByDocument: {
                'nutrition_months/2026-08': { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
            },
        }));
        expect(await get('logbook:v2:user:a')).toMatch(/^tlb-sealed:v1:/);
        const remote = new Map<string, any>([['', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        }]]);
        await expect(hydrateLocal('a', data(170), [], remote, 'all'))
            .rejects.toMatchObject({ code: 'replica-fenced', causeKind: 'missing-document',
                documentPaths: ['nutrition_months/2026-08'] });
        const stillLocal = (await readLocal('a'))!;
        expect(stillLocal.data.nutrition?.['2026-08-01']?.weight).toBe(75);
        expect(stillLocal.cloudIntegrityFence).toEqual(expect.any(String));
    });

    it('fences a full checkpoint missing a previously acknowledged monthly shard', async () => {
        await prepareOwnerVault('user:a');
        const local = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 70 },
            '2026-09-01': { date: '2026-09-01', weight: 80 },
        } }) as unknown as UserData;
        await initializeLocal('a', local, ['2025-01', '2026-09']);
        const knownMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 1 }, fields: {} };
        await hydrateLocal('a', local, ['2025-01'], new Map<string, any>([
            ['', { _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} } }],
            ['nutrition_months/2025-01', {
                _sync: knownMeta, '2025-01-01': local.nutrition?.['2025-01-01'],
            }],
        ]));
        const before = await readLocal('a');

        // A paginated full scan started before another tab's acknowledgement:
        // its month list omits the old, already-acknowledged document.
        const cloud = UserDataSchema.parse({ nutrition: {
            '2026-09-01': { date: '2026-09-01', weight: 81 },
        } }) as unknown as UserData;
        const docs = new Map<string, any>([['', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        }], ['nutrition_months/2026-09', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        }]]);
        await expect(hydrateLocal('a', cloud, ['2026-09'], docs, 'all'))
            .rejects.toMatchObject({ code: 'replica-fenced', causeKind: 'missing-document',
                documentPaths: ['nutrition_months/2025-01'] });
        const fenced = await readLocal('a');
            expect(fenced?.data).toEqual(before?.data);
            expect(fenced?.baseline).toEqual(before?.baseline);
            expect(fenced?.pending).toEqual(before?.pending);
            expect(fenced?.cloudIntegrityFence).toEqual(expect.any(String));
        expect((await readLocal('a'))?.data.nutrition?.['2025-01-01']?.weight).toBe(70);
    });

    it('fences a covered window whose previously acknowledged root loses sync evidence', async () => {
        await prepareOwnerVault('user:a');
        const local = data(171);
        await initializeLocal('a', local);
        const knownMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 1 }, fields: {} };
        await hydrateLocal('a', local, [], new Map([['', { _sync: knownMeta }]]));
        const before = await readLocal('a');
        const cloud = data(160);

        // A missing root and a root without _sync are both insufficient proof
        // to remove data whose metadata is already durable in another tab.
        for (const docs of [
            new Map<string, any>(),
            new Map<string, any>([['', { profile: cloud.profile }]]),
        ]) {
            await expect(hydrateLocal('a', cloud, [], docs, 'window'))
                .rejects.toMatchObject({ code: 'replica-fenced' });
            const fenced = await readLocal('a');
            expect(fenced?.data).toEqual(before?.data);
            expect(fenced?.baseline).toEqual(before?.baseline);
            expect(fenced?.pending).toEqual(before?.pending);
            expect(fenced?.cloudIntegrityFence).toEqual(expect.any(String));
        }
    });

    it('still accepts a normal window omitting older, non-authoritative synced shards', async () => {
        await prepareOwnerVault('user:a');
        const local = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 70 },
            '2026-09-01': { date: '2026-09-01', weight: 80 },
        } }) as unknown as UserData;
        await initializeLocal('a', local, ['2025-01', '2026-09']);
        const knownMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 1 }, fields: {} };
        await hydrateLocal('a', local, ['2025-01'], new Map<string, any>([
            ['', { _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} } }],
            ['nutrition_months/2025-01', {
                _sync: knownMeta, '2025-01-01': local.nutrition?.['2025-01-01'],
            }],
        ]));
        const cloud = UserDataSchema.parse({ nutrition: {
            '2026-09-01': { date: '2026-09-01', weight: 81 },
        } }) as unknown as UserData;
        const docs = new Map<string, any>([['', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        }], ['nutrition_months/2026-09', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        }]]);
        const hydrated = await hydrateLocal('a', cloud, ['2026-09'], docs, 'window');
        expect(hydrated.data.nutrition?.['2025-01-01']?.weight).toBe(70);
        expect(hydrated.data.nutrition?.['2026-09-01']?.weight).toBe(81);
        expect(hydrated.syncMetaByDocument['nutrition_months/2025-01']).toEqual(knownMeta);
    });

    it('treats exhaustive hydration as authoritative for every monthly shard', async () => {
        await prepareOwnerVault('user:a');
        const base = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 70 },
            '2026-09-01': { date: '2026-09-01', weight: 80 }
        } }) as unknown as UserData;
        await initializeLocal('a', base, ['2025-01', '2026-09']);

        const cloud = UserDataSchema.parse({ nutrition: {
            '2026-09-01': { date: '2026-09-01', weight: 81 }
        } }) as unknown as UserData;
        const hydrated = await hydrateLocal('a', cloud, ['2026-09'], undefined, 'all');

        expect(hydrated.data.nutrition?.['2025-01-01']).toBeUndefined();
        expect(hydrated.data.nutrition?.['2026-09-01']?.weight).toBe(81);
        expect(hydrated.completeMonths).toEqual(['2026-09']);
    });


    it('does not let an older hydration snapshot replace a causally newer durable state', async () => {
        await prepareOwnerVault('user:a');
        const base = data(170);
        await initializeLocal('a', base);
        const now = Date.now();
        const identity = { slot: 's00', replicaId: 'hydration-frontier-ack', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        const newer = data(172);
        await commitLocal('a', newer, base);
        const sent = (await readLocal('a'))!;
        const actor = sent.actorId;
        const meta2 = {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { [actor]: 1 },
            fields: { 'profile/height': { actorId: actor, seq: 1, clock: { [actor]: 1 } } },
        };
        await acknowledgeThrough('a', 1, newer, [], { '': meta2 }, {
            operations: structuredClone(sent.pending), replica: identity,
        });

        const stale = data(170);
        const staleDocuments = new Map<string, any>([
            ['', { profile: stale.profile, _sync: {
                protocolVersion: CURRENT_SYNC_PROTOCOL,
                clock: {},
                fields: {},
            } }],
        ]);
        const before = await readLocal('a');
        await expect(hydrateLocal('a', stale, [], staleDocuments, 'window'))
            .rejects.toMatchObject({ code: 'replica-fenced' });
        const fenced = await readLocal('a');
            expect(fenced?.data).toEqual(before?.data);
            expect(fenced?.baseline).toEqual(before?.baseline);
            expect(fenced?.pending).toEqual(before?.pending);
            expect(fenced?.cloudIntegrityFence).toEqual(expect.any(String));
        expect((await readLocal('a'))?.data.profile?.height).toBe('172');
    });

    it('rejects a full checkpoint with present but causally older or incomparable monthly metadata', async () => {
        await prepareOwnerVault('user:a');
        const local = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 70 },
        } }) as unknown as UserData;
        await initializeLocal('a', local, ['2025-01']);
        const durableMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 3 }, fields: {} };
        await hydrateLocal('a', local, ['2025-01'], new Map<string, any>([
            ['', { _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} } }],
            ['nutrition_months/2025-01', {
                _sync: durableMeta, '2025-01-01': local.nutrition?.['2025-01-01'],
            }],
        ]));
        const before = await readLocal('a');
        const cloud = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 60 },
        } }) as unknown as UserData;

        for (const remoteClock of [{ s01: 2 }, { s02: 4 }]) {
            const docs = new Map<string, any>([['', {
                _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
            }], ['nutrition_months/2025-01', {
                _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: remoteClock, fields: {} },
            }]]);
            await expect(hydrateLocal('a', cloud, ['2025-01'], docs, 'all'))
                .rejects.toMatchObject({ code: 'replica-fenced', causeKind: 'stale-document',
                    documentPaths: ['nutrition_months/2025-01'] });
            const fenced = await readLocal('a');
            expect(fenced?.data).toEqual(before?.data);
            expect(fenced?.baseline).toEqual(before?.baseline);
            expect(fenced?.pending).toEqual(before?.pending);
            expect(fenced?.cloudIntegrityFence).toEqual(expect.any(String));
        }
    });

    it('accepts a covered cloud frontier for a previously acknowledged document', async () => {
        await prepareOwnerVault('user:a');
        const local = data(170);
        await initializeLocal('a', local);
        await hydrateLocal('a', local, [], new Map([['', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 3 }, fields: {} },
        }]]));
        const fresh = data(175);
        const documents = new Map<string, any>([['', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 3, s02: 4 }, fields: {} },
        }]]);
        const result = await hydrateLocal('a', fresh, [], documents, 'window');

        expect(result.data.profile?.height).toBe('175');
        expect(result.syncMetaByDocument[''].clock).toEqual({ s01: 3, s02: 4 });
    });

});
