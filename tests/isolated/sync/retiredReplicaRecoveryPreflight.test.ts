import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { UserDataSchema } from '../../../src/lib/schema';
import type { CachedGlobalCatalog, UserData } from '../../../src/types';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import type { CloudReplicaControlSnapshot } from '../../../src/lib/sync/cloudReplicaTransport';
import { projectDocuments } from '../../../src/lib/sync/documentProjection';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { preflightRetiredReplicaRecovery } from '../../../src/lib/sync/retiredReplicaRecoveryPreflight';
import { REPLICA_CLOCK_SKEW_MARGIN_MS } from '../../../src/lib/sync/replicaProtocol';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));
vi.mock('../../../src/lib/firebase', () => { throw Error('Recovery preflight must not load Firebase'); });

const uid = 'k_' + 'A'.repeat(43);
const owner = `user:${uid}`;
const storageKey = `logbook:v2:${owner}`;
const accountKey = new Uint8Array(32).fill(31);
const replica = { slot: 's03', replicaId: 'old-device-replica', generation: 2,
    leaseUntilMs: Date.now() + 86_400_000, checkpointAtMs: Date.now() };
const legal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-16T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) },
    legalConsent: legal }) as unknown as UserData;
const emptyMeta: SyncMeta = { protocolVersion: 3, clock: {}, fields: {},
    writer: { slot: replica.slot, replicaId: replica.replicaId,
        generation: replica.generation, seq: 0, consentRevision: 1 } };
