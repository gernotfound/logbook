import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData } from '../../../src/types';
import { LocalCiphertextError } from '../../../src/lib/sync/secureArchiveCipher';
import { hydrateLocal, commitLocal, initializeLocal, readLocal, StaleLocalRevisionError } from '../../../src/lib/sync/localRepository';
import { installLocalRepositoryFixture, data, prepareOwnerVault, prepareGuestVault } from './localRepositoryFixture';

describe('durable owner-scoped journal', () => {
    installLocalRepositoryFixture();

    it('emits parent tombstones when a workout or nutrition day is deleted', async () => {
        await prepareOwnerVault('user:a');
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

    it('keeps business state and journal atomic when a monthly deletion write is rejected', async () => {
        await prepareOwnerVault('user:a');
        const base = UserDataSchema.parse({
            history: [{ id: 'w1', date: '2026-09-10', routineName: 'A', duration: '20m', exercises: [] }],
            nutrition: { '2026-09-10': { date: '2026-09-10', weight: 80 } },
        }) as unknown as UserData;
        const desired = UserDataSchema.parse({ history: [], nutrition: {} }) as unknown as UserData;
        await initializeLocal('a', base);
        const before = await readLocal('a');
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('Injected monthly deletion failure', 'QuotaExceededError');
        });

        await expect(commitLocal('a', desired, base)).rejects.toThrow('Injected monthly deletion failure');
        expect(await readLocal('a')).toEqual(before);
    });

    it('creates a valid first owner envelope when a snapshot has no semantic delta', async () => {
        await prepareOwnerVault('user:initial');
        const initial = data(170);
        expect(await readLocal('user:initial')).toBeUndefined();
        expect(await commitLocal('user:initial', initial, initial)).toEqual([]);
        const durable = await readLocal('user:initial');
        expect(durable?.data).toEqual(UserDataSchema.parse(initial));
        expect(durable?.actorSeq).toBe(0);
        expect(durable?.pending).toEqual([]);
    });

    it('rejects an invalidated session for a no-op without changing the durable journal', async () => {
        await prepareOwnerVault('user:a');
        const initial = data(170);
        await initializeLocal('user:a', initial);
        await commitLocal('user:a', data(171), initial);
        const before = await readLocal('user:a');
        expect(before?.pending.length).toBeGreaterThan(0);

        await expect(commitLocal('user:a', before!.data, before!.data, () => false))
            .rejects.toThrow('Commit locale invalidato dal cambio sessione');
        expect(await readLocal('user:a')).toEqual(before);
    });

    it('does not advance actorSeq for a semantic no-op', async () => {
        await prepareOwnerVault('user:a');
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
        await prepareOwnerVault('user:a');
        await initializeLocal('a', data(170));
        const before = await readLocal('a');
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow('Quota exceeded');
        expect(await readLocal('a')).toEqual(before);
    });

    it('isolates accounts and guest, and protects pending changes from hydration', async () => {
        await prepareOwnerVault('user:a');
        await prepareOwnerVault('user:b');
        await prepareGuestVault();
        await commitLocal('a', data(171), data(170));
        await commitLocal('b', data(180), data(179));
        await commitLocal('guest', data(160), data(159));
        await initializeLocal('a', data(120));
        expect((await readLocal('a'))?.data.profile?.height).toBe('171');
        expect((await readLocal('b'))?.data.profile?.height).toBe('180');
        expect((await readLocal('guest'))?.pending).toEqual([]);
    });

    it('rejects corrupt current-envelope ownership and preserves the original bytes', async () => {
        await prepareOwnerVault('user:b');
        await prepareOwnerVault('user:a');
        await initializeLocal('b', data(170));
        const foreignCiphertext = await get<string>('logbook:v2:user:b');
        expect(foreignCiphertext).toMatch(/^tlb-sealed:v1:/);
        await set('logbook:v2:user:a', foreignCiphertext);
        await expect(readLocal('a')).rejects.toBeInstanceOf(LocalCiphertextError);
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow();
        expect(await get('logbook:v2:user:a')).toBe(foreignCiphertext);
    });

    it('increments the local revision on changed cloud hydration and rejects a stale bulk write', async () => {
        await prepareOwnerVault('user:a');
        const base = data(170);
        await initializeLocal('a', base);
        const preview = await readLocal('a');
        expect(preview?.revision).toBe(0);

        await hydrateLocal('a', data(180), [], undefined, 'window');
        const hydrated = await readLocal('a');
        expect(hydrated?.revision).toBe((preview?.revision ?? 0) + 1);
        expect(hydrated?.data.profile?.height).toBe('180');

        await expect(
            commitLocal('a', data(190), base, undefined, preview!.revision),
        ).rejects.toThrow(StaleLocalRevisionError);

        expect(await readLocal('a')).toEqual(hydrated);
    });

    it('rejects a stale bulk-write revision atomically without changing durable state', async () => {
        await prepareOwnerVault('user:a');
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
        await prepareOwnerVault('user:a');
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

        expect(stored?.data.profile?.height).toBe('171');
        expect(stored?.data.routines?.map(routine => routine.id)).toContain('routine-a');
        expect(operations.some(op => op.isDelete && op.path.includes('routine-a'))).toBe(false);
        expect(stored?.pending.some(op => op.isDelete && op.path.includes('routine-a'))).toBe(false);
    });

    it('keeps concurrent guest entities when a stale guest snapshot is committed', async () => {
        await prepareGuestVault();
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

        expect(stored?.data.profile?.height).toBe('171');
        expect(stored?.data.routines?.map(routine => routine.id)).toContain('guest-routine-a');
        expect(operations.some(op => op.isDelete && op.path.includes('guest-routine-a'))).toBe(false);
        expect(stored?.pending).toHaveLength(0);
    });

    it('restore-style snapshot deletes only entities known to its base and preserves concurrent additions', async () => {
        await prepareOwnerVault('user:a');
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
