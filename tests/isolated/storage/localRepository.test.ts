import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData } from '../../../src/types';
import { validateLocalEnvelope } from '../../../src/lib/sync/localEnvelopeValidation';
import { getArchiveRecord, updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import {
    adoptReplicaCheckpoint, hydrateLocal, commitLocal, commitDomainOperations, initializeLocal, readLocal,
} from '../../../src/lib/sync/localRepository';
import { installLocalRepositoryFixture, data, prepareOwnerVault } from './localRepositoryFixture';

describe('durable owner-scoped journal: integrity and closure evidence', () => {
    installLocalRepositoryFixture();

    it('aborts stale cloud hydration after an IndexedDB wait without touching the authenticated ciphertext', async () => {
        const owner = 'user:a';
        await prepareOwnerVault(owner);
        await initializeLocal(owner, data(170));
        await commitLocal(owner, data(171), data(170));
        const before = await get('logbook:v2:' + owner);
        const durable = await readLocal(owner);
        let guardCalls = 0;

        await expect(hydrateLocal(owner, data(199), [], new Map(), 'all', () => {
            guardCalls++;
            return false;
        })).rejects.toThrow('Hydration locale invalidata dal cambio sessione');
        expect(guardCalls).toBe(1);
        expect(await get('logbook:v2:' + owner)).toBe(before);
        expect(await readLocal(owner)).toEqual(durable);
    });

    it('rejects a stale replica checkpoint without rebasing pending operations', async () => {
        const owner = 'user:a';
        await prepareOwnerVault(owner);
        await initializeLocal(owner, data(170));
        await commitLocal(owner, data(171), data(170));
        const before = await get('logbook:v2:' + owner);
        const durable = await readLocal(owner);
        const now = Date.now();
        const identity = {
            slot: 's00', replicaId: 'stale-checkpoint', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000,
        };

        await expect(adoptReplicaCheckpoint(owner, { identity, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} }, () => false))
            .rejects.toThrow('Checkpoint replica invalidato dal cambio sessione');
        expect(await get('logbook:v2:' + owner)).toBe(before);
        expect(await readLocal(owner)).toEqual(durable);
    });


    it.each([undefined, '', 'invalid-id'])('rejects an ID-less or malformed workout journal marker (%s) without rewriting ciphertext', async intentId => {
        await prepareOwnerVault('user:a');
        const initial = data(170);
        await initializeLocal('user:a', initial);
        const envelope = (await readLocal('user:a'))!;
        await updateArchiveRecord<unknown>('user:a', () => ({
            ...envelope, lastWorkoutDeviceIntent: {
                generation: 'a'.repeat(32), sequence: 1, intentId,
            },
        }));
        const key = 'logbook:v2:user:a';
        const ciphertext = await get(key);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        await expect(readLocal('user:a')).rejects.toThrow('Controllo journal workout locale non valido');
        await expect(commitLocal('user:a', data(180), initial))
            .rejects.toThrow('Controllo journal workout locale non valido');
        expect(await get(key)).toBe(ciphertext);
    });

    it('commits closure evidence even for a no-op cloud clear, and keeps it through hydration', async () => {
        await prepareOwnerVault('user:a');
        const initial = UserDataSchema.parse({ activeWorkout: null }) as unknown as UserData;
        await initializeLocal('user:a', initial);
        const raw = await get('logbook:v2:user:a');
        expect(typeof raw).toBe('string');
        expect(raw).toMatch(/^tlb-sealed:v1:/);
        const before = await readLocal('user:a');

        await commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: null, deletedWorkoutId: 'retired-only-local',
        }, initial);
        const after = await readLocal('user:a');
        expect(after?.data.activeWorkout).toBeNull();
        expect(after?.lastClosedWorkoutId).toBe('retired-only-local');
        expect(after?.closedWorkoutIds).toEqual(['retired-only-local']);
        expect(after?.revision).toBe((before?.revision ?? 0) + 1);
        expect(after?.actorSeq).toBe(before?.actorSeq);

        await hydrateLocal('user:a', initial, [], undefined, 'window');
        expect((await readLocal('user:a'))?.lastClosedWorkoutId).toBe('retired-only-local');
        expect((await readLocal('user:a'))?.closedWorkoutIds).toEqual(['retired-only-local']);
    });


    it('preserves multiple deletion tombstones, including metadata-only commits', async () => {
        await prepareOwnerVault('user:a');
        const initial = UserDataSchema.parse({}) as unknown as UserData;
        await initializeLocal('user:a', initial);
        await commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: null, deletedWorkoutId: 'first-deleted',
        }, initial);
        await commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: null, deletedWorkoutId: 'second-deleted',
        }, initial);
        const persisted = await readLocal('user:a');
        expect(persisted?.lastClosedWorkoutId).toBe('second-deleted');
        expect(persisted?.closedWorkoutIds).toEqual(['first-deleted', 'second-deleted']);
        const beforeRetry = persisted?.revision;
        await commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: null, deletedWorkoutId: 'second-deleted',
        }, initial);
        expect((await readLocal('user:a'))?.revision).toBe(beforeRetry);
    });


    it('retains a single-marker closure alongside a newer deletion in the encrypted ledger', async () => {
        await prepareOwnerVault('user:a');
        const initial = UserDataSchema.parse({ activeWorkout: null }) as unknown as UserData;
        await initializeLocal('user:a', initial);
        // Preserve a valid single-marker closure when the ledger array has
        // not yet been populated, without ever writing plaintext.
        await updateArchiveRecord<any>('user:a', raw => ({
            ...raw, lastClosedWorkoutId: 'previously-deleted', closedWorkoutIds: undefined,
        }));
        expect(await get('logbook:v2:user:a')).toMatch(/^tlb-sealed:v1:/);

        await commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: null, deletedWorkoutId: 'newly-deleted',
        }, initial);
        const after = (await readLocal('user:a'))!;
        expect(after.lastClosedWorkoutId).toBe('newly-deleted');
        expect(after.closedWorkoutIds).toEqual(['previously-deleted', 'newly-deleted']);

        const oldTabWorkout = { id: 'previously-deleted', date: '2026-10-09', exercises: [] };
        await expect(commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: oldTabWorkout,
        }, initial)).rejects.toThrow('già terminato o eliminato');
        await expect(commitLocal('user:a',
            UserDataSchema.parse({ activeWorkout: oldTabWorkout }) as unknown as UserData,
            initial,
        )).rejects.toThrow('già terminato o eliminato');
        expect((await readLocal('user:a'))?.revision).toBe(after.revision);
    });

    it('records completion in the same durable write as history and cloud-active clear', async () => {
        await prepareOwnerVault('user:a');
        const finished = { id: 'session-finished', date: '2026-10-09', exercises: [] };
        const initial = UserDataSchema.parse({ activeWorkout: finished }) as unknown as UserData;
        await initializeLocal('user:a', initial);
        await commitDomainOperations('user:a', {
            type: 'workout.complete', workout: finished, expectedActiveWorkoutId: finished.id, activePains: [],
        }, initial);
        const persisted = await readLocal('user:a');
        expect(persisted?.data.activeWorkout).toBeNull();
        expect(persisted?.data.history?.map(item => item.id)).toContain(finished.id);
        expect(persisted?.closedWorkoutIds).toEqual([finished.id]);
    });


    it('keeps closure evidence and business state unchanged when the transaction is invalidated', async () => {
        await prepareOwnerVault('user:a');
        const initial = UserDataSchema.parse({}) as unknown as UserData;
        await initializeLocal('user:a', initial);
        const before = await readLocal('user:a');
        await expect(commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: null, deletedWorkoutId: 'not-committed',
        }, initial, () => false)).rejects.toThrow('invalidato');
        const after = await readLocal('user:a');
        expect(after?.closedWorkoutIds).toBeUndefined();
        expect(after?.lastClosedWorkoutId).toBeUndefined();
        expect(after?.revision).toBe(before?.revision);
    });



    it('retries a locally completed workout without modifying durable history or its journal', async () => {
        await prepareOwnerVault('user:a');
        const finished = { id: 'completion-retry', date: '2026-10-09', routineName: 'Original', exercises: [] };
        const initial = UserDataSchema.parse({ activeWorkout: finished }) as unknown as UserData;
        await initializeLocal('user:a', initial);
        const original = { type: 'workout.complete' as const, workout: finished,
            expectedActiveWorkoutId: finished.id, activePains: [] };
        await commitDomainOperations('user:a', original, initial);
        const before = (await readLocal('user:a'))!;
        await commitDomainOperations('user:a', {
            ...original, workout: { ...finished, routineName: 'Should not overwrite' },
        }, initial);
        const after = (await readLocal('user:a'))!;
        expect(after.data.history).toEqual(before.data.history);
        expect(after.pending).toEqual(before.pending);
        expect(after.revision).toBe(before.revision);
        expect(after.lastClosedWorkoutId).toBe(finished.id);
        expect(after.closedWorkoutIds).toEqual([finished.id]);
    });

    it('rejects a stale tab write after deletion across domain and snapshot writers', async () => {
        await prepareOwnerVault('user:a');
        const closed = { id: 'closed-tab-session', date: '2026-10-09', exercises: [] };
        const initial = UserDataSchema.parse({ activeWorkout: closed }) as unknown as UserData;
        await initializeLocal('user:a', initial);
        await commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: null, deletedWorkoutId: closed.id,
        }, initial);
        const afterDelete = (await readLocal('user:a'))!;
        await expect(commitDomainOperations('user:a', {
            type: 'active-workout.set', workout: closed,
        }, initial)).rejects.toThrow('già terminato o eliminato');
        await expect(commitLocal('user:a', initial, afterDelete.data))
            .rejects.toThrow('già terminato o eliminato');
        const durable = await readLocal('user:a');
        expect(durable?.data.activeWorkout).toBeNull();
        expect(durable?.revision).toBe(afterDelete.revision);
        expect(durable?.closedWorkoutIds).toContain(closed.id);
    });

    it('rejects malformed closure evidence without overwriting the owner envelope', async () => {
        await prepareOwnerVault('user:a');
        await initializeLocal('user:a', data(170));
        const key = 'logbook:v2:user:a';
        const valid = (await readLocal('user:a'))!;

        await updateArchiveRecord<any>('user:a', () => ({ ...valid, lastClosedWorkoutId: 42 }));
        const invalidMarker = await get<string>(key);
        expect(invalidMarker).toMatch(/^tlb-sealed:v1:/);
        await expect(readLocal('user:a')).rejects.toThrow('Identificativo workout chiuso non valido');
        expect(await get(key)).toBe(invalidMarker);

        await updateArchiveRecord<any>('user:a', () => ({
            ...valid, closedWorkoutIds: ['duplicate', 'duplicate'],
        }));
        const invalidLedger = await get<string>(key);
        await expect(readLocal('user:a')).rejects.toThrow('Registro workout chiusi non valido');
        expect(await get(key)).toBe(invalidLedger);
        expect((await getArchiveRecord<any>('user:a'))?.closedWorkoutIds).toEqual(['duplicate', 'duplicate']);
    });

    it('keeps envelope validation pure and fails closed for another owner', async () => {
        await prepareOwnerVault('user:a');
        await initializeLocal('user:a', data(170));
        const key = 'logbook:v2:user:a';
        const sealed = await get<string>(key);
        const stored = await getArchiveRecord<Record<string, unknown>>('user:a');
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(stored).toBeDefined();

        const validated = validateLocalEnvelope(stored, 'user:a');
        expect(validated).toEqual(await readLocal('user:a'));
        expect(() => validateLocalEnvelope({ ...stored, owner: 'user:b' }, 'user:a'))
            .toThrow('Archivio locale non riconosciuto');
        expect(await get(key)).toBe(sealed);
    });

    it.each([
        ['root fallback for null data', (record: any) => ({ ...record, data: null })],
        ['root fallback for primitive baseline', (record: any) => ({ ...record, baseline: 'corrupt' })],
        ['unknown root business field', (record: any) => ({ ...record, data: { ...record.data, futureRootValue: { protected: 17 } } })],
        ['nested Zod fallback', (record: any) => ({ ...record, data: { ...record.data, profile: { ...record.data.profile, height: { invalid: true } } } })],
        ['unknown baseline business field', (record: any) => ({ ...record, baseline: { ...record.baseline, futureRootValue: { protected: 18 } } })],
    ] as const)('rejects lossy local envelope normalization (%s) without changing encrypted bytes', async (_name, corrupt) => {
        await prepareOwnerVault('user:a');
        const initial = data(170);
        await initializeLocal('user:a', initial);
        const original = await readLocal('user:a');
        await updateArchiveRecord<unknown>('user:a', () => corrupt(original));
        const key = 'logbook:v2:user:a';
        const ciphertext = await get<string>(key);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);

        await expect(readLocal('user:a')).rejects.toThrow('non conservabili');
        await expect(commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '180' } }, initial))
            .rejects.toThrow('non conservabili');
        await expect(hydrateLocal('user:a', data(175), [], undefined, 'window'))
            .rejects.toThrow('non conservabili');
        expect(await get(key)).toBe(ciphertext);
    });

    it.each(['data', 'baseline'] as const)('rejects a lossy archived consent %s snapshot while retaining recovery bytes', async section => {
        await prepareOwnerVault('user:a');
        await initializeLocal('user:a', data(170));
        const original = (await readLocal('user:a'))!;
        const archive = {
            sourceConsentRevision: 1,
            capturedAt: '2026-11-03T00:00:00.000Z',
            data: structuredClone(original.data),
            baseline: structuredClone(original.baseline),
            pending: [],
        };
        const malformedSnapshot = { ...archive[section], unrecognizedRecoveryField: { count: 1 } };
        archive[section] = malformedSnapshot;
        await updateArchiveRecord<unknown>('user:a', () => ({
            ...original, archivedConsentJournals: [archive],
        }));
        const key = 'logbook:v2:user:a';
        const ciphertext = await get<string>(key);
        await expect(readLocal('user:a')).rejects.toThrow('non conservabili');
        await expect(commitLocal('user:a', data(171), original.data)).rejects.toThrow('non conservabili');
        expect(await get(key)).toBe(ciphertext);
    });

});
