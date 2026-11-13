import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { UserData, CachedGlobalCatalog } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { adoptReplicaCheckpoint, acknowledgeThrough, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { stageCloudflareDelivery, resumeCloudflareDelivery } from '../../../src/lib/sync/cloudReplicaDurableDelivery';
import { applySemanticOperations, parseSyncMeta } from '../../../src/lib/sync/semanticProjection';
import { compactSyncMetas } from '../../../src/lib/sync/causalCompaction';
import type { CloudReplicaBatch, CloudReplicaControlSnapshot, CloudReplicaSnapshot } from '../../../src/lib/sync/cloudReplicaTransport';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';

const uid = 'a';
const owner = 'user:' + uid;
const storeKey = 'logbook:v2:' + owner;
const adk = new Uint8Array(32).fill(11);
const catalog: CachedGlobalCatalog = {
    manifest: { version: 'cf04-journal-fixture', updatedAt: '2026-11-13T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/exercises', foods: 'fixture/foods' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};
const profile = (height: number) =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, task: () => Promise<unknown>) => task(),
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

async function seed() {
    const initial = profile(170);
    await initializeLocal(owner, initial);
    const now = Date.now();
    const replica = {
        slot: 's00', replicaId: 'cf04-durable-device', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 86400000,
    };
    await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 },
        { clock: {}, syncMetaByDocument: {} });
    await commitLocal(owner, profile(171), initial);
    const envelope = await readLocal(owner);
    if (!envelope || !envelope.pending.length) throw new Error('Local test journal absent');
    const snapshot: CloudReplicaSnapshot = {
        revision: 0, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision: null, document: null }],
    };
    const control: CloudReplicaControlSnapshot = {
        revision: 0, fenceEpoch: 5, consentRevision: 1,
        replicas: { s00: {
            ...replica, lastSeq: 0, status: 'active', checkpointClock: {},
        } },
    };
    return { initial, replica, snapshot, control, envelope };
}
async function stage() {
    const initial = await seed();
    // Temporary diagnostic: identify the precise production Protocol 3
    // invariant violated by a real local journal on the first cloud write.
    const applied = applySemanticOperations(new Map([['', {}]]), initial.envelope.pending);
    const meta = applied.syncMetas[''];
    try {
        parseSyncMeta({ ...meta, writer: {
            slot: initial.replica.slot, replicaId: initial.replica.replicaId,
            generation: initial.replica.generation, seq: initial.envelope.pending.at(-1)!.seq,
            consentRevision: 1,
        } });
    } catch (error) {
        throw new Error('DIAGNOSTIC real pending='
            + JSON.stringify(initial.envelope.pending)
            + ' syncMeta=' + JSON.stringify(meta)
            + ' parse=' + String(error));
    }
    const allPaths = [...new Set(initial.envelope.pending.map(op => op.docPath))];
    const perDocument = applySemanticOperations(new Map(allPaths.map(path => [path, {}])), initial.envelope.pending);
    const compactedByPath = compactSyncMetas(perDocument.syncMetas, {});
    const compacted = compactedByPath[''];
    try {
        parseSyncMeta({ ...compacted, writer: {
            slot: initial.replica.slot, replicaId: initial.replica.replicaId,
            generation: initial.replica.generation, seq: initial.envelope.pending.at(-1)!.seq,
            consentRevision: 1,
        } });
    } catch (error) {
        throw new Error('DIAGNOSTIC compact metadata failure: '
            + String(error) + ' before=' + JSON.stringify(meta)
            + ' after=' + JSON.stringify(compacted));
    }
    for (const path of allPaths) {
        const metaAtPath = compactedByPath[path];
        try {
            parseSyncMeta({ ...metaAtPath, writer: {
                slot: initial.replica.slot, replicaId: initial.replica.replicaId,
                generation: initial.replica.generation, seq: initial.envelope.pending.at(-1)!.seq,
                consentRevision: 1,
            } });
        } catch (error) {
            throw new Error('DIAGNOSTIC path=' + path + ' parse=' + String(error)
                + ' pending=' + JSON.stringify(initial.envelope.pending)
                + ' compacted=' + JSON.stringify(metaAtPath));
        }
    }
    await stageCloudflareDelivery(owner, initial.envelope.pending, initial.snapshot,
        initial.control, initial.replica, 'batch000000000191', adk, () => true);
    return initial;
}
function deliveryTransport() {
    let committed: CloudReplicaBatch | null = null;
    return {
        commit: vi.fn(async (batch: CloudReplicaBatch, csrf: string) => {
            expect(csrf).toBe('csrf-session');
            committed = structuredClone(batch);
            return { revision: batch.expectedRevision + 1, lastSeq: batch.lastSeq, replayed: false };
        }),
        receipt: vi.fn(async (batch: CloudReplicaBatch) => {
            if (!committed) return null;
            expect(batch).toEqual(committed);
            return { revision: batch.expectedRevision + 1, lastSeq: batch.lastSeq };
        }),
    };
}

