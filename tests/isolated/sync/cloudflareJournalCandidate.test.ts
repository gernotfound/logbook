import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { CachedGlobalCatalog, UserData } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { deliverCloudflareJournalCandidate } from '../../../src/lib/sync/cloudflareJournalCandidate';
import { stageCloudflareDelivery } from '../../../src/lib/sync/cloudReplicaDurableDelivery';
import type {
    CloudReplicaBatch, CloudReplicaControlSnapshot, CloudReplicaSnapshot,
} from '../../../src/lib/sync/cloudReplicaTransport';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

const owner = 'user:cf04-candidate';
const storeKey = 'logbook:v2:' + owner;
const adk = new Uint8Array(32).fill(21);
const catalog: CachedGlobalCatalog = {
    manifest: { version: 'cf04-candidate', updatedAt: '2026-11-14T00:00:00.000Z',
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
        slot: 's00', replicaId: 'cf04-candidate-device', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 86400000,
    };
    await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 },
        { clock: {}, syncMetaByDocument: {} });
    await commitLocal(owner, profile(171), initial);
    const local = await readLocal(owner);
    if (!local || local.pending.length === 0) throw new Error('Test journal missing');
    const control: CloudReplicaControlSnapshot = {
        revision: 0, fenceEpoch: 5, consentRevision: 1,
        replicas: { s00: { ...replica, lastSeq: 0, status: 'active', checkpointClock: {} } },
    };
    const snapshot: CloudReplicaSnapshot = {
        revision: 0, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision: null, document: null }],
    };
    return { replica, local, control, snapshot };
}

function transport(control: CloudReplicaControlSnapshot, snapshot: CloudReplicaSnapshot) {
    let committed: CloudReplicaBatch | null = null;
    return {
        control: vi.fn(async () => control),
        read: vi.fn(async (_paths: string[]) => snapshot),
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

describe('isolated CF-04 journal orchestrator', () => {
    it('stages an encrypted causal prefix then requires a matching receipt for the local ACK', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        const result = await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true);
        expect(result).toBe('acknowledged');
        expect(remote.control).toHaveBeenCalledOnce();
        expect(remote.read).toHaveBeenCalledWith(['']);
        expect(remote.receipt).toHaveBeenCalledTimes(2);
        expect(remote.commit).toHaveBeenCalledOnce();
        const saved = (await readLocal(owner))!;
        expect(saved.pending).toEqual([]);
        expect(saved.cloudflareDelivery).toBeUndefined();
        expect(saved.data.profile?.height).toBe('171');
        expect(saved.syncMetaByDocument[''].clock).toEqual({ s00: 1 });
    });

    it('recovers an existing immutable intent before fetching a new snapshot', async () => {
        const { control, snapshot, local, replica } = await seed();
        await stageCloudflareDelivery(owner, local.pending, snapshot, control, replica,
            'batch000000000251', adk, () => true);
        const before = (await readLocal(owner))!.cloudflareDelivery!.batch;
        const remote = transport(control, snapshot);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.read).not.toHaveBeenCalled();
        expect(remote.commit.mock.calls[0][0]).toEqual(before);
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('keeps staged ciphertext and operations when remote delivery is ambiguous', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        remote.commit.mockImplementation(async () => { throw new Error('ambiguous remote timeout'); });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow('ambiguous remote timeout');
        const pending = (await readLocal(owner))!;
        const savedBatch = structuredClone(pending.cloudflareDelivery!.batch);
        expect(pending.pending).toHaveLength(1);
        expect(await get(storeKey)).toBeDefined();

        const recover = {
            control: vi.fn(async () => { throw new Error('unexpected control fetch'); }),
            read: vi.fn(async () => { throw new Error('unexpected snapshot fetch'); }),
            commit: vi.fn(async () => { throw new Error('unexpected reseal or resend'); }),
            receipt: vi.fn(async (batch: CloudReplicaBatch) => {
                expect(batch).toEqual(savedBatch);
                return { revision: batch.expectedRevision + 1, lastSeq: batch.lastSeq };
            }),
        };
        expect(await deliverCloudflareJournalCandidate(owner, adk, recover, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(recover.control).not.toHaveBeenCalled();
        expect(recover.read).not.toHaveBeenCalled();
        expect(recover.commit).not.toHaveBeenCalled();
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('never stages a stale or conflicting D1 control/document revision', async () => {
        const { control, snapshot } = await seed();
        const before = await get(storeKey);
        const remote = transport(control, { ...snapshot, revision: 1 });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow();
        expect(remote.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
        expect((await readLocal(owner))!.pending).toHaveLength(1);
    });

    it('aborts after a changed session during a remote read, before any IndexedDB staging', async () => {
        const { control, snapshot } = await seed();
        const before = await get(storeKey);
        const remote = transport(control, snapshot);
        let current = true;
        remote.read.mockImplementation(async () => {
            current = false;
            return snapshot;
        });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => current))
            .rejects.toThrow('Sessione D1 cambiata');
        expect(remote.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
    });

    it('fails closed without CSRF or with a guest, without contacting D1', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        const before = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, '', () => true))
            .rejects.toThrow('non validi');
        await expect(deliverCloudflareJournalCandidate('guest', adk, remote, 'csrf-session', () => true))
            .rejects.toThrow('non validi');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.read).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
    });

    it('does not turn an already empty account journal into a cloud commit', async () => {
        await initializeLocal(owner, profile(170));
        const remote = transport({ revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            { revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('idle');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.commit).not.toHaveBeenCalled();
    });
});
