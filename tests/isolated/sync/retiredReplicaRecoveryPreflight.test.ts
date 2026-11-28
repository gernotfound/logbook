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
import { buildRetiredReplicaConflictCapsule,
    stageRetiredReplicaConflictCapsule } from '../../../src/lib/sync/retiredReplicaConflictCapsule';
import { parseRetiredReplicaConflictCapsule } from '../../../src/lib/sync/retiredReplicaConflictRecord';
import { previewRetiredReplicaConflictResolution } from '../../../src/lib/sync/retiredReplicaConflictResolution';
import { materializeRetiredReplicaConflictChoices, previewRetiredReplicaSelectedDocuments } from '../../../src/lib/sync/retiredReplicaConflictMaterialization';
import { parseRetiredReplicaConflictDecisions } from '../../../src/lib/sync/retiredReplicaConflictDecisionRecord';
import { inspectRetiredReplicaConflictDecisions, recordRetiredReplicaConflictDecision } from '../../../src/lib/sync/retiredReplicaConflictDecisions';
import { REPLICA_CLOCK_SKEW_MARGIN_MS } from '../../../src/lib/sync/replicaProtocol';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { applySemanticOperations, diffDocuments, parseSyncMeta } from '../../../src/lib/sync/semanticProjection';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection';
import { fieldKey } from '../../../src/lib/sync/semanticProjection/metadata';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));
vi.mock('../../../src/lib/firebase', () => { throw Error('Recovery preflight must not load Firebase'); });

const uid = 'k_' + 'A'.repeat(43);
const owner = `user:${uid}`;
const storageKey = `logbook:v2:${owner}`;
const expectedFrontier = { consentRevision: 1, fenceEpoch: 5 };
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

