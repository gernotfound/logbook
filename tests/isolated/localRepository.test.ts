import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackError: vi.fn() } }));
import { UserDataSchema } from '../../src/lib/schema';
import { validateLocalEnvelope } from '../../src/lib/sync/localEnvelopeValidation';
import { fenceCloudIntegrity } from '../../src/lib/sync/localCloudIntegrity';
import type { UserData } from '../../src/types';
import { adoptReplicaCheckpoint, markReplicaCheckpointRequired, markCloudIntegrityBlocked, completeCloudIntegrityRecovery, hydrateLocal, commitLocal, commitDomainOperations, initializeLocal, readLocal, acknowledgeThrough, advanceLocalConsentRevisionIfClean, StaleLocalRevisionError } from '../../src/lib/sync/localRepository';
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

    it('commits closure evidence even for a no-op cloud clear, and keeps it through hydration', async () => {
        const initial = UserDataSchema.parse({ activeWorkout: null }) as unknown as UserData;
        await initializeLocal('user:a', initial);
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
        await acknowledgeThrough('user:a', after!.actorSeq, initial);
        expect((await readLocal('user:a'))?.lastClosedWorkoutId).toBe('retired-only-local');
        expect((await readLocal('user:a'))?.closedWorkoutIds).toEqual(['retired-only-local']);
    });


    it('preserves multiple deletion tombstones, including metadata-only commits', async () => {
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


    it('retains a pre-ledger V5 closure when a later deletion replaces its legacy marker', async () => {
        const initial = UserDataSchema.parse({ activeWorkout: null }) as unknown as UserData;
        await initializeLocal('user:a', initial);
        const key = 'logbook:v2:user:a';
        const legacy = await get(key) as Record<string, unknown>;
        // A real previous release recorded only lastClosedWorkoutId.
        await set(key, { ...legacy, lastClosedWorkoutId: 'previously-deleted', closedWorkoutIds: undefined });

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
        await initializeLocal('user:a', data(170));
        const key = 'logbook:v2:user:a';
        const raw = await get(key) as Record<string, unknown>;
        await set(key, { ...raw, lastClosedWorkoutId: 42 });
        await expect(readLocal('user:a')).rejects.toThrow('Identificativo workout chiuso non valido');
        expect((await get(key) as Record<string, unknown>).lastClosedWorkoutId).toBe(42);
        await set(key, { ...raw, closedWorkoutIds: ['duplicate', 'duplicate'] });
        await expect(readLocal('user:a')).rejects.toThrow('Registro workout chiusi non valido');
        expect((await get(key) as Record<string, unknown>).closedWorkoutIds).toEqual(['duplicate', 'duplicate']);
    });

    it('keeps envelope validation pure and fails closed for another owner', async () => {
        await initializeLocal('user:a', data(170));
        const key = 'logbook:v2:user:a';
        const stored = await get<Record<string, unknown>>(key);
        expect(stored).toBeDefined();

        const validated = validateLocalEnvelope(stored, 'user:a');
        expect(validated).toEqual(await readLocal('user:a'));
        expect(() => validateLocalEnvelope({ ...stored, owner: 'user:b' }, 'user:a'))
            .toThrow('Archivio locale non riconosciuto');
        expect(await get(key)).toEqual(stored);
    });

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
        expect(await readLocal('guest')).toBeUndefined();
        await initializeLocal('guest', initial);
        await commitLocal('guest', data(180), initial);
        const durable = await readLocal('guest');
        expect(durable?.pending).toEqual([]); // Guest operations have no cloud journal.
        await initializeLocal('guest', data(160));
        expect((await readLocal('guest'))?.data.profile?.height).toBe('180');
        expect((await readLocal('guest'))?.revision).toBe(durable?.revision);
    });

    it('keeps an existing pending journal and owner metadata unchanged during competing bootstrap', async () => {
        const initial = data(170);
        await initializeLocal('user:a', initial, ['2026-09']);
        await commitLocal('user:a', data(171), initial);
        const durable = await readLocal('user:a');
        expect(durable?.pending.length).toBeGreaterThan(0);

        await initializeLocal('user:a', data(199), ['2026-10']);
        expect(await readLocal('user:a')).toEqual(durable);
    });

    it('rejects a stale bootstrap guard even when the owner envelope already exists', async () => {
        await initializeLocal('user:a', data(170));
        const before = await readLocal('user:a');
        let checks = 0;

        await expect(initializeLocal('user:a', data(190), undefined, () => {
            checks++;
            return false;
        })).rejects.toThrow('Inizializzazione locale invalidata dal cambio sessione');
        expect(checks).toBe(1);
        expect(await readLocal('user:a')).toEqual(before);
    });

    it('preserves an already-acknowledged authenticated envelope during bootstrap', async () => {
        await initializeLocal('user:a', data(170));
        await initializeLocal('user:a', data(190));
        expect((await readLocal('user:a'))?.data.profile?.height).toBe('170');
    });

    it('rejects a stale initialization after logout rather than recreating its envelope', async () => {
        await initializeLocal('guest', data(170), undefined, () => true);
        await clear();
        await expect(initializeLocal('guest', data(190), undefined, () => false))
            .rejects.toThrow('invalidata');
        expect(await readLocal('guest')).toBeUndefined();
    });

    it('rejects a stale snapshot commit after deletion without recreating the envelope', async () => {
        await initializeLocal('user:a', data(170));
        await clear();
        await expect(commitLocal('user:a', data(180), data(170), () => false))
            .rejects.toThrow('Commit locale invalidato dal cambio sessione');
        expect(await readLocal('user:a')).toBeUndefined();
    });

    it('rejects a stale snapshot commit atomically without changing an existing pending journal', async () => {
        const original = data(170);
        await initializeLocal('user:a', original);
        await commitLocal('user:a', data(171), original);
        const before = await readLocal('user:a');
        let guardCalls = 0;

        await expect(commitLocal('user:a', data(172), data(171), () => {
            guardCalls++;
            return false;
        })).rejects.toThrow('Commit locale invalidato dal cambio sessione');

        expect(guardCalls).toBe(1);
        expect(await readLocal('user:a')).toEqual(before);
    });

    it.each([null, false, 0, ''])(
        'rejects a stored invalid archive (%j) instead of treating it as absent',
        async stored => {
            const key = 'logbook:v2:user:a';
            await set(key, stored);

            await expect(readLocal('a')).rejects.toThrow('Archivio locale non valido');
            await expect(initializeLocal('a', data(170))).rejects.toThrow('Archivio locale non valido');
            await expect(commitLocal('a', data(180), data(170))).rejects.toThrow('Archivio locale non valido');

            // Failed reads and updates must not silently replace the original record.
            expect(await get(key)).toEqual(stored);
        },
    );

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

    it('builds a cloud-integrity fence without mutating the source envelope or its journal', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        await commitLocal('a', data(171), base);
        const original = (await readLocal('a'))!;
        const snapshot = structuredClone(original);
        const fenced = fenceCloudIntegrity(original);

        expect(fenced).not.toBe(original);
        expect(fenced.cloudIntegrityFence).toEqual(expect.any(String));
        expect(fenced.revision).toBe(original.revision + 1);
        expect(fenced.data).toEqual(original.data);
        expect(fenced.pending).toEqual(original.pending);
        expect(original).toEqual(snapshot);
        expect(await readLocal('a')).toEqual(snapshot);
    });

    it('preserves a pending journal and rejects stale session during consent revision adoption', async () => {
        const original = data(170);
        await initializeLocal('a', original);
        await commitLocal('a', data(171), original);
        const before = (await readLocal('a'))!;

        expect(await advanceLocalConsentRevisionIfClean('a', 2)).toBe(false);
        expect(await readLocal('a')).toEqual(before);

        await expect(advanceLocalConsentRevisionIfClean('a', 2, () => false))
            .rejects.toThrow('Sessione cambiata');
        expect(await readLocal('a')).toEqual(before);
    });

    it('adopts a consent revision exactly once when the journal is clean', async () => {
        await initializeLocal('a', data(170));
        const before = (await readLocal('a'))!;

        expect(await advanceLocalConsentRevisionIfClean('a', 2)).toBe(true);
        const after = (await readLocal('a'))!;
        expect(after.consentRevision).toBe(2);
        expect(after.revision).toBe(before.revision + 1);
        expect(after.data).toEqual(before.data);
        expect(after.pending).toEqual([]);
        expect(await advanceLocalConsentRevisionIfClean('a', 2)).toBe(true);
        expect(await readLocal('a')).toEqual(after);
    });

    it('persists cloud-integrity fencing until a verified full checkpoint, retaining pending edits', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        await commitLocal('a', data(171), base);
        await markCloudIntegrityBlocked('a');
        const fenced = (await readLocal('a'))!;
        expect(fenced.cloudIntegrityFence).toEqual(expect.any(String));
        expect(fenced.pending.length).toBeGreaterThan(0);
        await expect(completeCloudIntegrityRecovery('a', fenced.cloudIntegrityFence!, false))
            .rejects.toMatchObject({ code: 'replica-fenced' });
        const identity = { slot: 's00', replicaId: 'recovery', generation: 1,
            checkpointAtMs: Date.now(), leaseUntilMs: Date.now() + 360 * 24 * 60 * 60 * 1000 };
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 }, { clock: {}, syncMetaByDocument: {} });
        await markCloudIntegrityBlocked('a');
        await expect(completeCloudIntegrityRecovery('a', fenced.cloudIntegrityFence!, true))
            .rejects.toMatchObject({ code: 'replica-fenced' });
        const latest = (await readLocal('a'))!;
        await adoptReplicaCheckpoint('a', { identity, baseSeq: 0 }, { clock: {}, syncMetaByDocument: {} });
        const recovered = await completeCloudIntegrityRecovery('a', latest.cloudIntegrityFence!, true);
        expect(recovered.cloudIntegrityFence).toBeUndefined();
        expect(recovered.pending.length).toBeGreaterThan(0);
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

    it('rejects malformed cloud containers without changing business data or the pending journal', async () => {
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
        for (const malformed of [null, false, []]) {
            await expect(hydrateLocal('missing', malformed as unknown as UserData, [], undefined, 'all'))
                .rejects.toThrow('Snapshot cloud non valido');
            expect(await get('logbook:v2:user:missing')).toBeUndefined();
        }
    });

    it('never certifies empty window months as cloud documents', async () => {
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
        const base = data(170);
        const desired = UserDataSchema.parse({
            ...base,
            nutrition: { '2026-10-01': { date: '2026-10-01', weight: 80 } },
        }) as unknown as UserData;
        await initializeLocal('a', base);
        await commitLocal('a', desired, base);
        const pendingBefore = (await readLocal('a'))!.pending;
        expect(pendingBefore.some(op => op.docPath === 'nutrition_months/2026-10')).toBe(true);
        await acknowledgeThrough('a', 0, base, [], {
            '': { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        });
        const after = (await readLocal('a'))!;
        expect(after.pending).toEqual(pendingBefore);
        expect(after.data.nutrition?.['2026-10-01']?.weight).toBe(80);
        expect(after.syncMetaByDocument['nutrition_months/2026-10']).toBeUndefined();
    });

    it('fences a missing server-confirmed document even with empty writerless metadata', async () => {
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
        const business = UserDataSchema.parse({
            nutrition: { '2026-08-01': { date: '2026-08-01', weight: 75 } },
        }) as unknown as UserData;
        await initializeLocal('a', business);
        const key = 'logbook:v2:user:a';
        const raw = await get(key) as Record<string, any>;
        await set(key, { ...raw, syncMetaByDocument: {
            'nutrition_months/2026-08': { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        } });
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
        const local = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 70 },
            '2026-09-01': { date: '2026-09-01', weight: 80 },
        } }) as unknown as UserData;
        await initializeLocal('a', local, ['2025-01', '2026-09']);
        const knownMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 1 }, fields: {} };
        await acknowledgeThrough('a', 0, local, [], { 'nutrition_months/2025-01': knownMeta });
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
        const local = data(171);
        await initializeLocal('a', local);
        const knownMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 1 }, fields: {} };
        await acknowledgeThrough('a', 0, local, [], { '': knownMeta });
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
        const local = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 70 },
            '2026-09-01': { date: '2026-09-01', weight: 80 },
        } }) as unknown as UserData;
        await initializeLocal('a', local, ['2025-01', '2026-09']);
        const knownMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 1 }, fields: {} };
        await acknowledgeThrough('a', 0, local, [], { 'nutrition_months/2025-01': knownMeta });
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

    it('refuses to acknowledge a same-sequence batch whose durable payload changed', async () => {
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
        const raw = await get(key) as Record<string, any>;
        const corrupted = { ...raw, pending: raw.pending.map((op: any) => ({ ...op, value: 'unexpected-payload' })) };
        await set(key, corrupted);

        await expect(acknowledgeThrough('a', before.pending.at(-1)!.seq, data(171), [], undefined,
            { operations: before.pending, replica: identity })).rejects.toThrow('Acknowledgement invalidato');
        expect(await get(key)).toEqual(corrupted);
        expect((await readLocal('a'))?.pending).toEqual(corrupted.pending);
    });

    it('refuses to retire a new replica journal using the old replica acknowledgement', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        const now = Date.now();
        const first = { slot: 's00', replicaId: 'ack-old-replica', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 };
        await adoptReplicaCheckpoint('a', { identity: first, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        await commitLocal('a', data(171), base);
        const delivered = (await readLocal('a'))!;
        const second = { ...first, slot: 's01', replicaId: 'ack-new-replica' };
        await adoptReplicaCheckpoint('a', { identity: second, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} });
        const before = (await readLocal('a'))!;
        expect(before.actorId).toBe('s01');
        expect(before.pending.every(op => op.actorId === 's01')).toBe(true);

        await expect(acknowledgeThrough('a', delivered.pending.at(-1)!.seq, data(171), [], undefined,
            { operations: delivered.pending, replica: first })).rejects.toThrow('Acknowledgement invalidato');
        expect(await readLocal('a')).toEqual(before);
    });

    it('keeps a newly hydrated month and its baseline when an older root-only delivery is acknowledged', async () => {
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
        expect(stored?.data.profile?.height).toBe('172');
        expect(stored?.baseline.profile?.height).toBe('172');
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
        const local = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 70 },
        } }) as unknown as UserData;
        await initializeLocal('a', local, ['2025-01']);
        const durableMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 3 }, fields: {} };
        await acknowledgeThrough('a', 0, local, [], { 'nutrition_months/2025-01': durableMeta });
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
        const local = data(170);
        await initializeLocal('a', local);
        await acknowledgeThrough('a', 0, local, [], { '': {
            protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 3 }, fields: {},
        } });
        const fresh = data(175);
        const documents = new Map<string, any>([['', {
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 3, s02: 4 }, fields: {} },
        }]]);
        const result = await hydrateLocal('a', fresh, [], documents, 'window');

        expect(result.data.profile?.height).toBe('175');
        expect(result.syncMetaByDocument[''].clock).toEqual({ s01: 3, s02: 4 });
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

    it('keeps business state and journal atomic when a monthly deletion write is rejected', async () => {
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
        expect((await readLocal('a'))?.data.profile?.height).toBe('171');
        expect((await readLocal('b'))?.data.profile?.height).toBe('180');
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
        expect(hydrated?.data.profile?.height).toBe('180');

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

        expect(stored?.data.profile?.height).toBe('171');
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

        expect(stored?.data.profile?.height).toBe('171');
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
