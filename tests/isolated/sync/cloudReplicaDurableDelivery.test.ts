import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { UserData, CachedGlobalCatalog } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { adoptReplicaCheckpoint, acknowledgeThrough, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { stageCloudflareDelivery, resumeCloudflareDelivery } from '../../../src/lib/sync/cloudReplicaDurableDelivery';
import type { CloudReplicaBatch, CloudReplicaControlSnapshot, CloudReplicaSnapshot } from '../../../src/lib/sync/cloudReplicaTransport';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { markCloudIntegrityBlocked } from '../../../src/lib/sync/localRepository';

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

    it('refuses to stage against a newly fenced cloud snapshot, without touching ciphertext', async () => {
        const initial = await seed();
        await markCloudIntegrityBlocked(owner);
        const previous = await get(storeKey);
        await expect(stageCloudflareDelivery(owner, initial.envelope.pending, initial.snapshot,
            initial.control, initial.replica, 'batch000000000194', adk, () => true))
            .rejects.toThrow('Intento D1 non installabile');
        expect(await get(storeKey)).toBe(previous);
    });

    it('does not stage a stale prefix after another tab adds a new pending operation', async () => {
        const initial = await seed();
        await commitLocal(owner, profile(172), profile(171));
        const previous = await get(storeKey);
        await expect(stageCloudflareDelivery(owner, initial.envelope.pending, initial.snapshot,
            initial.control, initial.replica, 'batch000000000195', adk, () => true))
            .rejects.toThrow('Intento D1 non installabile');
        expect(await get(storeKey)).toBe(previous);
        expect((await readLocal(owner))?.pending).toHaveLength(2);
    });

    it('persists and acknowledges a real mixed-sequence root/month journal without inflating the root clock', async () => {
        const seeded = await seed();
        const updated = UserDataSchema.parse({
            ...seeded.envelope.data,
            nutrition: { '2026-11-13': { date: '2026-11-13', weight: 70 } },
        }) as unknown as UserData;
        await commitLocal(owner, updated, seeded.envelope.data);
        const current = (await readLocal(owner))!;
        expect(new Set(current.pending.map(op => op.docPath))).toEqual(
            new Set(['', 'nutrition_months/2026-11']),
        );
        expect(current.pending.at(-1)!.seq).toBeGreaterThan(current.pending[0].seq);

        await stageCloudflareDelivery(owner, current.pending, {
            ...seeded.snapshot,
            documents: [...seeded.snapshot.documents, {
                path: 'nutrition_months/2026-11', document: null, revision: null,
            }],
        }, seeded.control, seeded.replica, 'batch000000000196', adk, () => true);
        const saved = (await readLocal(owner))!;
        const batch = saved.cloudflareDelivery!.batch;
        expect(batch.lastSeq).toBe(current.pending.at(-1)!.seq);
        expect(batch.documents.find(doc => doc.path === '')?.document._sync.clock.s00).toBe(
            current.pending[0].seq,
        );
        expect(batch.documents.find(doc => doc.path === 'nutrition_months/2026-11')?.document._sync.clock.s00)
            .toBe(batch.lastSeq);
        expect(batch.documents.every(doc => doc.document._sync.writer?.seq === batch.lastSeq)).toBe(true);

        const transport = deliveryTransport();
        expect(await resumeCloudflareDelivery(owner, adk, transport, 'csrf-session', () => true))
            .toBe('acknowledged');
        const after = (await readLocal(owner))!;
        expect(after.pending).toEqual([]);
        expect(after.cloudflareDelivery).toBeUndefined();
        expect(after.syncMetaByDocument[''].clock.s00).toBe(current.pending[0].seq);
        expect(after.syncMetaByDocument['nutrition_months/2026-11'].clock.s00).toBe(batch.lastSeq);
        expect(after.data.nutrition?.['2026-11-13']?.weight).toBe(70);
    });

    it('refuses a mismatched receipt even if an injected transport reports success', async () => {
        await stage();
        const before = await get(storeKey);
        const transport = {
            receipt: vi.fn(async () => ({ revision: 1, lastSeq: 999 })),
            commit: vi.fn(),
        };
        await expect(resumeCloudflareDelivery(owner, adk, transport, 'csrf-session', () => true))
            .rejects.toThrow('Ricevuta D1 assente o discordante');
        expect(transport.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
        expect((await readLocal(owner))?.cloudflareDelivery).toBeDefined();
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
            .rejects.toThrow('sessione');
        expect(await get(storeKey)).toBe(before);
    });
});
