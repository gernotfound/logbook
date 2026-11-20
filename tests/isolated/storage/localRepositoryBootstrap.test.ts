import 'fake-indexeddb/auto';
import { del, get, set } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { getArchiveRecord, updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { LocalCiphertextError } from '../../../src/lib/sync/secureArchiveCipher';
import {
    adoptReplicaCheckpoint, commitLocal, commitDomainOperations,
    initializeLocal, readLocal, advanceLocalConsentRevisionIfClean,
} from '../../../src/lib/sync/localRepository';
import {
    CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL,
    FutureVersionError, LegacyVersionError,
} from '../../../src/lib/schemaEvolution';
import { installLocalRepositoryFixture, data, prepareOwnerVault, prepareGuestVault } from './localRepositoryFixture';

describe('durable owner-scoped journal: bootstrap and version fences', () => {
    installLocalRepositoryFixture();

    it('allows reversible local scalar normalization without blocking subsequent journal writes', async () => {
        await prepareOwnerVault('user:a');
        const initial = data(170);
        await initializeLocal('user:a', initial);
        const record = (await readLocal('user:a'))!;
        await updateArchiveRecord<unknown>('user:a', () => ({
            ...record,
            data: { ...record.data, profile: { ...record.data.profile, height: 170 } },
            baseline: { ...record.baseline, profile: { ...record.baseline.profile, height: 170 } },
        }));
        const normalized = (await readLocal('user:a'))!;
        expect(normalized.data.profile?.height).toBe('170');
        expect(normalized.baseline.profile?.height).toBe('170');
        await commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '171' } }, normalized.data);
        const changed = (await readLocal('user:a'))!;
        expect(changed.data.profile?.height).toBe('171');
        expect(changed.pending.length).toBeGreaterThan(0);
    });

    it('writes independent current envelope/data/sync versions', async () => {
        await prepareOwnerVault('user:a');
        await initializeLocal('a', data(170));
        expect(await readLocal('a')).toMatchObject({
            version: CURRENT_LOCAL_ENVELOPE,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            owner: 'user:a',
        });
    });

    it('does not overwrite a guest envelope that appeared after a stale bootstrap read', async () => {
        await prepareGuestVault();
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
        await prepareOwnerVault('user:a');
        const initial = data(170);
        await initializeLocal('user:a', initial, ['2026-09']);
        await commitLocal('user:a', data(171), initial);
        const durable = await readLocal('user:a');
        expect(durable?.pending.length).toBeGreaterThan(0);

        await initializeLocal('user:a', data(199), ['2026-10']);
        expect(await readLocal('user:a')).toEqual(durable);
    });

    it('rejects a stale bootstrap guard even when the owner envelope already exists', async () => {
        await prepareOwnerVault('user:a');
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
        await prepareOwnerVault('user:a');
        await initializeLocal('user:a', data(170));
        await initializeLocal('user:a', data(190));
        expect((await readLocal('user:a'))?.data.profile?.height).toBe('170');
    });

    it('rejects a stale initialization after logout rather than recreating its envelope', async () => {
        await prepareGuestVault();
        await initializeLocal('guest', data(170), undefined, () => true);
        await del('logbook:v2:guest');
        await expect(initializeLocal('guest', data(190), undefined, () => false))
            .rejects.toThrow('invalidata');
        expect(await readLocal('guest')).toBeUndefined();
    });

    it('rejects a stale snapshot commit after deletion without recreating the envelope', async () => {
        await prepareOwnerVault('user:a');
        await initializeLocal('user:a', data(170));
        await del('logbook:v2:user:a');
        await expect(commitLocal('user:a', data(180), data(170), () => false))
            .rejects.toThrow('Commit locale invalidato dal cambio sessione');
        expect(await readLocal('user:a')).toBeUndefined();
    });

    it('rejects a stale snapshot commit atomically without changing an existing pending journal', async () => {
        await prepareOwnerVault('user:a');
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
        'rejects an unsealed invalid archive (%j) without replacing its bytes',
        async stored => {
            await prepareOwnerVault('user:a');
            const key = 'logbook:v2:user:a';
            await set(key, stored);

            await expect(readLocal('a')).rejects.toBeInstanceOf(LocalCiphertextError);
            await expect(initializeLocal('a', data(170))).rejects.toBeInstanceOf(LocalCiphertextError);
            await expect(commitLocal('a', data(180), data(170))).rejects.toBeInstanceOf(LocalCiphertextError);

            // An active vault must never silently adopt or overwrite unsealed bytes.
            expect(await get(key)).toEqual(stored);
        },
    );

    it('rejects pre-M1 and future local envelopes without rewriting their bytes', async () => {
        await prepareOwnerVault('user:a');
        const key = 'logbook:v2:user:a';
        await updateArchiveRecord<any>('user:a', () => ({ owner: 'user:a', version: 3 }));
        const legacyCiphertext = await get<string>(key);
        await expect(readLocal('a')).rejects.toThrow(LegacyVersionError);
        expect(await get(key)).toBe(legacyCiphertext);

        await updateArchiveRecord<any>('user:a', () => ({
            owner: 'user:a', version: CURRENT_LOCAL_ENVELOPE + 1,
        }));
        const futureCiphertext = await get<string>(key);
        await expect(readLocal('a')).rejects.toThrow(FutureVersionError);
        expect(await get(key)).toBe(futureCiphertext);
    });

    it('rejects a pre-launch protocol local envelope without rewriting its bytes', async () => {
        await prepareOwnerVault('user:a');
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
        await updateArchiveRecord<any>('user:a', () => legacy);
        const sealed = await get<string>('logbook:v2:user:a');
        await expect(readLocal('a')).rejects.toThrow(LegacyVersionError);
        expect(await get('logbook:v2:user:a')).toBe(sealed);
    });


    it('rejects non-business sync metadata paths without overwriting encrypted evidence', async () => {
        await prepareOwnerVault('user:a');
        await initializeLocal('a', data(170));
        const clean = await readLocal('a');
        const invalidMetadata = JSON.parse('{"__proto__":{"clock":{},"fields":{}}}');
        await updateArchiveRecord<any>('user:a', () => ({
            ...clean, syncMetaByDocument: invalidMetadata,
        }));
        const key = 'logbook:v2:user:a';
        const original = await get<string>(key);

        await expect(readLocal('a')).rejects.toThrow('Percorso metadati sync locale non valido');
        expect(await get<string>(key)).toBe(original);
    });

    it('preserves a pending journal and rejects stale session during consent revision adoption', async () => {
        await prepareOwnerVault('user:a');
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
        await prepareOwnerVault('user:a');
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


    it('keeps pending sequence numbers when renewing the same replica', async () => {
        await prepareOwnerVault('user:a');
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
        await prepareOwnerVault('user:a');
        await commitLocal('a', data(171), data(170));
        await updateArchiveRecord<any>('user:a', raw => ({
            ...raw,
            pending: raw.pending.map((op: any, index: number) => index === 0 ? { ...op, clock: {} } : op),
        }));
        const sealed = await get<string>('logbook:v2:user:a');
        await expect(readLocal('a')).rejects.toThrow();
        expect(await get('logbook:v2:user:a')).toBe(sealed);
        expect((await getArchiveRecord<any>('user:a'))?.pending[0].clock).toEqual({});
    });

    it('rejects local sync metadata whose document frontier does not cover a FieldStamp', async () => {
        await prepareOwnerVault('user:a');
        const payload = data(170);
        await updateArchiveRecord<any>('user:a', () => ({
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
        }));
        const sealed = await get<string>('logbook:v2:user:a');
        await expect(readLocal('a')).rejects.toThrow();
        expect(await get('logbook:v2:user:a')).toBe(sealed);
    });

});