const catalog = {
    manifest: { version: 'preflight-fixture', updatedAt: '2026-11-16T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
} as CachedGlobalCatalog;
const control = (entry: Partial<CloudReplicaControlSnapshot['replicas']['s03']> = {}) => ({
    uid, revision: 8, fenceEpoch: 5, consentRevision: 1,
    replicas: { s03: { ...replica, status: 'retired' as const, lastSeq: 0, checkpointClock: {}, ...entry } },
});

async function checkpoint(business = projectDocuments(data(170), catalog).get('')!,
    meta: SyncMeta = emptyMeta, ownerUid = uid) {
    const encrypted = sealCloudDocument(accountKey, ownerUid, '', business, meta);
    return readAuthenticatedCloudflareCheckpoint(async () => ({
        revision: 8, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision: 8, document: encrypted }],
    }), uid, accountKey, 1, () => true);
}

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
        callback: () => Promise<unknown>) => callback() } });
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
    await updateArchiveRecord<unknown>(owner, raw => ({
        ...(raw as Record<string, unknown>), consentRevision: 1,
    }));
    await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 }, {
        clock: {}, syncMetaByDocument: { '': emptyMeta },
    });
    await commitLocal(owner, data(171), data(170));
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('retired replica recovery preflight, no mutation or new causal identity', () => {
    it('distinguishes a matching authenticated cloud baseline from permission to replay', async () => {
        const sealed = await get(storageKey);
        const local = (await readLocal(owner))!;
        expect(local.pending.length).toBeGreaterThan(0);
        const result = preflightRetiredReplicaRecovery(uid, local, await checkpoint(), control(), catalog);
        expect(result).toEqual({ kind: 'baseline-unchanged', cloudRevision: 8,
            pendingOperations: local.pending.length });
        expect(await get(storageKey)).toBe(sealed);
        expect((await readLocal(owner))?.replica).toEqual(replica);
    });

    it('rejects an unchanged business value with a newer causal stamp (ABA)', async () => {
        const meta: SyncMeta = { ...emptyMeta, clock: { s01: 4 }, fields: {} };
        expect(preflightRetiredReplicaRecovery(uid, (await readLocal(owner))!,
            await checkpoint(undefined, meta), control(), catalog)).toEqual({
            kind: 'reconciliation-required', reason: 'cloud-diverged',
        });
    });

    it('detects a remote business conflict without reducing it to local-last-write', async () => {
        expect(preflightRetiredReplicaRecovery(uid, (await readLocal(owner))!,
            await checkpoint(projectDocuments(data(173), catalog).get('')!), control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged' });
    });

    it('requires every document from the complete AEAD scan, including remote-only months', async () => {
        const root = sealCloudDocument(accountKey, uid, '',
            projectDocuments(data(170), catalog).get('')!, emptyMeta);
        const remoteMonth = sealCloudDocument(accountKey, uid, 'nutrition_months/2026-11', {}, {
            ...emptyMeta, clock: { s01: 2 }, writer: {
                slot: 's01', replicaId: 'other-device', generation: 1,
                seq: 2, consentRevision: 1,
            },
        });
        const cloud = await readAuthenticatedCloudflareCheckpoint(async () => ({
            revision: 8, fenceEpoch: 5, consentRevision: 1,
            documents: [
                { path: '', revision: 8, document: root },
                { path: 'nutrition_months/2026-11', revision: 8, document: remoteMonth },
            ],
        }), uid, accountKey, 1, () => true);
        expect(preflightRetiredReplicaRecovery(uid, (await readLocal(owner))!, cloud, control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged' });
    });

    it('never promotes a live original slot or an apparent lost ACK to a new writer', async () => {
        const local = (await readLocal(owner))!;
        expect(preflightRetiredReplicaRecovery(uid, local, await checkpoint(),
            control({ status: 'active', leaseUntilMs: Date.now() + 3600000 }), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'replica-active' });
        expect(preflightRetiredReplicaRecovery(uid, local, await checkpoint(),
            control({ lastSeq: local.pending[0].seq }), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'possible-lost-ack' });
    });

    it('respects the D1 membership grace at the nominal lease boundary without permitting replay', async () => {
        const local = (await readLocal(owner))!;
        const cloud = await checkpoint();
        const nowMs = Date.now();
        for (const leaseUntilMs of [nowMs, nowMs - 60_000,
            nowMs - REPLICA_CLOCK_SKEW_MARGIN_MS]) {
            expect(preflightRetiredReplicaRecovery(uid, local, cloud,
                control({ status: 'active', leaseUntilMs }), catalog, nowMs))
                .toEqual({ kind: 'reconciliation-required', reason: 'replica-active' });
        }
        expect(preflightRetiredReplicaRecovery(uid, local, cloud, control({
            status: 'active', leaseUntilMs: nowMs - REPLICA_CLOCK_SKEW_MARGIN_MS - 1,
        }), catalog, nowMs)).toEqual({ kind: 'baseline-unchanged',
            pendingOperations: local.pending.length, cloudRevision: 8 });
        // An explicitly retired incarnation never inherits the active grace.
        expect(preflightRetiredReplicaRecovery(uid, local, cloud, control({
            status: 'retired', leaseUntilMs: nowMs + 60_000,
        }), catalog, nowMs).kind).toBe('baseline-unchanged');
    });

    it('observes a replaced or missing incarnation only as a provisional unchanged baseline', async () => {
        const local = (await readLocal(owner))!;
        const cloud = await checkpoint();
        for (const register of [
            control({ replicaId: 'replacement', generation: 3, status: 'active' }),
            { ...control(), replicas: {} },
        ]) {
            expect(preflightRetiredReplicaRecovery(uid, local, cloud, register, catalog))
                .toEqual({ kind: 'baseline-unchanged', pendingOperations: local.pending.length,
                    cloudRevision: 8 });
        }
    });

    it('rejects owner/fence mismatch, bad ciphertext and unfinished mutation before recovery', async () => {
        const local = (await readLocal(owner))!;
        const cloud = await checkpoint();
        expect(() => preflightRetiredReplicaRecovery(uid, local, cloud,
            { ...control(), uid: 'another-owner' }, catalog)).toThrow();
        expect(() => preflightRetiredReplicaRecovery(uid, local, cloud,
            { ...control(), revision: 9 }, catalog)).toThrow();
        await expect(checkpoint(undefined, emptyMeta, 'different-owner')).rejects.toThrow();
        await updateArchiveRecord<unknown>(owner, raw => ({ ...(raw as Record<string, unknown>),
            cloudflareReplicaClaim: {
                mutationId: 'held-mutation-id-123', expectedRevision: 8, expectedFenceEpoch: 5,
                consentRevision: 1, candidateReplicaId: 'another-device', currentReplica: {
                    slot: replica.slot, replicaId: replica.replicaId, generation: replica.generation,
                }, checkpointClock: {},
            },
        }));
        expect(preflightRetiredReplicaRecovery(uid, (await readLocal(owner))!, cloud, control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'transition' });
    });

    it('rejects a locally altered result that no longer replays from the authenticated base', async () => {
        const local = (await readLocal(owner))!;
        const changed = { ...local, data: data(172) };
        expect(preflightRetiredReplicaRecovery(uid, changed, await checkpoint(), control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'local-replay-diverged' });
    });
});
