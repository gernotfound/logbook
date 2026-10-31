import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';

const catalog = vi.hoisted(() => ({ exercises: [], foods: [] }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => catalog }));

import type { UserData } from '../../src/types';
import { UserDataSchema } from '../../src/lib/schema';
import {
    acknowledgeThrough,
    adoptReplicaCheckpoint,
    commitLocal,
    initializeLocal,
    readLocal,
} from '../../src/lib/sync/localRepository';

const owner = 'user:ack-reconcile';
const replica = {
    slot: 's00', replicaId: 'ack-reconcile-regression', generation: 1,
    checkpointAtMs: Date.now(), leaseUntilMs: Date.now() + 60_000,
};

function data(height: number, neck?: string): UserData {
    return UserDataSchema.parse({
        profile: {
            height: String(height),
            ...(neck ? { neck } : {}),
        },
    }) as unknown as UserData;
}

beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    await clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
    await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 }, {
        clock: {}, syncMetaByDocument: {},
    });
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
});

describe('acknowledgeThrough reconciliation', () => {
    it('preserves remote changes while replaying only newer local pending operations', async () => {
        await commitLocal(owner, data(171), data(170));
        await commitLocal(owner, data(172), data(171));

        const before = await readLocal(owner);
        expect(before?.actorSeq).toBe(2);
        expect(before?.pending.some(operation => operation.seq === 1)).toBe(true);
        expect(before?.pending.some(operation => operation.seq === 2)).toBe(true);

        // The acknowledged cloud state contains seq 1 plus an independent change
        // made by another device while local seq 2 is still pending.
        const delivered = before!.pending.filter(operation => operation.seq === 1);
        expect(delivered).toHaveLength(1);
        await acknowledgeThrough(owner, 1, data(171, '39'), [], undefined, {
            operations: delivered, replica,
        });

        const after = await readLocal(owner);
        expect(after?.baseline.profile?.height).toBe('171');
        expect(after?.baseline.profile?.neck).toBe('39');
        expect(after?.data.profile?.height).toBe('172');
        expect(after?.data.profile?.neck).toBe('39');
        expect(after?.pending.length).toBeGreaterThan(0);
        expect(after?.pending.every(operation => operation.seq > 1)).toBe(true);
        expect(after?.pending.some(operation => operation.seq === 2)).toBe(true);
    });
    it.each(['altered-payload', 'wrong-replica', 'wrong-generation', 'wrong-prefix', 'wrong-sequence'] as const)(
        'preserves the complete local journal if delivered evidence is %s', async scenario => {
            await commitLocal(owner, data(171), data(170));
            await commitLocal(owner, data(172), data(171));
            const before = await readLocal(owner);
            expect(before?.pending.length).toBeGreaterThanOrEqual(2);
            const delivered = structuredClone(before!.pending.filter(operation => operation.seq === 1));
            expect(delivered).toHaveLength(1);

            let expectedSeq = 1;
            let deliveredReplica = replica;
            switch (scenario) {
                case 'altered-payload':
                    delivered[0] = { ...delivered[0], value: 'tampered-after-delivery' };
                    break;
                case 'wrong-replica':
                    deliveredReplica = { ...replica, replicaId: 'another-replica' };
                    break;
                case 'wrong-generation':
                    deliveredReplica = { ...replica, generation: 2 };
                    break;
                case 'wrong-prefix':
                    delivered.push(...before!.pending.filter(operation => operation.seq === 2));
                    break;
                case 'wrong-sequence':
                    expectedSeq = 0;
                    break;
            }

            await expect(acknowledgeThrough(owner, expectedSeq, data(171, '39'), [], undefined, {
                operations: delivered, replica: deliveredReplica,
            })).rejects.toThrow('Acknowledgement invalidato');
            expect(await readLocal(owner)).toEqual(before);
        },
    );
    it('fails closed on an unknown owner instead of creating a fresh envelope', async () => {
        const before = await readLocal(owner);
        const unknownOwner = 'user:missing-ack-reconcile';
        await createAndMigrateVault(unknownOwner);
        expect(await readLocal(unknownOwner)).toBeUndefined();

        await expect(acknowledgeThrough(unknownOwner, 0, data(171)))
            .rejects.toThrow('Archivio locale non trovato');

        expect(await readLocal(unknownOwner)).toBeUndefined();
        expect(await readLocal(owner)).toEqual(before);
    });

    it.each([null, false, []] as const)(
        'rejects a non-object cloud snapshot (%s) without retiring a durable journal',
        async invalidRemote => {
            await commitLocal(owner, data(171), data(170));
            const before = await readLocal(owner);
            expect(before?.pending.length).toBeGreaterThan(0);

            await expect(acknowledgeThrough(owner, 1, invalidRemote as unknown as UserData))
                .rejects.toThrow('Snapshot cloud non valido');

            expect(await readLocal(owner)).toEqual(before);
        },
    );

    it('retains the compatibility reconciliation path when no delivery proof is supplied', async () => {
        const incoming = data(173, '39');
        const before = await readLocal(owner);
        expect(before?.pending).toEqual([]);

        await acknowledgeThrough(owner, 0, incoming);
        const after = await readLocal(owner);
        expect(after?.baseline.profile).toEqual(incoming.profile);
        expect(after?.data.profile).toEqual(incoming.profile);
        expect(after?.pending).toEqual([]);
        expect(after?.replica).toEqual(before?.replica);
    });

});
