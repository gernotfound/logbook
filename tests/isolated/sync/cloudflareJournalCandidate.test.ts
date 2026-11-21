import 'fake-indexeddb/auto';
import { registerCandidateJournalDeliveryCases } from './candidateJournalDeliveryCases';
import { registerCandidateJournalRebaseCases } from './candidateJournalRebaseCases';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { CachedGlobalCatalog, UserData } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { deliverCloudflareJournalCandidate } from '../../../src/lib/sync/cloudflareJournalCandidate';
import { stageCloudflareDelivery } from '../../../src/lib/sync/cloudReplicaDurableDelivery';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { readAccountCloudDocument } from '../../../src/lib/sync/cloudDocumentRead';
import { parseSyncMeta } from '../../../src/lib/sync/semanticProjection';
import { CloudReplicaTransportError } from '../../../src/lib/sync/cloudReplicaTransport';
import type {
    CloudReplicaBatch, CloudReplicaCommitOutcome, CloudReplicaCompleteScan, CloudReplicaControlSnapshot, CloudReplicaSnapshot,
} from '../../../src/lib/sync/cloudReplicaTransport';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
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
        scanAll: vi.fn(async (): Promise<CloudReplicaCompleteScan> => ({
            revision: control.revision, fenceEpoch: control.fenceEpoch,
            consentRevision: control.consentRevision, documents: [],
        })),
        commitOutcome: vi.fn(async (_batch: CloudReplicaBatch, _csrf: string): Promise<CloudReplicaCommitOutcome> => ({
            outcome: 'inconclusive', currentRevision: control.revision,
        })),
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

async function savedDelivery() {
    const setup = await seed();
    await stageCloudflareDelivery(owner, setup.local.pending, setup.snapshot, setup.control,
        setup.replica, 'batch000000009911', adk, () => true);
    return setup;
}

function changedRemote(setup: Awaited<ReturnType<typeof seed>>) {
    const now = Date.now();
    const control: CloudReplicaControlSnapshot = {
        ...setup.control, revision: 2,
        replicas: {
            ...setup.control.replicas,
            s01: {
                replicaId: 'other-cloud-writer', generation: 1, status: 'active',
                lastSeq: 1, checkpointClock: { s01: 1 }, checkpointAtMs: now,
                leaseUntilMs: now + 86400000,
            },
        },
    };
    const remoteDocument = sealCloudDocument(adk, owner.slice(5), '', {
        profile: { height: '168' },
    }, {
        protocolVersion: 3, clock: { s01: 1 }, fields: {},
        writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
            seq: 1, consentRevision: 1 },
    });
    const scan: CloudReplicaCompleteScan = {
        revision: 2, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision: 2, document: remoteDocument }],
    };
    return { control, scan };
}


const context = {
    owner, storeKey, adk, profile, seed, transport, savedDelivery, changedRemote,
    deliverCloudflareJournalCandidate, stageCloudflareDelivery,
    CloudReplicaTransportError, updateArchiveRecord, readLocal, commitLocal,
    initializeLocal, readAccountCloudDocument, parseSyncMeta, sealCloudDocument,
};
export type CandidateJournalTestContext = typeof context;

describe('isolated CF-04 journal orchestrator', () => {
    registerCandidateJournalDeliveryCases(context);
    registerCandidateJournalRebaseCases(context);
});
