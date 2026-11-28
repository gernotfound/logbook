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
import { validateLocalEnvelope } from '../../../src/lib/sync/localEnvelopeValidation';
import { preflightRetiredReplicaRecovery } from '../../../src/lib/sync/retiredReplicaRecoveryPreflight';
import { REPLICA_CLOCK_SKEW_MARGIN_MS } from '../../../src/lib/sync/replicaProtocol';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { applySemanticOperations, diffDocuments } from '../../../src/lib/sync/semanticProjection';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection';
import { fieldKey } from '../../../src/lib/sync/semanticProjection/metadata';

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

async function competingEntityPreflight({ baseline, desired, remote, changedPath, withoutStamp = false }: {
    baseline: UserData;
    desired: UserData;
    remote: UserData;
    changedPath: string[];
    withoutStamp?: boolean;
}) {
    const saved = (await readLocal(owner))!;
    const seq = saved.actorSeq + 1;
    const before = projectDocuments(baseline, catalog);
    const mine = projectDocuments(desired, catalog);
    const pending = diffDocuments(before, mine, saved.actorId, seq, { ...saved.clock, [saved.actorId]: seq });
    expect(pending.length).toBeGreaterThan(0);
    const local = validateLocalEnvelope({ ...saved, baseline, data: desired,
        actorSeq: seq, clock: { ...saved.clock, [saved.actorId]: seq }, pending,
        syncMetaByDocument: Object.fromEntries([...before.keys()].map(path => [path, emptyMeta])),
    }, owner)!;
    const peer = projectDocuments(remote, catalog);
    const changedDocument = changedPath[0];
    const changedField = changedPath.slice(1);
    const changedMeta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: withoutStamp ? {} : {
        [fieldKey(changedField)]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
    }, writer: { slot: 's01', replicaId: 'peer-device', generation: 1, seq: 1, consentRevision: 1 } };
    const cloud = await readAuthenticatedCloudflareCheckpoint(async () => ({
        revision: 8, fenceEpoch: 5, consentRevision: 1,
        documents: [...peer].map(([path, business]) => ({ path, revision: 8,
            document: sealCloudDocument(accountKey, uid, path, business,
                path === changedDocument ? changedMeta : emptyMeta) })),
    }), uid, accountKey, 1, () => true);
    const sealed = await get(storageKey);
    const outcome = preflightRetiredReplicaRecovery(uid, local, cloud, control(), catalog);
    expect(await get(storageKey)).toBe(sealed);
    return outcome;
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
            evidence: { changedCloudFieldStamps: 0,
                pendingWithOverlappingCloudStamps: 0, unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0 },
        });
    });

    it('treats a writer-only metadata change as unclassified instead of evidence of independence', async () => {
        const meta: SyncMeta = { ...emptyMeta, writer: { ...emptyMeta.writer!, seq: 1 } };
        expect(preflightRetiredReplicaRecovery(uid, (await readLocal(owner))!,
            await checkpoint(undefined, meta), control(), catalog)).toEqual({
            kind: 'reconciliation-required', reason: 'cloud-diverged',
            evidence: { changedCloudFieldStamps: 0,
                pendingWithOverlappingCloudStamps: 0, unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0 },
        });
    });

    it('detects a remote business conflict without reducing it to local-last-write', async () => {
        expect(preflightRetiredReplicaRecovery(uid, (await readLocal(owner))!,
            await checkpoint(projectDocuments(data(173), catalog).get('')!), control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 0, pendingWithOverlappingCloudStamps: 0,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
    });

    it('counts same-field and ancestor causal overlap without selecting a winner or revealing values', async () => {
        const local = (await readLocal(owner))!;
        expect(local.pending.some(op => op.path.join('/') === 'profile/height')).toBe(true);
        for (const path of [['profile', 'height'], ['profile']]) {
            const meta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
                [fieldKey(path)]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
            } };
            const original = await get(storageKey);
            const result = preflightRetiredReplicaRecovery(uid, local,
                await checkpoint(projectDocuments(data(173), catalog).get('')!, meta), control(), catalog);
            expect(result).toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 1,
                unclassifiedDocuments: 0, entitiesWithCompetingVersions: 0,
            } });
            expect(await get(storageKey)).toBe(original);
        }
    });

    it('detects competing versions of the same nutrition day despite disjoint field stamps', async () => {
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 70, sleepHours: '07:00' },
        } }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { ...baseline.nutrition!['2026-11-13'], weight: 71 },
        } }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { ...baseline.nutrition!['2026-11-13'], sleepHours: '08:00' },
        } }) as unknown as UserData;
        const outcome = await competingEntityPreflight({ baseline, desired, remote,
            changedPath: ['nutrition_months/2026-11', '2026-11-13', 'sleepHours'] });
        expect(outcome).toMatchObject({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
            changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 0,
            unclassifiedDocuments: 0, entitiesWithCompetingVersions: 1,
        } });
    });

    it('detects a competing workout version despite independent edited fields', async () => {
        const workout = { id: 'session-1', date: '2026-11-13', sessionNote: 'prima',
            exercises: [{ id: 'row-1', exId: 'bench', sets: [{ id: 'set-1', kg: '40', reps: '8' }] }] };
        const baseline = UserDataSchema.parse({ ...data(170), history: [workout] }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, history: [{ ...workout, sessionNote: 'locale' }] }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, history: [{ ...workout, exercises: [
            { ...workout.exercises[0], sets: [{ id: 'set-1', kg: '45', reps: '8' }] },
        ] }] }) as unknown as UserData;
        const outcome = await competingEntityPreflight({ baseline, desired, remote,
            changedPath: ['history_months/2026-11', 'session-1', 'exercises'] });
        expect(outcome).toMatchObject({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
            pendingWithOverlappingCloudStamps: 0, entitiesWithCompetingVersions: 1,
        } });
    });

    it('follows a workout ID across months instead of hiding a date move as independent', async () => {
        const workout = { id: 'session-move', date: '2026-11-13', sessionNote: 'base', exercises: [] };
        const baseline = UserDataSchema.parse({ ...data(170), history: [workout] }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, history: [
            { ...workout, sessionNote: 'locale' },
        ] }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, history: [
            { ...workout, date: '2026-12-01' },
        ] }) as unknown as UserData;
        const outcome = await competingEntityPreflight({ baseline, desired, remote,
            changedPath: ['history_months/2026-12', 'session-move'] });
        expect(outcome).toMatchObject({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
            entitiesWithCompetingVersions: 1,
        } });
    });

    it('does not invent two business versions when both devices reached the same value', async () => {
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 70 },
        } }) as unknown as UserData;
        const same = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 71 },
        } }) as unknown as UserData;
        const outcome = await competingEntityPreflight({ baseline, desired: same, remote: same,
            changedPath: ['nutrition_months/2026-11', '2026-11-13', 'weight'] });
        expect(outcome).toMatchObject({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
            entitiesWithCompetingVersions: 0,
        } });
    });

    it('counts a remote deletion of the edited day even without a surviving stamp', async () => {
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 70 },
        } }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 71 },
        } }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, nutrition: {} }) as unknown as UserData;
        const outcome = await competingEntityPreflight({ baseline, desired, remote,
            changedPath: ['nutrition_months/2026-11', '2026-11-13'], withoutStamp: true });
        expect(outcome).toMatchObject({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
            entitiesWithCompetingVersions: 1, unclassifiedDocuments: 1,
        } });
    });

    it('does not report a collision when edits concern two different nutrition days', async () => {
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 70 },
            '2026-11-14': { date: '2026-11-14', weight: 80 },
        } }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, nutrition: {
            ...baseline.nutrition, '2026-11-13': { date: '2026-11-13', weight: 71 },
        } }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, nutrition: {
            ...baseline.nutrition, '2026-11-14': { date: '2026-11-14', weight: 81 },
        } }) as unknown as UserData;
        const outcome = await competingEntityPreflight({ baseline, desired, remote,
            changedPath: ['nutrition_months/2026-11', '2026-11-14', 'weight'] });
        expect(outcome).toMatchObject({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
            entitiesWithCompetingVersions: 0, pendingWithOverlappingCloudStamps: 0,
        } });
    });

    it('reports remote changes to a different field without claiming they are safe to replay', async () => {
        const local = (await readLocal(owner))!;
        const withGender = UserDataSchema.parse({ profile: { height: '170', gender: 'other' },
            legalConsent: legal }) as unknown as UserData;
        const meta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
            [fieldKey(['profile', 'gender'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        expect(preflightRetiredReplicaRecovery(uid, local,
            await checkpoint(projectDocuments(withGender, catalog).get('')!, meta), control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 0,
                unclassifiedDocuments: 0, entitiesWithCompetingVersions: 0,
            } });
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
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 0, pendingWithOverlappingCloudStamps: 0,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
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

    it('keeps lost-ACK uncertainty after a slot is reused with an inherited sequence', async () => {
        const local = (await readLocal(owner))!;
        const sealed = await get(storageKey);
        const cloud = await checkpoint();
        for (const status of ['active', 'retired'] as const) {
            expect(preflightRetiredReplicaRecovery(uid, local, cloud, control({
                replicaId: 'new-device', generation: replica.generation + 1,
                status, lastSeq: local.pending[0].seq,
            }), catalog)).toEqual({ kind: 'reconciliation-required', reason: 'possible-lost-ack' });
        }
        expect(await get(storageKey)).toBe(sealed);
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

    it('accepts a monotone replacement only as a provisional unchanged baseline', async () => {
        const local = (await readLocal(owner))!;
        const cloud = await checkpoint();
        expect(preflightRetiredReplicaRecovery(uid, local, cloud,
            control({ replicaId: 'replacement', generation: 3, status: 'active' }), catalog))
            .toEqual({ kind: 'baseline-unchanged', pendingOperations: local.pending.length,
                cloudRevision: 8 });
    });

    it('rejects missing, regressed or contradictory lineage without changing encrypted pending', async () => {
        const local = (await readLocal(owner))!;
        const sealed = await get(storageKey);
        const cloud = await checkpoint();
        for (const register of [
            { ...control(), replicas: {} },
            control({ replicaId: 'other-same-generation' }),
            control({ replicaId: 'old-generation', generation: 1 }),
        ]) {
            expect(preflightRetiredReplicaRecovery(uid, local, cloud, register, catalog))
                .toEqual({ kind: 'reconciliation-required', reason: 'unverifiable-lineage' });
        }
        expect(await get(storageKey)).toBe(sealed);
        expect(await readLocal(owner)).toEqual(local);
    });

    it('rejects a reused replica ID in a newer generation, forbidden by the D1 history ledger', async () => {
        const local = (await readLocal(owner))!;
        const sealed = await get(storageKey);
        expect(preflightRetiredReplicaRecovery(uid, local, await checkpoint(), control({
            generation: replica.generation + 1,
        }), catalog)).toEqual({ kind: 'reconciliation-required', reason: 'unverifiable-lineage' });
        expect(await get(storageKey)).toBe(sealed);
    });

    it('requires the slot counter to cover the already authenticated baseline frontier', async () => {
        const original = (await readLocal(owner))!;
        const sealed = await get(storageKey);
        for (const meta of [
            { ...emptyMeta, clock: { s03: 2 }, writer: { ...emptyMeta.writer!, seq: 2 } },
            { ...emptyMeta, clock: { s03: 1 }, writer: { ...emptyMeta.writer!, seq: 2 } },
        ] satisfies SyncMeta[]) {
            const local = validateLocalEnvelope({
                ...original,
                actorSeq: 3, clock: { s03: 3 },
                pending: original.pending.map(operation => ({
                    ...operation, seq: 3, clock: { s03: 3 },
                })),
                syncMetaByDocument: { '': meta },
            }, owner)!;
            const cloud = await checkpoint(undefined, meta);

            expect(preflightRetiredReplicaRecovery(uid, local, cloud,
                control({ lastSeq: 1 }), catalog)).toEqual({
                kind: 'reconciliation-required', reason: 'unverifiable-lineage',
            });
            expect(preflightRetiredReplicaRecovery(uid, local, cloud,
                control({ lastSeq: 2 }), catalog)).toEqual({
                kind: 'baseline-unchanged', pendingOperations: local.pending.length, cloudRevision: 8,
            });
        }
        expect(await get(storageKey)).toBe(sealed);
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

    it('refuses to attribute a corrupt offline journal to a cloud conflict even when both copies changed', async () => {
        const original = (await readLocal(owner))!;
        const sealed = await get(storageKey);
        const changedLocal = { ...original, data: data(172) };
        const changedRemote = projectDocuments(data(173), catalog).get('')!;
        const cloudMeta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
            [fieldKey(['profile', 'height'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        const cloud = await checkpoint(changedRemote, cloudMeta);

        expect(preflightRetiredReplicaRecovery(uid, changedLocal, cloud, control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'local-replay-diverged' });
        expect(preflightRetiredReplicaRecovery(uid, original, cloud, control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 1,
                unclassifiedDocuments: 0, entitiesWithCompetingVersions: 0,
            } });
        expect(await get(storageKey)).toBe(sealed);
    });

    it('does not let a disjoint causal stamp conceal an unstamped edit of the pending field', async () => {
        const local = (await readLocal(owner))!;
        const remote = UserDataSchema.parse({ profile: { height: '173', gender: 'other' },
            legalConsent: legal }) as unknown as UserData;
        const meta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
            [fieldKey(['profile', 'gender'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        expect(preflightRetiredReplicaRecovery(uid, local,
            await checkpoint(projectDocuments(remote, catalog).get('')!, meta), control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 0,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
    });

    it('counts unstamped changes alongside a stamped conflict, not just the stamped field', async () => {
        const local = (await readLocal(owner))!;
        const remote = UserDataSchema.parse({ profile: { height: '173', gender: 'other' },
            legalConsent: legal }) as unknown as UserData;
        const meta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
            [fieldKey(['profile', 'height'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        expect(preflightRetiredReplicaRecovery(uid, local,
            await checkpoint(projectDocuments(remote, catalog).get('')!, meta), control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 1,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
    });

    it('treats an extra causal frontier without a field witness as unclassified', async () => {
        const local = (await readLocal(owner))!;
        const remote = UserDataSchema.parse({ profile: { height: '170', gender: 'other' },
            legalConsent: legal }) as unknown as UserData;
        const meta: SyncMeta = { ...emptyMeta, clock: { s01: 1, s02: 3 }, fields: {
            [fieldKey(['profile', 'gender'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        expect(preflightRetiredReplicaRecovery(uid, local,
            await checkpoint(projectDocuments(remote, catalog).get('')!, meta), control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 0,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
    });

    it('does not classify a lost causal field stamp as explained by a matching document clock', async () => {
        const original = (await readLocal(owner))!;
        const previousMeta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
            [fieldKey(['profile', 'height'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        const local = validateLocalEnvelope({ ...original, clock: { ...original.clock, s01: 1 },
            syncMetaByDocument: { '': previousMeta },
        }, owner)!;
        const cloud = await checkpoint(undefined, { ...previousMeta, fields: {} });
        const sealed = await get(storageKey);
        expect(preflightRetiredReplicaRecovery(uid, local, cloud, control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 1,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
        expect(await get(storageKey)).toBe(sealed);
    });

    it('does not let another valid stamp conceal the loss of a previous causal witness', async () => {
        const original = (await readLocal(owner))!;
        const previousMeta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
            [fieldKey(['profile', 'height'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        const local = validateLocalEnvelope({ ...original, clock: { ...original.clock, s01: 1 },
            syncMetaByDocument: { '': previousMeta },
        }, owner)!;
        const remote = UserDataSchema.parse({ profile: { height: '170', gender: 'other' },
            legalConsent: legal }) as unknown as UserData;
        const cloudMeta: SyncMeta = { ...emptyMeta, clock: { s01: 1, s02: 1 }, fields: {
            [fieldKey(['profile', 'gender'])]: { actorId: 's02', seq: 1, clock: { s02: 1 } },
        } };
        expect(preflightRetiredReplicaRecovery(uid, local,
            await checkpoint(projectDocuments(remote, catalog).get('')!, cloudMeta), control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 2, pendingWithOverlappingCloudStamps: 1,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
    });

    it('does not hide an ignored nutrition total behind another valid monthly field stamp', async () => {
        const original = (await readLocal(owner))!;
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 70, kcal: 0 },
        } }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, profile: { height: '171' } }) as unknown as UserData;
        const pending = diffDocuments(projectDocuments(baseline, catalog), projectDocuments(desired, catalog),
            original.actorId, original.actorSeq, original.clock);
        const local = validateLocalEnvelope({ ...original, baseline, data: desired, pending,
            syncMetaByDocument: { ...original.syncMetaByDocument, 'nutrition_months/2026-11': emptyMeta },
        }, owner)!;
        const expected = projectDocuments(local.data, catalog);
        const actual = applySemanticOperations(projectDocuments(local.baseline, catalog),
            local.pending, local.syncMetaByDocument).documents;
        expect([...actual]).toEqual([...expected]);
        const remote = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 71, kcal: 101 },
        } }) as unknown as UserData;
        const documents = projectDocuments(remote, catalog);
        const monthMeta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
            [fieldKey(['2026-11-13', 'weight'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        const cloud = await readAuthenticatedCloudflareCheckpoint(async () => ({
            revision: 8, fenceEpoch: 5, consentRevision: 1, documents: [
                { path: '', revision: 8,
                    document: sealCloudDocument(accountKey, uid, '', documents.get('')!, emptyMeta) },
                { path: 'nutrition_months/2026-11', revision: 8,
                    document: sealCloudDocument(accountKey, uid, 'nutrition_months/2026-11',
                        documents.get('nutrition_months/2026-11')!, monthMeta) },
            ],
        }), uid, accountKey, 1, () => true);
        expect(preflightRetiredReplicaRecovery(uid, local, cloud, control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 0,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
    });

    it('classifies ignored totals when a stamped nutrition day is newly created', async () => {
        const original = (await readLocal(owner))!;
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            '2026-11-12': { date: '2026-11-12', weight: 70, kcal: 0 },
        } }) as unknown as UserData;
        const desired = UserDataSchema.parse({
            ...baseline, profile: { height: '171' },
        }) as unknown as UserData;
        const pending = diffDocuments(projectDocuments(baseline, catalog), projectDocuments(desired, catalog),
            original.actorId, original.actorSeq, original.clock);
        const local = validateLocalEnvelope({ ...original, baseline, data: desired, pending,
            syncMetaByDocument: { ...original.syncMetaByDocument, 'nutrition_months/2026-11': emptyMeta },
        }, owner)!;
        const remote = UserDataSchema.parse({ ...baseline, nutrition: {
            ...baseline.nutrition,
            '2026-11-13': { date: '2026-11-13', weight: 71, kcal: 101 },
        } }) as unknown as UserData;
        const documents = projectDocuments(remote, catalog);
        const monthMeta: SyncMeta = { ...emptyMeta, clock: { s01: 1 }, fields: {
            [fieldKey(['2026-11-13'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
        } };
        const cloud = await readAuthenticatedCloudflareCheckpoint(async () => ({
            revision: 8, fenceEpoch: 5, consentRevision: 1, documents: [
                { path: '', revision: 8,
                    document: sealCloudDocument(accountKey, uid, '', documents.get('')!, emptyMeta) },
                { path: 'nutrition_months/2026-11', revision: 8,
                    document: sealCloudDocument(accountKey, uid, 'nutrition_months/2026-11',
                        documents.get('nutrition_months/2026-11')!, monthMeta) },
            ],
        }), uid, accountKey, 1, () => true);
        expect(preflightRetiredReplicaRecovery(uid, local, cloud, control(), catalog))
            .toEqual({ kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 1, pendingWithOverlappingCloudStamps: 0,
                unclassifiedDocuments: 1, entitiesWithCompetingVersions: 0,
            } });
    });
});
