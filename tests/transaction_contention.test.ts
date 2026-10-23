import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserDataSchema } from '../src/lib/schema';
import type { UserData } from '../src/types';
import { commitLocal, initializeLocal, readLocal } from '../src/lib/sync/localRepository';

describe('Transaction Contention & ActorSeq Invatiants', () => {
    beforeEach(async () => {
        await clear();
    });

    it('correctly increments actorSeq and maintains clock invariants under concurrent commits', async () => {
        const base = UserDataSchema.parse({}) as unknown as UserData;
        await initializeLocal('user:a', base);

        const data1 = UserDataSchema.parse({ profile: { height: '170' } }) as unknown as UserData;
        const data2 = UserDataSchema.parse({ profile: { height: '170', gender: 'M' } }) as unknown as UserData;
        const data3 = UserDataSchema.parse({ profile: { height: '171', gender: 'M' } }) as unknown as UserData;

        // Perform concurrent commits
        await Promise.all([
            commitLocal('user:a', data1, base),
            commitLocal('user:a', data2, base),
            commitLocal('user:a', data3, base)
        ]);

        const finalState = await readLocal('user:a');
        expect(finalState).toBeDefined();
        if (!finalState) throw new Error('The durable envelope was not created');

        // Three distinct intents must survive the IDB transaction queue. A mere
        // actorSeq range would also pass if two concurrent commits were lost.
        expect(finalState.actorSeq).toBe(3);
        expect(finalState.clock[finalState.actorId]).toBe(3);
        expect([...new Set(finalState.pending.map(op => op.seq))]).toEqual([1, 2, 3]);
        expect(finalState.pending.every(op =>
            op.actorId === finalState.actorId && op.clock[finalState.actorId] === op.seq,
        )).toBe(true);
        expect(finalState.pending.some(op => op.path.join('/') === 'profile/height' && op.value === '170')).toBe(true);
        expect(finalState.pending.some(op => op.path.join('/') === 'profile/gender' && op.value === 'M')).toBe(true);
        expect(finalState.pending.some(op => op.path.join('/') === 'profile/height' && op.value === '171')).toBe(true);
        expect(finalState.data.profile?.height).toBe('171');
        expect(finalState.data.profile?.gender).toBe('M');

        // Re-read the serialized envelope rather than accepting the Promise results
        // or a potentially optimistic in-memory view as proof of persistence.
        const reopened = await readLocal('user:a');
        expect(reopened?.pending).toEqual(finalState.pending);
        expect(reopened?.data).toEqual(finalState.data);
    });
});