describe('candidate D1 delivery: encrypted IndexedDB intent and exact ACK', () => {
    it('stores immutable AEAD bytes before network and clears them in the same journal ACK', async () => {
        await stage();
        const sealed = await get<unknown>(storeKey);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(JSON.stringify(sealed)).not.toContain('171');
        const persisted = (await readLocal(owner))!;
        const beforeBytes = JSON.stringify(persisted.cloudflareDelivery?.batch);
        expect(persisted.cloudflareDelivery?.operations).toEqual(persisted.pending);

        const transport = deliveryTransport();
        expect(await resumeCloudflareDelivery(owner, adk, transport, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(transport.commit).toHaveBeenCalledOnce();
        expect(transport.receipt).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(transport.commit.mock.calls[0][0])).toBe(beforeBytes);
        const after = (await readLocal(owner))!;
        expect(after.cloudflareDelivery).toBeUndefined();
        expect(after.pending).toEqual([]);
        expect(after.data.profile?.height).toBe('171');
        expect(after.baseline.profile?.height).toBe('171');
        expect(after.syncMetaByDocument[''].clock).toEqual({ s00: 1 });
        expect(await resumeCloudflareDelivery(owner, adk, transport, 'csrf-session', () => true))
            .toBe('idle');
    });

    it('keeps the exact original bytes after an ambiguous remote result and reuses them on restart', async () => {
        await stage();
        const before = (await readLocal(owner))!;
        const ciphertext = before.cloudflareDelivery?.batch.documents[0].document._sealed.ciphertext;
        const bad = {
            receipt: vi.fn(async () => null),
            commit: vi.fn(async () => { throw new Error('response lost after remote commit'); }),
        };
        await expect(resumeCloudflareDelivery(owner, adk, bad, 'csrf-session', () => true))
            .rejects.toThrow('response lost');
        expect((await readLocal(owner))?.cloudflareDelivery).toEqual(before.cloudflareDelivery);
        expect(await get(storeKey)).toBeDefined();
        // The next process must not reseal the batch: it can only replay the
        // persistent bytes or verify their exact content-bound remote receipt.
        const recovered = {
            commit: vi.fn(),
            receipt: vi.fn(async (batch: CloudReplicaBatch) => {
                expect(batch.documents[0].document._sealed.ciphertext).toBe(ciphertext);
                return { revision: 1, lastSeq: 1 };
            }),
        };
        await expect(resumeCloudflareDelivery(owner, adk, recovered, 'csrf-session', () => true))
            .resolves.toBe('acknowledged');
        expect(recovered.commit).not.toHaveBeenCalled();
        expect((await readLocal(owner))?.pending).toEqual([]);
    });

    it('preserves a new local edit between remote commit and the older local ACK', async () => {
        const { envelope } = await stage();
        const transport = deliveryTransport();
        const baseCommit = transport.commit;
        transport.commit = vi.fn(async (batch: CloudReplicaBatch, token: string) => {
            const result = await baseCommit(batch, token);
            await commitLocal(owner, profile(172), profile(171));
            return result;
        });
        expect(await resumeCloudflareDelivery(owner, adk, transport, 'csrf-session', () => true))
            .toBe('acknowledged');
        const after = (await readLocal(owner))!;
        expect(after.data.profile?.height).toBe('172');
        expect(after.baseline.profile?.height).toBe('171');
        expect(after.pending).toHaveLength(1);
        expect(after.pending[0].seq).toBeGreaterThan(envelope.pending.at(-1)!.seq);
        expect(after.cloudflareDelivery).toBeUndefined();
        expect(after.syncMetaByDocument[''].clock).toEqual({ s00: 1 });
    });

    it('does not allow a second staging attempt or a replica checkpoint while an intent is outstanding', async () => {
        const initial = await stage();
        const previous = await get(storeKey);
        await expect(stageCloudflareDelivery(owner, initial.envelope.pending, initial.snapshot,
            initial.control, initial.replica, 'batch000000000192', adk, () => true))
            .rejects.toThrow('Intento D1 non installabile');
        await expect(adoptReplicaCheckpoint(owner, { identity: initial.replica, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: {} })).rejects.toThrow('Intento D1');
        expect(await get(storeKey)).toBe(previous);
    });

    it('rejects a legacy-style ACK without the pending D1 batch receipt and preserves ciphertext', async () => {
        const { replica, envelope } = await stage();
        const previous = await get(storeKey);
        await expect(acknowledgeThrough(owner, 1, profile(171), [], {}, {
            operations: envelope.pending, replica,
        })).rejects.toThrow('Acknowledgement D1');
        expect(await get(storeKey)).toBe(previous);
    });

    it('refuses a torn or corrupted intent instead of treating the journal as empty', async () => {
        await stage();
        await updateArchiveRecord<unknown>(owner, raw => {
            const value = raw as Record<string, unknown>;
            const intent = value.cloudflareDelivery as Record<string, unknown>;
            return { ...value, cloudflareDelivery: { ...intent,
                operations: [{ docPath: '', path: ['profile', 'height'],
                    actorId: 's00', seq: 999, clock: { s00: 999 }, isDelete: false, value: 'broken' }],
            } };
        });
        await expect(readLocal(owner)).rejects.toThrow('Intento D1 non verificabile');
    });

    it('does not persist a late delivery when session epoch changes during IndexedDB update', async () => {
        const initial = await seed();
        const before = await get(storeKey);
        await expect(stageCloudflareDelivery(owner, initial.envelope.pending, initial.snapshot,
            initial.control, initial.replica, 'batch000000000193', adk, () => false))
            .rejects.toThrow('Sessione');
        expect(await get(storeKey)).toBe(before);
    });
});
