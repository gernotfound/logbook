import { LEGAL_VERSIONS } from '../../src/lib/legalVersions';
import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedIdentitySource } from '../../src/lib/sync/authenticatedIdentitySource';
import { registerCrashLocalCases } from './journalCrashLocalCases';
import { registerCrashAcknowledgementCases } from './journalCrashAcknowledgementCases';
import { registerCrashReplayCases } from './journalCrashReplayCases';

const remote = vi.hoisted(() => ({
    apply: vi.fn(),
    auth: { currentUser: { uid: 'a' } as { uid: string } | null },
}));
const catalog = vi.hoisted(() => ({
    exercises: [],
    foods: [],
    manifest: {
        version: 'recovery-test',
        updatedAt: '2026-09-15T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    cachedAt: 0,
}));

vi.mock('../../src/lib/firebase', () => ({
    auth: remote.auth,
    getDb: () => ({}),
    ensureAppCheck: async () => {},
    waitForPendingWrites: async () => {},
}));
// Supply the already verified first account consent (revision 1). The real
// consent authentication/epoch policy and Firestore Rules have separate suites.
vi.mock('../../src/lib/healthConsent', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/healthConsent')>('../../src/lib/healthConsent');
    const writable = (owner: string) => owner === 'user:' + remote.auth.currentUser?.uid;
    return {
        ...actual,
        isHealthConsentWritable: writable,
        isHealthConsentCloudWritable: writable,
        requireHealthConsentWritable: (owner: string) => {
            if (!writable(owner)) throw new Error('Utente non autorizzato dal consenso');
        },
        getVerifiedHealthConsentRevision: () => 1,
    };
});
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => catalog }));
vi.mock('../../src/lib/sync/transactionWriter', () => ({ applyDocumentChanges: remote.apply }));
// Real local journal and crash-recovery remain under test; the independent
// online cloud-key transport is supplied as a verified synthetic capability.
vi.mock('../../src/lib/sync/cloudAccountKeyAccess', () => ({
    requireCloudAccountDataKey: vi.fn(async () => new Uint8Array(32).fill(18)),
}));

import type { UserData } from '../../src/types';
import { UserDataSchema } from '../../src/lib/schema';
import {
    adoptReplicaCheckpoint,
    commitDomainOperations,
    commitLocal,
    hydrateLocal,
    initializeLocal,
    readLocal,
} from '../../src/lib/sync/localRepository';
import { replicateJournal, waitForJournalIdle } from '../../src/lib/sync/replicateJournal';
import { CloudDataIntegrityError } from '../../src/lib/sync/cloudBusinessIntegrity';
import { invalidateSession } from '../../src/lib/sync/session';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../src/lib/sync/secureArchiveRepository';
import {
    applyRemoteDocuments,
    projectDocuments,
    type DocumentData,
} from '../../src/lib/sync/documentProjection';
import {
    applySemanticOperations,
    type SemanticOperation,
    type SyncMeta,
} from '../../src/lib/sync/semanticProjection';

const owner = 'user:a';
const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) }, legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z', privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms } }) as unknown as UserData;

let cloudDocuments: Map<string, DocumentData>;
let cloudSyncMeta: Record<string, SyncMeta>;

function commitRemoteOperations(ops: SemanticOperation[]) {
    const outcome = applySemanticOperations(cloudDocuments, ops, cloudSyncMeta);
    cloudDocuments = outcome.documents;
    cloudSyncMeta = outcome.syncMetas;
    return outcome;
}

function installReplaySafeRemote(afterCommit?: (ops: SemanticOperation[]) => Promise<void> | void) {
    remote.apply.mockImplementation(async (_db: unknown, _uid: string, ops: SemanticOperation[]) => {
        const outcome = commitRemoteOperations(ops);
        await afterCommit?.(ops);
        return outcome;
    });
}

function currentCloudData(): UserData {
    return UserDataSchema.parse(applyRemoteDocuments(data(170), cloudDocuments, catalog)) as unknown as UserData;
}

function cloudDocumentsWithSync(): Map<string, DocumentData> {
    return new Map([...cloudDocuments.entries()].map(([path, document]) => [
        path,
        cloudSyncMeta[path]
            ? { ...structuredClone(document), _sync: structuredClone(cloudSyncMeta[path]) }
            : structuredClone(document),
    ]));
}

function cloudSnapshot(): string {
    const documents = [...cloudDocuments.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, document]) => [path, document]);
    const sync = Object.fromEntries(Object.entries(cloudSyncMeta).sort(([left], [right]) => left.localeCompare(right)));
    return JSON.stringify({ documents, sync });
}

// Arm only after the remote adapter has committed the delivered batch.
// The journal's exact owner/key selects the ACK write; unrelated IDB writes
// and harmless changes to the preparation path cannot consume this fault.
function failNextOwnerEnvelopeWrite() {
    const nativePut = IDBObjectStore.prototype.put;
    let hit = false;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore, value: unknown, key?: IDBValidKey,
    ) {
        if (!hit && this.name === 'keyval' && key === 'logbook:v2:' + owner
            && this.transaction.mode === 'readwrite') {
            hit = true;
            throw new DOMException('Injected acknowledgement failure', 'UnknownError');
        }
        return nativePut.call(this, value, key);
    });
    return { get hit() { return hit; }, restore: () => { put.mockRestore(); } };
}

beforeEach(() => authenticatedIdentitySource.install(() => remote.auth.currentUser));
beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    localStorage.setItem('logbook:v2:' + owner + ':health-consent-generation', '1');
    await clear();
    invalidateSession();
    vi.stubGlobal('navigator', { onLine: true, locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    remote.auth.currentUser = { uid: 'a' };
    remote.apply.mockReset();
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
    expect(await get('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
    const now = Date.now();
    await adoptReplicaCheckpoint(owner, {
        identity: {
            slot: 's00', replicaId: 'recovery-replica', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000,
        },
        baseSeq: 0,
    }, { clock: {}, syncMetaByDocument: {} });
    expect((await readLocal(owner))?.consentRevision).toBe(1);
    cloudDocuments = projectDocuments(data(170), catalog);
    cloudSyncMeta = {};
});

afterEach(async () => {
    await waitForJournalIdle(owner);
    lockAllVaults();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function createCrashSuiteContext() {
    return {
        owner, data, remote, installReplaySafeRemote, currentCloudData,
        cloudDocumentsWithSync, cloudSnapshot, failNextOwnerEnvelopeWrite,
        commitRemoteOperations, commitLocal, commitDomainOperations, hydrateLocal,
        readLocal, replicateJournal, waitForJournalIdle, invalidateSession,
        updateArchiveRecord, CloudDataIntegrityError,
    };
}

export type CrashSuiteContext = ReturnType<typeof createCrashSuiteContext>;

describe('M3 journal crash consistency', () => {
    const context = createCrashSuiteContext();
    registerCrashLocalCases(context);
    registerCrashAcknowledgementCases(context);
    registerCrashReplayCases(context);
});
