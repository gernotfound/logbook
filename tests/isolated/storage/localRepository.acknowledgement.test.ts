import 'fake-indexeddb/auto';
import { get } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData } from '../../../src/types';
import { getArchiveRecord, updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { adoptReplicaCheckpoint, hydrateLocal, commitLocal, initializeLocal, readLocal, acknowledgeThrough } from '../../../src/lib/sync/localRepository';
import { CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { installLocalRepositoryFixture, data, prepareOwnerVault } from './localRepositoryFixture';

describe('durable owner-scoped journal', () => {
    installLocalRepositoryFixture();

    it('refuses to acknowledge a same-sequence batch whose durable payload changed', async () => {
        await prepareOwnerVault('user:a');
        const base = data(170);
        await initializeLocal('a', base);
        const now = Date.now();
        const identity = { slot: 's00', replicaId: 'ack-payload', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        await commitLocal('a', data(171), base);
        const before = (await readLocal('a'))!;
        expect(before.pending.length).toBeGreaterThan(0);
        const key = 'logbook:v2:user:a';
        await updateArchiveRecord<any>('user:a', raw => ({
            ...raw,
            pending: raw.pending.map((op: any) => ({ ...op, value: 'unexpected-payload' })),
        }));
        const changedCiphertext = await get<string>(key);
        const corrupted = await getArchiveRecord<any>('user:a');

        await expect(acknowledgeThrough('a', before.pending.at(-1)!.seq, data(171), [], undefined,
            { operations: before.pending, replica: identity })).rejects.toThrow('Acknowledgement invalidato');
        expect(await get(key)).toBe(changedCiphertext);
        expect((await readLocal('a'))?.pending).toEqual(corrupted.pending);
    });

    it('refuses to retire a new replica journal using the old replica acknowledgement', async () => {
        await prepareOwnerVault('user:a');
        const base = data(170);
        await initializeLocal('a', base);
        const now = Date.now();
        const first = { slot: 's00', replicaId: 'ack-old-replica', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity: first, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        await commitLocal('a', data(171), base);
        const delivered = (await readLocal('a'))!;
        expect(delivered.pending.length).toBeGreaterThan(0);
        const second = { ...first, slot: 's01', replicaId: 'ack-new-replica' };
        await adoptReplicaCheckpoint('a', { identity: second, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        const before = (await readLocal('a'))!;
        expect(before.actorId).toBe('s01');
        // A disappearing journal would make the .every() assertion vacuously pass.
        expect(before.pending.length).toBeGreaterThan(0);
        expect(before.pending.every(op => op.actorId === 's01')).toBe(true);

        await expect(acknowledgeThrough('a', delivered.pending.at(-1)!.seq, data(171), [], undefined,
            { operations: delivered.pending, replica: first })).rejects.toThrow('Acknowledgement invalidato');
        expect(await readLocal('a')).toEqual(before);
    });

    it('keeps a newly hydrated month and its baseline when an older root-only delivery is acknowledged', async () => {
        await prepareOwnerVault('user:a');
        const base = UserDataSchema.parse({
            profile: { height: '170' },
            nutrition: { '2026-09-01': { date: '2026-09-01', weight: 70 } },
        }) as unknown as UserData;
        await initializeLocal('a', base, ['2026-09']);
        const now = Date.now();
        const identity = { slot: 's00', replicaId: 'root-ack-month-hydration', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        const sentRoot = UserDataSchema.parse({
            ...base, profile: { height: '171' },
        }) as unknown as UserData;
        await commitLocal('a', sentRoot, base);
        const delivered = (await readLocal('a'))!;
        expect(delivered.pending.length).toBeGreaterThan(0);
        expect(delivered.pending.every(op => op.docPath === '')).toBe(true);

        // Remote response still carries weight=70 from the pre-hydration snapshot.
        // Another tab completes an authoritative month hydration before local ack.
        const newlyHydrated = UserDataSchema.parse({
            ...base, nutrition: { '2026-09-01': { date: '2026-09-01', weight: 80 } },
        }) as unknown as UserData;
        await hydrateLocal('a', newlyHydrated, ['2026-09'], undefined, 'window');
        const beforeAck = (await readLocal('a'))!;
        expect(beforeAck.data.nutrition?.['2026-09-01']?.weight).toBe(80);
        expect(beforeAck.pending.length).toBe(delivered.pending.length);

        await acknowledgeThrough('a', delivered.pending.at(-1)!.seq, sentRoot, [], undefined,
            { operations: delivered.pending, replica: identity });
        const after = (await readLocal('a'))!;
        expect(after.pending).toHaveLength(0);
        expect(after.data.profile?.height).toBe('171');
        expect(after.data.nutrition?.['2026-09-01']?.weight).toBe(80);
        expect(after.baseline.nutrition?.['2026-09-01']?.weight).toBe(80);
    });

    it('keeps a newly hydrated root when an older month-only delivery is acknowledged', async () => {
        await prepareOwnerVault('user:a');
        const base = UserDataSchema.parse({
            profile: { height: '170' },
            nutrition: { '2026-09-01': { date: '2026-09-01', weight: 70 } },
        }) as unknown as UserData;
        await initializeLocal('a', base, ['2026-09']);
        const now = Date.now();
        const identity = { slot: 's00', replicaId: 'month-ack-root-hydration', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        const sentMonth = UserDataSchema.parse({
            ...base, nutrition: { '2026-09-01': { date: '2026-09-01', weight: 71 } },
        }) as unknown as UserData;
        await commitLocal('a', sentMonth, base);
        const delivered = (await readLocal('a'))!;
        expect(delivered.pending.length).toBeGreaterThan(0);
        expect(delivered.pending.every(op => op.docPath === 'nutrition_months/2026-09')).toBe(true);

        const newlyHydrated = UserDataSchema.parse({
            ...sentMonth, profile: { height: '172' },
        }) as unknown as UserData;
        await hydrateLocal('a', newlyHydrated, ['2026-09'], undefined, 'window');
        await acknowledgeThrough('a', delivered.pending.at(-1)!.seq, sentMonth, ['2026-09'], undefined,
            { operations: delivered.pending, replica: identity });
        const after = (await readLocal('a'))!;
        expect(after.pending).toHaveLength(0);
        expect(after.data.profile?.height).toBe('172');
        expect(after.baseline.profile?.height).toBe('172');
        expect(after.data.nutrition?.['2026-09-01']?.weight).toBe(71);
    });

    it('acknowledges only the delivered prefix while preserving a newer local edit', async () => {
        await prepareOwnerVault('user:a');
        const base = data(170);
        await initializeLocal('a', base);
        const now = Date.now();
        const identity = { slot: 's00', replicaId: 'ack-newer-edit', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        await commitLocal('a', data(171), base);
        const delivered = (await readLocal('a'))!;
        await commitLocal('a', data(172), data(171));

        await acknowledgeThrough('a', delivered.pending.at(-1)!.seq, data(171), [], undefined,
            { operations: delivered.pending, replica: identity });
        const after = (await readLocal('a'))!;
        expect(after.baseline.profile?.height).toBe('171');
        expect(after.data.profile?.height).toBe('172');
        expect(after.pending.length).toBeGreaterThan(0);
        expect(after.pending.every(op => op.seq > delivered.pending.at(-1)!.seq)).toBe(true);
    });

    it('does not let a delayed older acknowledgement roll back a newer durable acknowledgement', async () => {
        await prepareOwnerVault('user:a');
        const base = data(170);
        await initializeLocal('a', base);
        const now = Date.now();
        const identity = { slot: 's00', replicaId: 'ordered-ack-regression', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        const first = data(171);
        await commitLocal('a', first, base);
        const firstDelivery = (await readLocal('a'))!;
        const actor = firstDelivery.actorId;
        const meta1 = {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { [actor]: 1 },
            fields: { 'profile/height': { actorId: actor, seq: 1, clock: { [actor]: 1 } } },
        };
        await acknowledgeThrough('a', 1, first, [], { '': meta1 }, {
            operations: structuredClone(firstDelivery.pending), replica: identity,
        });

        const second = data(172);
        await commitLocal('a', second, first);
        const meta2 = {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { [actor]: 2 },
            fields: { 'profile/height': { actorId: actor, seq: 2, clock: { [actor]: 2 } } },
        };
        const secondDelivery = (await readLocal('a'))!;
        await acknowledgeThrough('a', 2, second, [], { '': meta2 }, {
            operations: structuredClone(secondDelivery.pending), replica: identity,
        });
        await expect(acknowledgeThrough('a', 1, first, [], { '': meta1 }, {
            operations: structuredClone(firstDelivery.pending), replica: identity,
        })).rejects.toThrow('Acknowledgement invalidato');

        const stored = await readLocal('a');
        expect(stored?.data.profile?.height).toBe('172');
        expect(stored?.baseline.profile?.height).toBe('172');
        expect(stored?.syncMetaByDocument[''].clock[actor]).toBe(2);
    });

});
