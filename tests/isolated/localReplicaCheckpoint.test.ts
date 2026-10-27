import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: async () => ({ exercises: [], foods: [] }),
}));

import type { UserData } from '../../src/types';
import { UserDataSchema } from '../../src/lib/schema';
import {
    adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal,
} from '../../src/lib/sync/localRepository';
import type { ReplicaIdentity } from '../../src/lib/sync/replicaProtocol';

const data = (height: number): UserData =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;
const key = (owner: string): string => `logbook:v2:user:${owner}`;
const identity = (slot: string, replicaId = 'checkpoint-test', generation = 1): ReplicaIdentity => ({
    slot, replicaId, generation, checkpointAtMs: 1_760_000_000_000, leaseUntilMs: 1_790_000_000_000,
});

beforeEach(() => clear());

describe('durable local replica checkpoint adoption', () => {
    it('rebases pending business changes on a replacement slot without losing journal content', async () => {
        await initializeLocal('a', data(170));
        await adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        await commitLocal('a', data(171), data(170));
        const before = (await readLocal('a'))!;
        expect(before.pending.length).toBeGreaterThan(0);

        const replacement = identity('s01', 'replacement', 2);
        const after = await adoptReplicaCheckpoint(
            'a', { identity: replacement, baseSeq: 7 },
            { clock: { s00: 1 }, syncMetaByDocument: {} },
        );

        expect(after.replica).toEqual(replacement);
        expect(after.actorId).toBe('s01');
        expect(after.actorSeq).toBe(8);
        expect(after.clock).toEqual({ s00: 1, s01: 8 });
        expect(after.pending.length).toBeGreaterThan(0);
        expect(after.pending.every(op => op.actorId === 's01' && op.seq === 8)).toBe(true);
        expect(after.pending.map(op => [op.docPath, op.path, op.isDelete, op.value]))
            .toEqual(before.pending.map(op => [op.docPath, op.path, op.isDelete, op.value]));
        expect(after.data).toEqual(before.data);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.revision).toBe(before.revision + 1);
        expect(await readLocal('a')).toEqual(after);
    });

    it('renews an identical replica without rewriting pending sequences', async () => {
        await initializeLocal('a', data(170));
        const oldReplica = identity('s00');
        await adoptReplicaCheckpoint('a', { identity: oldReplica, baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        await commitLocal('a', data(171), data(170));
        const before = (await readLocal('a'))!;
        const renewed = { ...oldReplica, checkpointAtMs: oldReplica.checkpointAtMs + 100 };
        const after = await adoptReplicaCheckpoint('a', { identity: renewed, baseSeq: 1 }, {
            clock: { s02: 4 }, syncMetaByDocument: {},
        });

        expect(after.replica).toEqual(renewed);
        expect(after.actorSeq).toBe(before.actorSeq);
        expect(after.pending).toEqual(before.pending);
        expect(after.data).toEqual(before.data);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.syncMetaByDocument).toEqual(before.syncMetaByDocument);
        expect(after.clock).toEqual({ ...before.clock, s02: 4 });
        expect(after.revision).toBe(before.revision + 1);
    });

    it('rejects a stale session guard without altering either owner', async () => {
        await initializeLocal('a', data(170));
        await initializeLocal('b', data(174));
        const aBefore = await get(key('a'));
        const bBefore = await get(key('b'));
        await expect(adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        }, () => false)).rejects.toThrow('Checkpoint replica invalidato');
        expect(await get(key('a'))).toEqual(aBefore);
        expect(await get(key('b'))).toEqual(bBefore);
    });

    it('fails closed and preserves invalid journal bytes when changing slot', async () => {
        await initializeLocal('a', data(170));
        await adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        await commitLocal('a', data(171), data(170));
        const raw = (await get(key('a'))) as { pending: Array<{ actorId: string }> };
        expect(raw.pending.length).toBeGreaterThan(0);
        const corrupt = { ...raw, pending: raw.pending.map(op => ({ ...op, actorId: 'other' })) };
        await set(key('a'), corrupt);

        await expect(adoptReplicaCheckpoint('a', { identity: identity('s01'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        })).rejects.toThrow();
        expect(await get(key('a'))).toEqual(corrupt);
    });

    it('does not create a missing owner archive', async () => {
        expect(await readLocal('absent')).toBeUndefined();
        await expect(adoptReplicaCheckpoint('absent', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        })).rejects.toThrow('Archivio locale non trovato durante il checkpoint replica');
        expect(await get(key('absent'))).toBeUndefined();
    });
});
