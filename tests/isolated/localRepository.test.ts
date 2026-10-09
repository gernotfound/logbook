import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import { adoptReplicaCheckpoint, markReplicaCheckpointRequired, hydrateLocal, commitLocal, initializeLocal, readLocal, acknowledgeThrough, StaleLocalRevisionError } from '../../src/lib/sync/localRepository';
import {
    CURRENT_DATA_SCHEMA,
    CURRENT_LOCAL_ENVELOPE,
    CURRENT_SYNC_PROTOCOL,
    FutureVersionError,
    LegacyVersionError,
} from '../../src/lib/schemaEvolution';

const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;
beforeEach(() => clear());
afterEach(() => vi.restoreAllMocks());

describe('durable owner-scoped journal', () => {
    it('writes independent current envelope/data/sync versions', async () => {
        await initializeLocal('a', data(170));
        expect(await readLocal('a')).toMatchObject({
            version: CURRENT_LOCAL_ENVELOPE,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            owner: 'user:a',
        });
    });

    it('does not overwrite a guest envelope that appeared after a stale bootstrap read', async () => {
        const initial = data(170);
        // Tab A observed absence, but tab B initialized and committed first.
        expect(await readLocal('guest')).toBeNull();
        await initializeLocal('guest', initial);
        await commitLocal('guest', data(180), initial);
        const durable = await readLocal('guest');
        expect(durable?.pending).toEqual([]); // Guest operations have no cloud journal.
        await initializeLocal('guest', data(160));
        expect((await readLocal('guest'))?.data.profile.height).toBe('180');
        expect((await readLocal('guest'))?.revision).toBe(durable?.revision);
    });

    it('preserves an already-acknowledged authenticated envelope during bootstrap', async () => {
        await initializeLocal('user:a', data(170));
        await initializeLocal('user:a', data(190));
        expect((await readLocal('user:a'))?.data.profile.height).toBe('170');
    });

    it('rejects a stale initialization after logout rather than recreating its envelope', async () => {
        await initializeLocal('guest', data(170), undefined, () => true);
        await clear();
        await expect(initializeLocal('guest', data(190), undefined, () => false))
            .rejects.toThrow('invalidata');
        expect(await readLocal('guest')).toBeNull();
    });

    it('does not recreate deleted data from a stale snapshot commit', async () => {
        await initializeLocal('user:a', data(170));
        await clear();
        await commitLocal('user:a', data(180), data(170), () => false);
        expect(await readLocal('user:a')).toBeNull();
    });

    it('rejects pre-M1 and future local envelopes without rewriting their bytes', async () => {
        const legacy = { owner: 'user:a', version: 3 };
        await set('logbook:v2:user:a', legacy);
        await expect(readLocal('a')).rejects.toThrow(LegacyVersionError);
        expect(await get('logbook:v2:user:a')).toEqual(legacy);

        const future = { ownerV2: 'user:a', version: CURRENT_LOCAL_ENVELOPE + 1 };
        await set('logbook:v2:user:a', future);
        await expect(readLocal('a')).rejects.toThrow(FutureVersionError);
        expect(await get('logbook:v2:user:a')).toEqual(future);
    });

    it('rejects a pre-launch protocol local envelope without rewriting its bytes', async () => {
        const payload = data(170);
        const legacy = {
            version: CURRENT_LOCAL_ENVELOPE,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: 1,
            owner: 'user:a',
            actorId: 'actor-a',
            actorSeq: 1,
            clock: { 'actor-a': 1 },
            data: payload,
            baseline: payload,
            completeMonths: [],
            pending: [],
            syncMetaByDocument: {},
            revision: 1,
        };
        await set('logbook:v2:user:a', legacy);

        await expect(readLocal('a')).rejects.toThrow(LegacyVersionError);
        expect(await get('logbook:v2:user:a')).toEqual(legacy);
    });

    it('marks only the matching fenced replica as checkpoint-required without dropping its journal', async () => {
        await initializeLocal('a', data(170));
        const now = Date.now();
        const identity = {
            slot: 's00',
            replicaId: 'replica-a',
            generation: 1,
            checkpointAtMs: now,
            leaseUntilMs: now + 31_104_000_000,
        };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 }, { clock: {}, syncMetaByDocument: {} });
        await commitLocal('a', data(171), data(170));

        await markReplicaCheckpointRequired('a', { ...identity, generation: 2 });
        expect((await readLocal('a'))?.replica?.leaseUntilMs).toBe(identity.leaseUntilMs);

        await markReplicaCheckpointRequired('a', identity);
        const fenced = await readLocal('a');
        expect(fenced?.replica).toMatchObject({ slot: 's00', replicaId: 'replica-a', generation: 1, checkpointAtMs: 1, leaseUntilMs: 1 });
        expect(fenced?.pending).toHaveLength(1);
        expect(fenced?.actorSeq).toBe(1);
    });

    it('keeps pending sequence numbers when renewing the same replica', async () => {
        await initializeLocal('a', data(170));
        const now = Date.now();
        const identity = { slot: 's00', replicaId: 'replica-a', generation: 1, checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 }, { clock: {}, syncMetaByDocument: {} });
        await commitLocal('a', data(171), data(170));
        await commitLocal('a', data(172), data(171));
        const renewed = { ...identity, checkpointAtMs: now + 1000, leaseUntilMs: identity.leaseUntilMs + 1000 };
        await adoptReplicaCheckpoint('a', { identity: renewed, baseSeq: 1 }, { clock: { remote: 3 }, syncMetaByDocument: {} });
        const after = await readLocal('a');
        expect(after?.actorSeq).toBe(2);
        expect(after?.pending.map(operation => operation.seq)).toEqual([1, 2]);
        expect(after?.clock).toMatchObject({ s00: 2, remote: 3 });
        expect(after?.replica).toEqual(renewed);
    });

    it('rejects a pending operation whose causal dot is not covered by its operation clock', async () => {
        await commitLocal('a', data(171), data(170));
        const raw = await get('logbook:v2:user:a') as any;
        raw.pending[0] = { ...raw.pending[0], clock: {} };
        await set('logbook:v2:user:a', raw);

        await expect(readLocal('a')).rejects.toThrow();
        expect(((await get('logbook:v2:user:a')) as any).pending[0].clock).toEqual({});
    });

    it('rejects local sync metadata whose document frontier does not cover a FieldStamp', async () => {
        const payload = data(170);
        await set('logbook:v2:user:a', {
            version: CURRENT_LOCAL_ENVELOPE,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            owner: 'user:a',
            actorId: 'actor-a',
            actorSeq: 1,
            clock: { 'actor-a': 1 },
            data: payload,
            baseline: payload,
            completeMonths: [],
            pending: [],
            syncMetaByDocument: {
                '': {
                    protocolVersion: CURRENT_SYNC_PROTOCOL,
                    clock: {},
                    fields: {
                        'profile/height': { actorId: 'actor-a', seq: 1, clock: { 'actor-a': 1 } },
                    },
                },
            },
            revision: 1,
        });

        await expect(readLocal('a')).rejects.toThrow();
    });

    it('does not resurrect a remote deletion in a complete window and preserves unloaded history', async () => {
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

    it('treats exhaustive hydration as authoritative for every monthly shard', async () => {
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

    it('does not let a delayed older acknowledgement roll back a newer durable acknowledgement', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        const first = data(171);
        await commitLocal('a', first, base);
        const actor = (await readLocal('a'))!.actorId;
        const meta1 = {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { [actor]: 1 },
            fields: { 'profile/height': { actorId: actor, seq: 1, clock: { [actor]: 1 } } },
        };
        await acknowledgeThrough('a', 1, first, [], { '': meta1 });

        const second = data(172);
        await commitLocal('a', second, first);
        const meta2 = {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { [actor]: 2 },
            fields: { 'profile/height': { actorId: actor, seq: 2, clock: { [actor]: 2 } } },
        };
        await acknowledgeThrough('a', 2, second, [], { '': meta2 });
        await acknowledgeThrough('a', 1, first, [], { '': meta1 });

        const stored = await readLocal('a');
        expect(stored?.data.profile.height).toBe('172');
        expect(stored?.baseline.profile.height).toBe('172');
        expect(stored?.syncMetaByDocument[''].clock[actor]).toBe(2);
    });

    it('does not let an older hydration snapshot replace a causally newer durable state', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        const newer = data(172);
        await commitLocal('a', newer, base);
        const actor = (await readLocal('a'))!.actorId;
        const meta2 = {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { [actor]: 1 },
            fields: { 'profile/height': { actorId: actor, seq: 1, clock: { [actor]: 1 } } },
        };
        await acknowledgeThrough('a', 1, newer, [], { '': meta2 });

        const stale = data(170);
        const staleDocuments = new Map<string, any>([
            ['', { profile: stale.profile, _sync: {
                protocolVersion: CURRENT_SYNC_PROTOCOL,
                clock: {},
                fields: {},
            } }],
        ]);
        const hydrated = await hydrateLocal('a', stale, [], staleDocuments, 'window');

        expect(hydrated.data.profile.height).toBe('172');
        expect((await readLocal('a'))?.data.profile.height).toBe('172');
    });

    it('emits parent tombstones when a workout or nutrition day is deleted', async () => {
        const base = UserDataSchema.parse({
            history: [{ id: 'w1', date: '2026-09-10', routineName: 'A', duration: '20m', exercises: [] }],
            nutrition: { '2026-09-10': { date: '2026-09-10', weight: 80 } }
        }) as unknown as UserData;
        const desired = UserDataSchema.parse({ history: [], nutrition: {} }) as unknown as UserData;

        await initializeLocal('a', base);
        const operations = await commitLocal('a', desired, base);

        const workoutDeletes = operations.filter(op => op.docPath === 'history_months/2026-09');
        const nutritionDeletes = operations.filter(op => op.docPath === 'nutrition_months/2026-09');
        expect(workoutDeletes).toEqual([expect.objectContaining({ path: ['w1'], isDelete: true })]);
        expect(nutritionDeletes).toEqual([expect.objectContaining({ path: ['2026-09-10'], isDelete: true })]);
    });

    it('does not advance actorSeq for a semantic no-op', async () => {
        const initial = data(170);
        await initializeLocal('a', initial);
        const before = await readLocal('a');

        const operations = await commitLocal('a', initial, initial);
        const after = await readLocal('a');

        expect(operations).toEqual([]);
        expect(after?.actorSeq).toBe(before?.actorSeq);
        expect(after?.clock).toEqual(before?.clock);
        expect(after?.pending).toEqual(before?.pending);
    });

    it('rejects a quota failure without changing the previous data or journal', async () => {
        await initializeLocal('a', data(170));
        const before = await readLocal('a');
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow('Quota exceeded');
        expect(await readLocal('a')).toEqual(before);
    });

    it('isolates accounts and guest, and protects pending changes from hydration', async () => {
        await commitLocal('a', data(171), data(170));
        await commitLocal('b', data(180), data(179));
        await commitLocal('guest', data(160), data(159));
        await initializeLocal('a', data(120));
        expect((await readLocal('a'))?.data.profile.height).toBe('171');
        expect((await readLocal('b'))?.data.profile.height).toBe('180');
        expect((await readLocal('guest'))?.pending).toEqual([]);
    });

    it('rejects corrupt current-envelope ownership and preserves the original bytes', async () => {
        await initializeLocal('b', data(170));
        const corrupt = await get('logbook:v2:user:b');
        await set('logbook:v2:user:a', corrupt);
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow('recupero');
        expect(await get('logbook:v2:user:a')).toEqual(corrupt);
    });

    it('rejects a changed durable baseline even when actor revision did not advance', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        const preview = await readLocal('a');
        expect(preview?.revision).toBe(0);

        await hydrateLocal('a', data(180), [], undefined, 'window');
        const hydrated = await readLocal('a');
        expect(hydrated?.revision).toBe(preview?.revision);
        expect(hydrated?.data.profile.height).toBe('180');

        await expect(
            commitLocal('a', data(190), base, undefined, preview!.revision),
        ).rejects.toThrow(StaleLocalRevisionError);

        expect(await readLocal('a')).toEqual(hydrated);
    });

    it('rejects a stale bulk-write revision atomically without changing durable state', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        const preview = await readLocal('a');
        expect(preview).toBeDefined();

        await commitLocal('a', data(171), base);
        const concurrent = await readLocal('a');

        await expect(
            commitLocal('a', data(180), base, undefined, preview!.revision),
        ).rejects.toThrow(StaleLocalRevisionError);

        expect(await readLocal('a')).toEqual(concurrent);
    });
    it('replays a stale snapshot delta over the latest envelope without deleting concurrent entities', async () => {
        const base = UserDataSchema.parse({
            profile: { height: '170' },
            routines: [],
        }) as unknown as UserData;
        const tabA = UserDataSchema.parse({
            ...base,
            routines: [{ id: 'routine-a', name: 'Tab A', exercises: [] }],
        }) as unknown as UserData;
        const tabB = UserDataSchema.parse({
            ...base,
            profile: { height: '171' },
        }) as unknown as UserData;

        await initializeLocal('a', base);
        await commitLocal('a', tabA, base);
        const operations = await commitLocal('a', tabB, base);
        const stored = await readLocal('a');

        expect(stored?.data.profile.height).toBe('171');
        expect(stored?.data.routines?.map(routine => routine.id)).toContain('routine-a');
        expect(operations.some(op => op.isDelete && op.path.includes('routine-a'))).toBe(false);
        expect(stored?.pending.some(op => op.isDelete && op.path.includes('routine-a'))).toBe(false);
    });

    it('keeps concurrent guest entities when a stale guest snapshot is committed', async () => {
        const base = UserDataSchema.parse({
            profile: { height: '170' },
            routines: [],
        }) as unknown as UserData;
        const tabA = UserDataSchema.parse({
            ...base,
            routines: [{ id: 'guest-routine-a', name: 'Guest A', exercises: [] }],
        }) as unknown as UserData;
        const tabB = UserDataSchema.parse({
            ...base,
            profile: { height: '171' },
        }) as unknown as UserData;

        await initializeLocal('guest', base);
        await commitLocal('guest', tabA, base);
        const operations = await commitLocal('guest', tabB, base);
        const stored = await readLocal('guest');

        expect(stored?.data.profile.height).toBe('171');
        expect(stored?.data.routines?.map(routine => routine.id)).toContain('guest-routine-a');
        expect(operations.some(op => op.isDelete && op.path.includes('guest-routine-a'))).toBe(false);
        expect(stored?.pending).toHaveLength(0);
    });

    it('restore-style snapshot deletes only entities known to its base and preserves concurrent additions', async () => {
        const base = UserDataSchema.parse({
            routines: [{ id: 'routine-old', name: 'Old', exercises: [] }],
        }) as unknown as UserData;
        const concurrent = UserDataSchema.parse({
            routines: [
                { id: 'routine-old', name: 'Old', exercises: [] },
                { id: 'routine-new', name: 'Concurrent', exercises: [] },
            ],
        }) as unknown as UserData;
        const restored = UserDataSchema.parse({ routines: [] }) as unknown as UserData;

        await initializeLocal('a', base);
        await commitLocal('a', concurrent, base);
        const operations = await commitLocal('a', restored, base);
        const stored = await readLocal('a');

        expect(stored?.data.routines?.map(routine => routine.id)).toEqual(['routine-new']);
        expect(operations).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: ['routines', 'routine-old'], isDelete: true }),
        ]));
        expect(operations.some(op => op.isDelete && op.path.includes('routine-new'))).toBe(false);
    });

});
