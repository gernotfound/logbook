import 'fake-indexeddb/auto';
import { clear, del, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { UserDataSchema } from '../../src/lib/schema';
import { CURRENT_SYNC_PROTOCOL } from '../../src/lib/schemaEvolution';
import {
    acknowledgeThrough, adoptReplicaCheckpoint, commitLocal, hydrateLocal, initializeLocal, readLocal,
} from '../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../src/lib/sync/localRepository';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from '../../src/lib/sync/documentProjection';
import { applySemanticOperations } from '../../src/lib/sync/semanticProjection';
import type { SemanticOperation, SyncMeta } from '../../src/lib/sync/semanticProjection';
import type { ReplicaIdentity } from '../../src/lib/sync/replicaProtocol';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import type { CachedGlobalCatalog, UserData } from '../../src/types';

const owner = 'user:a';
const key = 'logbook:v2:' + owner;
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'ack-diagnostic', updatedAt: '2026-11-08T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const data = (height: number, nutrition: Record<string, { date: string; weight: number }> = {}) =>
    UserDataSchema.parse({ profile: { height: String(height) }, nutrition }) as unknown as UserData;

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    localStorage.setItem('logbook:v2:' + owner + ':health-consent-generation', '1');
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function initialize(base: UserData, months: string[] = []): Promise<ReplicaIdentity> {
    await initializeLocal(owner, base, months);
    const now = Date.now();
    const identity: ReplicaIdentity = {
        slot: 's00', replicaId: 'ack-local', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
    };
    await adoptReplicaCheckpoint(owner, { identity, baseSeq: 0 }, { clock: {}, syncMetaByDocument: {} });
    return identity;
}

async function snapshot(): Promise<LocalEnvelope> {
    const envelope = await readLocal(owner);
    if (!envelope) throw new Error('Missing diagnostic owner envelope');
    return envelope;
}

function delivery(envelope: LocalEnvelope) {
    if (!envelope.replica || !envelope.pending.length) throw new Error('Missing diagnostic delivery');
    return { operations: structuredClone(envelope.pending), replica: { ...envelope.replica } };
}
const lastSequence = (operations: SemanticOperation[]) => operations[operations.length - 1].seq;

function outcome(base: UserData, sent: ReturnType<typeof delivery>) {
    const projected = projectDocuments(base, catalog);
    const paths = [...new Set(sent.operations.map(operation => operation.docPath))];
    const touched = new Map<string, DocumentData>(paths.map(path => [path, projected.get(path) ?? {}]));
    const applied = applySemanticOperations(touched, sent.operations);
    const writer = {
        slot: sent.replica.slot, replicaId: sent.replica.replicaId,
        generation: sent.replica.generation, seq: lastSequence(sent.operations), consentRevision: 1,
    };
    const syncMeta: Record<string, SyncMeta> = {};
    for (const path of new Set(sent.operations.map(operation => operation.docPath))) {
        const meta = applied.syncMetas[path];
        if (!meta) throw new Error('Missing semantic delivery outcome');
        syncMeta[path] = { ...meta, writer };
    }
    return {
        documents: applied.documents, syncMeta,
        remote: applyRemoteDocuments(base, applied.documents, catalog),
    };
}

describe('diagnostic acknowledgement invariants with a real encrypted journal', () => {
    it('rejects an already-invalid guard before reading the catalog and preserves the exact journal', async () => {
        const base = data(170);
        await initialize(base);
        await commitLocal(owner, data(171), base);
        const before = await snapshot();
        const sent = delivery(before);
        const ciphertext = await get(key);
        catalogSource.read.mockClear();

        await expect(acknowledgeThrough(owner, lastSequence(sent.operations), data(171),
            [], undefined, sent, () => false)).rejects.toThrow('Acknowledgement invalidato dal cambio sessione');
        expect(catalogSource.read).not.toHaveBeenCalled();
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('rejects a guard invalidated by the catalog wait without replacing ciphertext', async () => {
        const base = data(170);
        await initialize(base);
        await commitLocal(owner, data(171), base);
        const before = await snapshot();
        const sent = delivery(before);
        const ciphertext = await get(key);
        let current = true;
        catalogSource.read.mockImplementationOnce(async () => {
            current = false;
            return catalog;
        });

        await expect(acknowledgeThrough(owner, lastSequence(sent.operations), data(171),
            [], undefined, sent, () => current)).rejects.toThrow('Acknowledgement invalidato dal cambio sessione');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('does not recreate an owner envelope lost after delivery while its vault is retained', async () => {
        const base = data(170);
        await initialize(base);
        await commitLocal(owner, data(171), base);
        const sent = delivery(await snapshot());
        await del(key);

        await expect(acknowledgeThrough(owner, lastSequence(sent.operations), data(171),
            [], undefined, sent)).rejects.toThrow('Archivio locale non trovato');
        expect(await get(key)).toBeUndefined();
        expect(await readLocal(owner)).toBeUndefined();
    });

    it.each([
        { label: 'null', value: null },
        { label: 'boolean', value: false },
        { label: 'number', value: 0 },
        { label: 'string', value: '' },
        { label: 'array', value: [] },
    ])('rejects malformed transport $label before Zod can default the root', async ({ value }) => {
        const base = data(170);
        await initialize(base);
        await commitLocal(owner, data(171), base);
        const before = await snapshot();
        const sent = delivery(before);
        const ciphertext = await get(key);

        // These deliberately invalid JSON containers exercise the runtime transport
        // guard; they are not valid UserData fixtures for the normal ACK path.
        await expect(acknowledgeThrough(owner, lastSequence(sent.operations), value as unknown as UserData,
            [], undefined, sent)).rejects.toThrow('Snapshot cloud non valido');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it.each([
        { label: 'replica identifier', replicaId: 'ack-replaced', generation: 1 },
        { label: 'generation', replicaId: 'ack-local', generation: 2 },
    ])('checks the $label even when a checkpoint leaves the same pending payload', async replacement => {
        const base = data(170);
        await initialize(base);
        await commitLocal(owner, data(171), base);
        const sent = delivery(await snapshot());

        await adoptReplicaCheckpoint(owner, {
            identity: { ...sent.replica, replicaId: replacement.replicaId, generation: replacement.generation },
            baseSeq: 0,
        }, { clock: {}, syncMetaByDocument: {} });
        const before = await snapshot();
        const ciphertext = await get(key);
        // Payload equality alone does not attest the replica tuple held by the ACK.
        expect(before.pending).toEqual(sent.operations);

        await expect(acknowledgeThrough(owner, lastSequence(sent.operations), data(171),
            [], undefined, sent)).rejects.toThrow('Acknowledgement invalidato: replica o batch locale cambiati');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('rejects a boundary beyond the last delivered sequence even if the prefix payload matches', async () => {
        const base = data(170);
        await initialize(base);
        await commitLocal(owner, data(171), base);
        const before = await snapshot();
        const sent = delivery(before);
        const ciphertext = await get(key);

        await expect(acknowledgeThrough(owner, lastSequence(sent.operations) + 1, data(171),
            [], undefined, sent)).rejects.toThrow('Acknowledgement invalidato: replica o batch locale cambiati');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('rejects an empty attested delivery without rewriting a clean archive', async () => {
        const base = data(170);
        const replica = await initialize(base);
        const before = await snapshot();
        const ciphertext = await get(key);

        await expect(acknowledgeThrough(owner, 0, base, [], undefined, { operations: [], replica }))
            .rejects.toThrow('Acknowledgement invalidato: replica o batch locale cambiati');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('rejects the whole attested ACK when only one delivered document has a newer durable frontier', async () => {
        const base = data(170);
        const first = data(171, { '2026-09-01': { date: '2026-09-01', weight: 71 } });
        await initialize(base);
        await commitLocal(owner, first, base);
        const sent = delivery(await snapshot());
        const confirmed = outcome(base, sent);
        const concurrent: SemanticOperation = {
            docPath: '', path: ['profile', 'height'], isDelete: false, value: '199',
            actorId: 's01', seq: 1, clock: { s00: 1, s01: 1 },
        };
        const advanced = applySemanticOperations(confirmed.documents, [concurrent], confirmed.syncMeta);
        const root = advanced.documents.get('');
        const meta = advanced.syncMetas[''];
        if (!root || !meta) throw new Error('Missing concurrent root outcome');
        const rootMeta: SyncMeta = {
            ...meta, writer: { slot: 's01', replicaId: 'other-replica', generation: 1, seq: 1, consentRevision: 1 },
        };
        const rootOnly = new Map([['', { ...root, _sync: rootMeta }]]);
        const remote = applyRemoteDocuments(base, new Map([['', root]]), catalog);
        await hydrateLocal(owner, remote, [], rootOnly, 'window');
        const before = await snapshot();
        const ciphertext = await get(key);
        expect(before.pending).toEqual(sent.operations);
        expect(before.syncMetaByDocument[''].clock).toEqual({ s00: 1, s01: 1 });
        expect(before.syncMetaByDocument['nutrition_months/2026-09']).toBeUndefined();

        await expect(acknowledgeThrough(owner, lastSequence(sent.operations), confirmed.remote,
            ['2026-09'], confirmed.syncMeta, sent)).rejects.toThrow('Acknowledgement obsoleto rispetto al frontier locale');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('retains the newer pending causal dot and advances revision when a partial ACK leaves business unchanged', async () => {
        const base = data(170);
        const first = data(171);
        await initialize(base);
        await commitLocal(owner, first, base);
        const sent = delivery(await snapshot());
        const confirmed = outcome(base, sent);
        await commitLocal(owner, data(172), first);
        const before = await snapshot();

        await acknowledgeThrough(owner, lastSequence(sent.operations), confirmed.remote,
            [], confirmed.syncMeta, sent);
        const after = await snapshot();
        expect(after.data).toEqual(before.data);
        expect(after.baseline.profile?.height).toBe('171');
        expect(after.pending).toEqual(before.pending.filter(operation => operation.seq > lastSequence(sent.operations)));
        expect(after.pending).toHaveLength(1);
        expect(after.actorSeq).toBe(2);
        expect(after.clock).toEqual({ s00: 2 });
        expect(after.syncMetaByDocument[''].clock).toEqual({ s00: 1 });
        expect(after.syncMetaByDocument[''].protocolVersion).toBe(CURRENT_SYNC_PROTOCOL);
        expect(after.revision).toBe(before.revision + 1);
    });

    it('keeps the union of previously complete and delivered months without duplicates', async () => {
        const base = data(170, { '2026-08-01': { date: '2026-08-01', weight: 70 } });
        const first = data(171, {
            '2026-08-01': { date: '2026-08-01', weight: 72 },
            '2026-09-01': { date: '2026-09-01', weight: 71 },
        });
        await initialize(base, ['2026-07', '2026-08']);
        await commitLocal(owner, first, base);
        const sent = delivery(await snapshot());
        const confirmed = outcome(base, sent);
        expect(new Set(sent.operations.map(operation => operation.docPath))).toEqual(
            new Set(['', 'nutrition_months/2026-08', 'nutrition_months/2026-09']),
        );

        await acknowledgeThrough(owner, lastSequence(sent.operations), confirmed.remote,
            ['2026-08', '2026-09'], confirmed.syncMeta, sent);
        const after = await snapshot();
        expect(after.completeMonths).toEqual(['2026-07', '2026-08', '2026-09']);
        expect(after.pending).toEqual([]);
        expect(after.data.nutrition?.['2026-08-01']?.weight).toBe(72);
        expect(after.data.nutrition?.['2026-09-01']?.weight).toBe(71);
    });

    it('clears an empty delivered month while preserving a concurrently hydrated different month', async () => {
        const base = data(170, {
            '2026-09-01': { date: '2026-09-01', weight: 71 },
            '2026-10-01': { date: '2026-10-01', weight: 81 },
        });
        const first = data(170, { '2026-10-01': { date: '2026-10-01', weight: 81 } });
        await initialize(base, ['2026-09', '2026-10']);
        await commitLocal(owner, first, base);
        const sent = delivery(await snapshot());
        const confirmed = outcome(base, sent);
        expect(sent.operations.every(operation => operation.docPath === 'nutrition_months/2026-09')).toBe(true);
        expect(confirmed.remote.nutrition?.['2026-09-01']).toBeUndefined();

        const concurrent = data(170, { '2026-10-01': { date: '2026-10-01', weight: 82 } });
        await hydrateLocal(owner, concurrent, ['2026-10'], undefined, 'window');
        await acknowledgeThrough(owner, lastSequence(sent.operations), confirmed.remote,
            ['2026-09'], confirmed.syncMeta, sent);
        const after = await snapshot();
        expect(after.data.nutrition?.['2026-09-01']).toBeUndefined();
        expect(after.baseline.nutrition?.['2026-09-01']).toBeUndefined();
        expect(after.data.nutrition?.['2026-10-01']?.weight).toBe(82);
        expect(after.baseline.nutrition?.['2026-10-01']?.weight).toBe(82);
        expect(after.pending).toEqual([]);
    });
});