describe('retired replica conflict choices as non-authoritative materialized candidates', () => {
    async function fixture(sameField = false) {
        const date = '2026-11-13';
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            [date]: { date, weight: 70, sleepHours: '07:00' },
        } }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, nutrition: {
            [date]: { ...baseline.nutrition![date], weight: 71 },
        } }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, nutrition: {
            [date]: { ...baseline.nutrition![date], ...(sameField ? { weight: 72 } : { sleepHours: '08:00' }) },
        } }) as unknown as UserData;
        const { local, cloud } = await competingEntitySources({ baseline, desired, remote,
            changedPath: ['nutrition_months/2026-11', date, sameField ? 'weight' : 'sleepHours'] });
        await updateArchiveRecord(owner, () => local);
        const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
        await stageRetiredReplicaConflictCapsule(owner, local, capsule, () => true);
        return { date, local, cloud, capsule };
    }

    it('requires every explicit choice and revalidates the exact signed remote alternative', async () => {
        const { date, cloud, capsule } = await fixture();
        const initial = (await readLocal(owner))!;
        expect(() => materializeRetiredReplicaConflictChoices(initial, cloud, control(), catalog)).toThrow(/tutti/);
        const choice = { kind: 'nutrition' as const, entityId: date, choice: 'combined' as const };
        await recordRetiredReplicaConflictDecision(owner, initial.revision, choice,
            choice, legal, expectedFrontier, () => true);
        const saved = (await readLocal(owner))!;
        const ciphertext = await get(storageKey);
        const originalCloud = structuredClone([...cloud.documents]);
        const selected = materializeRetiredReplicaConflictChoices(saved, cloud, control(), catalog);
        expect(selected).toEqual([expect.objectContaining({ kind: 'nutrition', entityId: date,
            choice: 'combined', docPath: 'nutrition_months/2026-11',
            value: expect.objectContaining({ weight: 71, sleepHours: '08:00' }) })]);
        const proposed = previewRetiredReplicaSelectedDocuments(saved, cloud, control(), catalog);
        expect(proposed.get('nutrition_months/2026-11')?.[date]).toMatchObject({ weight: 71, sleepHours: '08:00' });
        expect(capsule.entries[0].device?.value).toMatchObject({ weight: 71, sleepHours: '07:00' });
        expect(capsule.entries[0].cloud?.value).toMatchObject({ weight: 70, sleepHours: '08:00' });
        expect([...cloud.documents]).toEqual(originalCloud);
        expect(await get(storageKey)).toBe(ciphertext);

        const altered = { ...cloud, documents: new Map(cloud.documents) };
        const path = 'nutrition_months/2026-11';
        const old = cloud.documents.get(path)!;
        altered.documents.set(path, { ...old, business: { [date]: { ...old.business[date] as object, weight: 200 } } });
        expect(() => materializeRetiredReplicaConflictChoices(saved, altered, control(), catalog)).toThrow(/cloud/);
        expect(() => materializeRetiredReplicaConflictChoices(saved, cloud,
            control({ lastSeq: saved.pending[0].seq }), catalog))
            .toThrow(/causale/);
        expect(() => materializeRetiredReplicaConflictChoices(saved, cloud, { ...control(), revision: 9 }, catalog))
            .toThrow(/snapshot/);
    });

    it('keeps manual winner choices separate from ACK, and rejects later local editing', async () => {
        const { date, cloud } = await fixture(true);
        const first = (await readLocal(owner))!;
        const selection = { kind: 'nutrition' as const, entityId: date, choice: 'device' as const };
        await recordRetiredReplicaConflictDecision(owner, first.revision, selection,
            selection, legal, expectedFrontier, () => true);
        const saved = (await readLocal(owner))!;
        expect(materializeRetiredReplicaConflictChoices(saved, cloud, control(), catalog))
            .toEqual([expect.objectContaining({ choice: 'device', value: expect.objectContaining({ weight: 71 }) })]);
        expect(saved.replica).toEqual(replica);
        expect(saved.pending.length).toBeGreaterThan(0);

        await commitLocal(owner, data(180), saved.data);
        const changed = (await readLocal(owner))!;
        expect(changed.retiredReplicaConflictDecisions).toEqual([selection]);
        expect(() => materializeRetiredReplicaConflictChoices(changed, cloud, control(), catalog))
            .toThrow(/Provenienza/);
        expect(() => materializeRetiredReplicaConflictChoices({ ...saved,
            retiredReplicaConflictDecisions: undefined }, cloud, control(), catalog)).toThrow(/tutti/);
        expect(() => materializeRetiredReplicaConflictChoices(saved, cloud,
            { ...control(), fenceEpoch: 6 }, catalog)).toThrow(/snapshot/);
    });

    it('previews either side of a historical workout month move without deleting the original capsule', async () => {
        const workout = { id: 'session-move', date: '2026-11-13', sessionNote: 'old', exercises: [] };
        const baseline = UserDataSchema.parse({ ...data(170), history: [workout] }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline,
            history: [{ ...workout, sessionNote: 'device' }] }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline,
            history: [{ ...workout, date: '2026-12-01', sessionNote: 'cloud' }] }) as unknown as UserData;
        const { local, cloud } = await competingEntitySources({ baseline, desired, remote,
            changedPath: ['history_months/2026-12', 'session-move'], withoutStamp: true });
        await updateArchiveRecord(owner, () => local);
        const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
        await stageRetiredReplicaConflictCapsule(owner, local, capsule, () => true);
        const saved = (await readLocal(owner))!;
        const identity = { kind: 'history' as const, entityId: 'session-move' };
        await recordRetiredReplicaConflictDecision(owner, saved.revision,
            { ...identity, choice: 'device' }, identity, legal, expectedFrontier, () => true);
        const device = previewRetiredReplicaSelectedDocuments((await readLocal(owner))!, cloud, control(), catalog);
        expect(device.get('history_months/2026-11')?.['session-move']).toMatchObject({ sessionNote: 'device' });
        expect(device.get('history_months/2026-12')?.['session-move']).toBeUndefined();
        const revised = (await readLocal(owner))!;
        await recordRetiredReplicaConflictDecision(owner, revised.revision,
            { ...identity, choice: 'cloud' }, identity, legal, expectedFrontier, () => true);
        const chosenCloud = previewRetiredReplicaSelectedDocuments((await readLocal(owner))!, cloud, control(), catalog);
        expect(chosenCloud.get('history_months/2026-11')?.['session-move']).toBeUndefined();
        expect(chosenCloud.get('history_months/2026-12')?.['session-move']).toMatchObject({ sessionNote: 'cloud' });
        expect((await readLocal(owner))!.retiredReplicaConflictCapsule).toEqual(capsule);
        expect(cloud.documents.get('history_months/2026-12')?.business['session-move'])
            .toMatchObject({ sessionNote: 'cloud' });
    });

    it('rejects changed causal metadata even if the cloud business values remain equal', async () => {
        const { date, cloud } = await fixture();
        const observed = (await readLocal(owner))!;
        const identity = { kind: 'nutrition' as const, entityId: date };
        await recordRetiredReplicaConflictDecision(owner, observed.revision,
            { ...identity, choice: 'cloud' }, identity, legal, expectedFrontier, () => true);
        const chosen = (await readLocal(owner))!;
        const path = 'nutrition_months/2026-11';
        const old = cloud.documents.get(path)!;
        const tampered = { ...cloud, documents: new Map(cloud.documents) };
        tampered.documents.set(path, { ...old, sync: { ...parseSyncMeta(old.sync), clock: { s01: 2 } } });
        expect(() => materializeRetiredReplicaConflictChoices(chosen, tampered, control(), catalog))
            .toThrow(/cloud/);
        expect(materializeRetiredReplicaConflictChoices(chosen, cloud, control(), catalog))
            .toEqual([expect.objectContaining({ choice: 'cloud', value: old.business[date] })]);
        expect((await readLocal(owner))!.pending).toEqual(chosen.pending);
    });
});

