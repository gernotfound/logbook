import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({ exercises: [], foods: [] }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => catalog }));

import type { UserData } from '../../src/types';
import { UserDataSchema } from '../../src/lib/schema';
import {
    acknowledgeThrough,
    commitLocal,
    initializeLocal,
    readLocal,
} from '../../src/lib/sync/localRepository';

const owner = 'user:ack-reconcile';

function data(height: number, name?: string): UserData {
    return UserDataSchema.parse({
        profile: {
            height: String(height),
            ...(name ? { name } : {}),
        },
    }) as unknown as UserData;
}

beforeEach(async () => {
    await clear();
    await initializeLocal(owner, data(170));
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
        await acknowledgeThrough(owner, 1, data(171, 'remote-device'));

        const after = await readLocal(owner);
        expect(after?.baseline.profile.height).toBe('171');
        expect(after?.baseline.profile.name).toBe('remote-device');
        expect(after?.data.profile.height).toBe('172');
        expect(after?.data.profile.name).toBe('remote-device');
        expect(after?.pending.length).toBeGreaterThan(0);
        expect(after?.pending.every(operation => operation.seq > 1)).toBe(true);
        expect(after?.pending.some(operation => operation.seq === 2)).toBe(true);
    });
});
