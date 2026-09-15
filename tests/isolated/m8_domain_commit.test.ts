import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { UserDataSchema } from '../../src/lib/schema';
import type { CachedGlobalCatalog, UserData } from '../../src/types';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'm8-test',
        updatedAt: '2026-09-15T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

vi.mock('../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: vi.fn(async () => catalog),
}));

const base = (): UserData => UserDataSchema.parse({ profile: { height: '170', gender: 'M' } }) as unknown as UserData;

describe('M8 domain commit durability', () => {
    beforeEach(async () => {
        await clear();
    });

    it('persists business state and semantic journal under the same envelope revision', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        await initializeLocal('user:a', base());

        const result = await commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '171' } }, base());
        const stored = await readLocal('user:a');

        expect(result.data.profile?.height).toBe('171');
        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].path).toEqual(['profile', 'height']);
        expect(stored?.data.profile?.height).toBe('171');
        expect(stored?.actorSeq).toBe(1);
        expect(stored?.revision).toBe(1);
        expect(stored?.pending).toEqual(result.operations);
        expect(stored?.clock[stored.actorId]).toBe(1);
    });

    it('serializes concurrent domain commits without losing either intent', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const initial = base();
        await initializeLocal('user:a', initial);

        await Promise.all([
            commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '171' } }, initial),
            commitDomainOperations('user:a', { type: 'profile.patch', patch: { dob: '1990-01-01' } }, initial),
        ]);

        const stored = await readLocal('user:a');
        expect(stored?.data.profile?.height).toBe('171');
        expect(stored?.data.profile?.dob).toBe('1990-01-01');
        expect(stored?.actorSeq).toBe(2);
        expect(new Set(stored?.pending.map(op => op.path.join('/')))).toEqual(new Set(['profile/height', 'profile/dob']));
    });

    it('does not enqueue cloud journal operations for guest ownership', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const initial = base();
        await initializeLocal('guest', initial);
        await commitDomainOperations('guest', { type: 'profile.patch', patch: { height: '172' } }, initial);
        const stored = await readLocal('guest');

        expect(stored?.data.profile?.height).toBe('172');
        expect(stored?.pending).toEqual([]);
        expect(stored?.actorSeq).toBe(1);
    });
});