async function checkpoint(business = projectDocuments(data(170), catalog).get('')!,
    meta: SyncMeta = emptyMeta, ownerUid = uid) {
    const encrypted = sealCloudDocument(accountKey, ownerUid, '', business, meta);
    return readAuthenticatedCloudflareCheckpoint(async () => ({
        revision: 8, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision: 8, document: encrypted }],
    }), uid, accountKey, 1, () => true);
}

type CompetingVersionsFixture = {
    baseline: UserData;
    desired: UserData;
    remote: UserData;
    changedPath: string[];
    withoutStamp?: boolean;
};
async function competingEntitySources({ baseline, desired, remote, changedPath, withoutStamp = false }: CompetingVersionsFixture) {
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
    return { outcome, local, cloud };
}
async function competingEntityPreflight(options: CompetingVersionsFixture) {
    return (await competingEntitySources(options)).outcome;
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

    it('seals both versions of the same nutrition day and the original pending journal without an ACK', async () => {
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 70, sleepHours: '07:00' },
        } }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { ...baseline.nutrition!['2026-11-13'], weight: 71 },
        } }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { ...baseline.nutrition!['2026-11-13'], sleepHours: '08:00' },
        } }) as unknown as UserData;
        const { local, cloud, outcome } = await competingEntitySources({ baseline, desired, remote,
            changedPath: ['nutrition_months/2026-11', '2026-11-13', 'sleepHours'] });
        expect(outcome).toMatchObject({ kind: 'reconciliation-required', evidence: {
            entitiesWithCompetingVersions: 1,
        } });
        await updateArchiveRecord(owner, () => local);
        const original = await get(storageKey);
        const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
        const preview = previewRetiredReplicaConflictResolution(capsule);
        expect(preview).toEqual([expect.objectContaining({ kind: 'automatic-candidate',
            entityKind: 'nutrition', entityId: '2026-11-13',
            docPath: 'nutrition_months/2026-11', value: expect.objectContaining({
                weight: 71, sleepHours: '08:00',
            }),
        })]);
        expect(capsule.entries[0].cloud?.value).toMatchObject({ sleepHours: '08:00', weight: 70 });
        expect(capsule.entries[0].device?.value).toMatchObject({ sleepHours: '07:00', weight: 71 });
        expect(capsule.entries).toHaveLength(1);
        expect(capsule.sourceDocuments).toEqual([expect.objectContaining({
            path: 'nutrition_months/2026-11',
            baseline: { '2026-11-13': expect.objectContaining({ weight: 70 }) },
            device: { '2026-11-13': expect.objectContaining({ weight: 71 }) },
        })]);
        expect(capsule.entries[0]).toMatchObject({ kind: 'nutrition', entityId: '2026-11-13',
            baseline: { value: { weight: 70 } }, device: { value: { weight: 71 } },
            cloud: { value: { sleepHours: '08:00' } },
        });
        expect(await stageRetiredReplicaConflictCapsule(owner, local, capsule, () => true)).toBe(1);
        const sealed = await get<string>(storageKey);
        expect(sealed).not.toBe(original);
        expect(sealed).not.toContain('2026-11-13');
        expect(sealed).not.toContain('08:00');
        const saved = (await readLocal(owner))!;
        expect(saved.pending).toEqual(local.pending);
        expect(saved.replica).toEqual(replica);
        expect(saved.actorId).toBe(local.actorId);
        expect(saved.actorSeq).toBe(local.actorSeq);
        expect(saved.retiredReplicaConflictCapsule).toEqual(capsule);
        const laterEdit = UserDataSchema.parse({ ...desired, profile: { height: '179' } }) as unknown as UserData;
        await commitLocal(owner, laterEdit, desired);
        expect((await readLocal(owner))!.retiredReplicaConflictCapsule).toEqual(capsule);
        lockAllVaults();
        const grant = await (await import('../../../src/lib/sync/secureArchiveSession')).unlockVaultForOwner(owner);
        try { expect((await readLocal(owner))!.retiredReplicaConflictCapsule).toEqual(capsule); }
        finally { grant.release(); }
    });

    it('preserves the historical workout ID across months and a remote deletion as distinct alternatives', async () => {
        const workout = { id: 'session-move', date: '2026-11-13', sessionNote: 'base', exercises: [] };
        const baseline = UserDataSchema.parse({ ...data(170), history: [workout] }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, history: [{ ...workout, sessionNote: 'locale' }] }) as unknown as UserData;
        for (const remoteHistory of [[{ ...workout, date: '2026-12-01' }], []]) {
            const remote = UserDataSchema.parse({ ...baseline, history: remoteHistory }) as unknown as UserData;
            const { local, cloud } = await competingEntitySources({ baseline, desired, remote,
                changedPath: ['history_months/2026-12', 'session-move'], withoutStamp: true });
            const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
            expect(previewRetiredReplicaConflictResolution(capsule)).toEqual([{
                kind: 'manual-required', entityKind: 'history', entityId: 'session-move',
            }]);
            expect(capsule.entries).toHaveLength(1);
            expect(capsule.entries[0].device?.docPath).toBe('history_months/2026-11');
            expect(capsule.entries[0].cloud?.docPath ?? null).toBe(remoteHistory.length
                ? 'history_months/2026-12' : null);
            expect(parseRetiredReplicaConflictCapsule(capsule, owner)).toEqual(capsule);
        }
    });

    it('never auto-merges same-field clashes, concurrent creations, or array replacements', async () => {
        const date = '2026-11-13';
        const original = { date, weight: 70, sleepHours: '07:00' };
        const initial = UserDataSchema.parse({ ...data(170), nutrition: { [date]: original } }) as unknown as UserData;
        const device = UserDataSchema.parse({ ...initial, nutrition: {
            [date]: { ...original, weight: 71 },
        } }) as unknown as UserData;
        const cloudState = UserDataSchema.parse({ ...initial, nutrition: {
            [date]: { ...original, weight: 72 },
        } }) as unknown as UserData;
        const { local, cloud } = await competingEntitySources({ baseline: initial, desired: device,
            remote: cloudState, changedPath: ['nutrition_months/2026-11', date, 'weight'] });
        const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
        expect(previewRetiredReplicaConflictResolution(capsule)).toEqual([{
            kind: 'manual-required', entityKind: 'nutrition', entityId: date,
        }]);
        const concurrentCreate = structuredClone(capsule);
        const entry = concurrentCreate.entries[0];
        entry.baseline = null;
        expect(previewRetiredReplicaConflictResolution(concurrentCreate)).toEqual([{
            kind: 'manual-required', entityKind: 'nutrition', entityId: date,
        }]);
        const arrays = structuredClone(capsule);
        arrays.entries[0].baseline!.value = { meals: [{ id: 'meal-1', amount: 10 }] };
        arrays.entries[0].device!.value = { meals: [{ id: 'meal-1', amount: 20 }] };
        arrays.entries[0].cloud!.value = { meals: [{ id: 'meal-1', amount: 30 }] };
        expect(previewRetiredReplicaConflictResolution(arrays)).toEqual([{
            kind: 'manual-required', entityKind: 'nutrition', entityId: date,
        }]);
        const oneChangedList = structuredClone(capsule);
        const baseList = { date, meals: [{ id: 'meal-1', amount: 10 }] };
        oneChangedList.entries[0].baseline!.value = baseList;
        oneChangedList.entries[0].device!.value = { date, meals: [{ id: 'meal-1', amount: 20 }] };
        oneChangedList.entries[0].cloud!.value = { ...baseList, sleepHours: '08:00' };
        expect(previewRetiredReplicaConflictResolution(oneChangedList)).toEqual([{
            kind: 'manual-required', entityKind: 'nutrition', entityId: date,
        }]);
        const nestedList = structuredClone(capsule);
        const nestedBase = { date, weight: 70, group: { meals: [{ id: 'meal-1', amount: 10 }] } };
        nestedList.entries[0].baseline!.value = nestedBase;
        nestedList.entries[0].device!.value = { ...nestedBase,
            group: { meals: [{ id: 'meal-1', amount: 20 }] },
        };
        nestedList.entries[0].cloud!.value = { ...nestedBase, weight: 71 };
        expect(previewRetiredReplicaConflictResolution(nestedList)).toEqual([{
            kind: 'manual-required', entityKind: 'nutrition', entityId: date,
        }]);
        const fieldRemoval = structuredClone(capsule);
        fieldRemoval.entries[0].baseline!.value = { date, weight: 70, sleepHours: '07:00' };
        fieldRemoval.entries[0].device!.value = { date, sleepHours: '07:00' };
        fieldRemoval.entries[0].cloud!.value = { date, weight: 70, sleepHours: '08:00' };
        expect(previewRetiredReplicaConflictResolution(fieldRemoval)).toEqual([{
            kind: 'manual-required', entityKind: 'nutrition', entityId: date,
        }]);
        const nestedRemoval = structuredClone(capsule);
        const nestedBefore = { date, weight: 70, notes: { a: 'old', b: 'keep' } };
        nestedRemoval.entries[0].baseline!.value = nestedBefore;
        nestedRemoval.entries[0].device!.value = { ...nestedBefore, notes: { b: 'keep' } };
        nestedRemoval.entries[0].cloud!.value = { ...nestedBefore, weight: 71 };
        expect(previewRetiredReplicaConflictResolution(nestedRemoval)).toEqual([{
            kind: 'manual-required', entityKind: 'nutrition', entityId: date,
        }]);
        const replacedObject = structuredClone(capsule);
        replacedObject.entries[0].baseline!.value = nestedBefore;
        replacedObject.entries[0].device!.value = { ...nestedBefore, notes: null };
        replacedObject.entries[0].cloud!.value = { ...nestedBefore, weight: 71 };
        expect(previewRetiredReplicaConflictResolution(replacedObject)).toEqual([{
            kind: 'manual-required', entityKind: 'nutrition', entityId: date,
        }]);
        const active = structuredClone(capsule);
        active.entries = [{ kind: 'active-workout', entityId: 'activeWorkout',
            baseline: { docPath: '', value: { id: 'running', exercises: [] }, sync: null },
            device: { docPath: '', value: { id: 'running', exercises: [], moodRating: 3 }, sync: null },
            cloud: { docPath: '', value: { id: 'running', exercises: [], waterLiters: 1 }, sync: null },
        }];
        expect(previewRetiredReplicaConflictResolution(active)).toEqual([{
            kind: 'manual-required', entityKind: 'active-workout', entityId: 'activeWorkout',
        }]);
    });

    it('composes independent workout fields only within one unchanged shard, without changing the source', async () => {
        const workout = { id: 'session-safe', date: '2026-11-13', globalDurationStr: '01:00',
            waterLiters: 1, exercises: [] };
        const baseline = UserDataSchema.parse({ ...data(170), history: [workout] }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, history: [{ ...workout, waterLiters: 2 }] }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, history: [{ ...workout, globalDurationStr: '01:10' }] }) as unknown as UserData;
        const { local, cloud } = await competingEntitySources({ baseline, desired, remote,
            changedPath: ['history_months/2026-11', 'session-safe', 'globalDurationStr'] });
        const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
        const original = structuredClone(capsule);
        const first = previewRetiredReplicaConflictResolution(capsule);
        expect(first).toEqual([expect.objectContaining({ kind: 'automatic-candidate',
            entityKind: 'history', entityId: 'session-safe', docPath: 'history_months/2026-11',
            value: expect.objectContaining({ waterLiters: 2, globalDurationStr: '01:10' }),
        })]);
        expect(previewRetiredReplicaConflictResolution(capsule)).toEqual(first);
        expect(capsule).toEqual(original);
    });

    it('rejects an old snapshot, duplicate stage, lost-ACK possibility, wrong owner and stale guard', async () => {
        const baseline = UserDataSchema.parse({ ...data(170), nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 70 },
        } }) as unknown as UserData;
        const desired = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 71 },
        } }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...baseline, nutrition: {
            '2026-11-13': { date: '2026-11-13', weight: 72 },
        } }) as unknown as UserData;
        const { local, cloud } = await competingEntitySources({ baseline, desired, remote,
            changedPath: ['nutrition_months/2026-11', '2026-11-13', 'weight'] });
        const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
        await updateArchiveRecord(owner, () => local);
        const before = await get(storageKey);
        await expect(stageRetiredReplicaConflictCapsule(owner, local, capsule, () => false)).rejects.toThrow();
        expect(await get(storageKey)).toBe(before);
        await updateArchiveRecord<unknown>(owner, raw => ({ ...(raw as object), revision: local.revision + 1 }));
        const raced = await get(storageKey);
        await expect(stageRetiredReplicaConflictCapsule(owner, local, capsule, () => true)).rejects.toThrow();
        expect(await get(storageKey)).toBe(raced);
        await updateArchiveRecord(owner, () => local);
        expect(await stageRetiredReplicaConflictCapsule(owner, local, capsule, () => true)).toBe(1);
        const sealed = await get(storageKey);
        await expect(stageRetiredReplicaConflictCapsule(owner, local, capsule, () => true)).rejects.toThrow();
        expect(await get(storageKey)).toBe(sealed);
        expect(() => parseRetiredReplicaConflictCapsule(capsule, 'user:another')).toThrow();
        expect(() => buildRetiredReplicaConflictCapsule(uid, local, cloud,
            control({ lastSeq: local.pending[0].seq }), catalog)).toThrow();
    });

    it('atomically seals an explicit choice without touching any competing version, journal, or replica', async () => {
        const date = '2026-11-13';
        const initial = UserDataSchema.parse({ ...data(170), nutrition: {
            [date]: { date, weight: 70, sleepHours: '07:00' },
        } }) as unknown as UserData;
        const device = UserDataSchema.parse({ ...initial, nutrition: {
            [date]: { date, weight: 71, sleepHours: '07:00' },
        } }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...initial, nutrition: {
            [date]: { date, weight: 70, sleepHours: '08:00' },
        } }) as unknown as UserData;
        const { local, cloud } = await competingEntitySources({ baseline: initial, desired: device,
            remote, changedPath: ['nutrition_months/2026-11', date, 'sleepHours'] });
        await updateArchiveRecord(owner, () => local);
        const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
        await stageRetiredReplicaConflictCapsule(owner, local, capsule, () => true);
        const before = (await readLocal(owner))!;
        const identity = { kind: 'nutrition' as const, entityId: date };
        const observed = await inspectRetiredReplicaConflictDecisions(owner, legal, expectedFrontier, () => true);
        expect(observed.drafts).toMatchObject([{ kind: 'automatic-candidate' }]);
        expect(observed.decisions).toEqual([]);
        const combined = { ...identity, choice: 'combined' as const };
        expect(await recordRetiredReplicaConflictDecision(owner, before.revision, combined,
            identity, legal, expectedFrontier, () => true)).toBe(before.revision + 1);
        const sealed = await get<string>(storageKey);
        expect(sealed).not.toContain(date);
        expect(sealed).not.toContain('08:00');
        expect(sealed).not.toContain('combined');
        const chosen = (await readLocal(owner))!;
        expect(chosen.retiredReplicaConflictDecisions).toEqual([combined]);
        expect(chosen.retiredReplicaConflictCapsule).toEqual(before.retiredReplicaConflictCapsule);
        expect(chosen.pending).toEqual(before.pending);
        expect(chosen.data).toEqual(before.data);
        expect(chosen.baseline).toEqual(before.baseline);
        expect(chosen.replica).toEqual(before.replica);
        expect(chosen.clock).toEqual(before.clock);
        expect(chosen.actorSeq).toBe(before.actorSeq);

        await expect(recordRetiredReplicaConflictDecision(owner, before.revision,
            { ...identity, choice: 'cloud' }, identity, legal, expectedFrontier, () => true)).rejects.toThrow();
        expect(await get(storageKey)).toBe(sealed);
        await expect(recordRetiredReplicaConflictDecision(owner, chosen.revision,
            { ...identity, choice: 'device' }, identity, legal, expectedFrontier, () => false)).rejects.toThrow();
        expect(await get(storageKey)).toBe(sealed);
        await expect(recordRetiredReplicaConflictDecision(owner, chosen.revision,
            { ...identity, choice: 'device' }, identity, { ...legal, acceptedAt: '2025-01-01' },
            expectedFrontier, () => true)).rejects.toThrow();
        expect(await get(storageKey)).toBe(sealed);

        lockAllVaults();
        const grant = await (await import('../../../src/lib/sync/secureArchiveSession')).unlockVaultForOwner(owner);
        try {
            expect((await inspectRetiredReplicaConflictDecisions(owner, legal, expectedFrontier, () => true)).decisions).toEqual([combined]);
            expect(await recordRetiredReplicaConflictDecision(owner, chosen.revision, null,
                identity, legal, expectedFrontier, () => true)).toBe(chosen.revision + 1);
            expect((await readLocal(owner))!.retiredReplicaConflictDecisions).toEqual([]);
            expect((await readLocal(owner))!.retiredReplicaConflictCapsule).toEqual(capsule);
        } finally { grant.release(); }
    });

    it('rejects forged, duplicate and inapplicable conflict choices before any encrypted write', async () => {
        const date = '2026-11-13';
        const base = UserDataSchema.parse({ ...data(170), nutrition: {
            [date]: { date, weight: 70 },
        } }) as unknown as UserData;
        const mine = UserDataSchema.parse({ ...base, nutrition: { [date]: { date, weight: 71 } } }) as unknown as UserData;
        const remote = UserDataSchema.parse({ ...base, nutrition: { [date]: { date, weight: 72 } } }) as unknown as UserData;
        const { local, cloud } = await competingEntitySources({ baseline: base, desired: mine,
            remote, changedPath: ['nutrition_months/2026-11', date, 'weight'] });
        await updateArchiveRecord(owner, () => local);
        const capsule = buildRetiredReplicaConflictCapsule(uid, local, cloud, control(), catalog);
        await stageRetiredReplicaConflictCapsule(owner, local, capsule, () => true);
        const identity = { kind: 'nutrition' as const, entityId: date };
        const revision = (await readLocal(owner))!.revision;
        const sealed = await get(storageKey);
        const combined = { ...identity, choice: 'combined' as const };
        expect(() => parseRetiredReplicaConflictDecisions([combined], capsule)).toThrow();
        expect(() => parseRetiredReplicaConflictDecisions([
            { ...identity, choice: 'cloud' }, { ...identity, choice: 'device' },
        ], capsule)).toThrow();
        expect(() => parseRetiredReplicaConflictDecisions([
            { ...identity, choice: 'cloud', extra: 'sneaky' },
        ], capsule)).toThrow();
        await expect(recordRetiredReplicaConflictDecision(owner, revision, combined,
            identity, legal, expectedFrontier, () => true)).rejects.toThrow();
        await expect(recordRetiredReplicaConflictDecision(owner, revision,
            { kind: 'nutrition', entityId: '2026-11-14', choice: 'device' },
            { kind: 'nutrition', entityId: '2026-11-14' }, legal, expectedFrontier, () => true)).rejects.toThrow();
        expect(await get(storageKey)).toBe(sealed);
        await updateArchiveRecord<unknown>(owner, raw => ({ ...(raw as object),
            cloudIntegrityFence: 'remote-invalidated',
        }));
        const fenced = await get(storageKey);
        await expect(recordRetiredReplicaConflictDecision(owner, revision, null,
            identity, legal, expectedFrontier, () => true)).rejects.toThrow();
        expect(await get(storageKey)).toBe(fenced);
        await expect(inspectRetiredReplicaConflictDecisions(owner, legal,
            { ...expectedFrontier, fenceEpoch: 6 }, () => true)).rejects.toThrow();
        const persisted = (await readLocal(owner))!;
        expect(() => validateLocalEnvelope({ ...persisted, retiredReplicaConflictDecisions: [
            combined,
        ] }, owner)).toThrow();
    });
});
