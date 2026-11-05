import 'fake-indexeddb/auto';
import { clear, del, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { LocalEnvelope } from '../../src/lib/sync/localEnvelopeValidation';
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
const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) }, legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z', privacyVersion: '1.3.5', termsVersion: '1.2.1' } }) as unknown as UserData;

let cloudDocuments: Map<string, DocumentData>;
let cloudSyncMeta: Record<string, SyncMeta>;

function installReplaySafeRemote(afterCommit?: (ops: SemanticOperation[]) => Promise<void> | void) {
    remote.apply.mockImplementation(async (_db: unknown, _uid: string, ops: SemanticOperation[]) => {
        const outcome = applySemanticOperations(cloudDocuments, ops, cloudSyncMeta);
        cloudDocuments = outcome.documents;
        cloudSyncMeta = outcome.syncMetas;
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

describe('M3 journal crash consistency', () => {
    it.each([
        { key: '%70rofile/height', deleteClock: { s01: 2 } },
        { key: 'profile/height', deleteClock: {} },
    ])('preserves pending data on invalid cloud field metadata: %j', async ({ key, deleteClock }) => {
        await commitLocal(owner, data(171), data(170));
        const before = await readLocal(owner);
        expect(before?.pending.length).toBeGreaterThan(0);
        const storedBefore = await get('logbook:v2:' + owner);
        const malformed = cloudDocumentsWithSync();
        malformed.set('', {
            ...(malformed.get('') ?? {}),
            _sync: {
                protocolVersion: 3, clock: { s01: 2 },
                fields: { [key]: {
                    actorId: 's01', seq: 2, clock: { s01: 2 }, deleted: true, deleteClock,
                } },
            },
        });
        await expect(hydrateLocal(owner, data(170), [], malformed)).rejects.toMatchObject({
            code: 'invalid-cloud-sync-metadata', documentPath: '',
        });
        expect(await get('logbook:v2:' + owner)).toEqual(storedBefore);
        expect(await readLocal(owner)).toEqual(before);
        installReplaySafeRemote();
        expect(await replicateJournal()).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('classifies malformed cloud sync metadata and preserves the durable local envelope', async () => {
        const before = await readLocal(owner);
        const malformedCloudDocuments = cloudDocumentsWithSync();
        malformedCloudDocuments.set('', {
            ...(malformedCloudDocuments.get('') ?? {}),
            _sync: { protocolVersion: 1, clock: { broken: -1 }, fields: {} },
        });

        await expect(
            hydrateLocal(owner, data(170), [], malformedCloudDocuments),
        ).rejects.toMatchObject({
            code: 'invalid-cloud-sync-metadata',
            documentPath: '',
        });

        const after = await readLocal(owner);
        expect(after?.data).toEqual(before?.data);
        expect(after?.baseline).toEqual(before?.baseline);
        expect(after?.pending).toEqual(before?.pending);
        expect(after?.clock).toEqual(before?.clock);
    });

    it('recovers a durable local commit after a new session epoch before any remote delivery', async () => {
        await commitLocal(owner, data(171), data(170));
        const beforeRestart = await readLocal(owner);
        expect(beforeRestart?.data.profile?.height).toBe('171');
        expect(beforeRestart?.pending.length).toBeGreaterThan(0);

        invalidateSession();
        installReplaySafeRemote();

        const result = await replicateJournal();
        expect(result).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect((await readLocal(owner))?.data.profile?.height).toBe('171');
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('keeps the old durable state when the local transaction fails before journaling', async () => {
        const before = await readLocal(owner);
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('Injected local commit failure', 'QuotaExceededError');
        });

        await expect(commitLocal(owner, data(171), data(170))).rejects.toThrow('Injected local commit failure');
        put.mockRestore();

        expect(await readLocal(owner)).toEqual(before);
        expect(remote.apply).not.toHaveBeenCalled();
    });

    it('keeps the entire M8 envelope unchanged when IndexedDB aborts asynchronously after put is queued', async () => {
        const before = await readLocal(owner);
        const originalPut = IDBObjectStore.prototype.put;
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, ...args: any[]) {
            const request = (originalPut as any).apply(this, args);
            queueMicrotask(() => {
                try { this.transaction.abort(); } catch { /* transaction may already be inactive */ }
            });
            return request;
        } as any);

        await expect(commitDomainOperations(
            owner,
            { type: 'profile.patch', patch: { height: '171' } },
            data(170),
        )).rejects.toBeDefined();
        put.mockRestore();

        expect(await readLocal(owner)).toEqual(before);
        expect(remote.apply).not.toHaveBeenCalled();
    });

    it('retains and idempotently replays the journal when remote commit succeeds but local acknowledgement fails', async () => {
        await commitLocal(owner, data(171), data(170));
        let fault: ReturnType<typeof failNextOwnerEnvelopeWrite> | undefined;
        installReplaySafeRemote(() => { fault ??= failNextOwnerEnvelopeWrite(); });

        try {
            const first = await replicateJournal();
            expect(first).toMatchObject({ ok: false, status: 'local-pending' });
            await waitForJournalIdle(owner);
            expect(fault?.hit).toBe(true);
            expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('170');
            expect(currentCloudData().profile?.height).toBe('171');
        } finally {
            fault?.restore();
        }
        const committedCloud = cloudSnapshot();

        invalidateSession();
        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect(remote.apply).toHaveBeenCalledTimes(2);
        expect(cloudSnapshot()).toBe(committedCloud);
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect((await readLocal(owner))?.data.profile?.height).toBe('171');
    });

    it('keeps a post-commit acknowledgement error hard-failed when the local journal is no longer durable', async () => {
        await commitLocal(owner, data(171), data(170));
        installReplaySafeRemote(async () => {
            await del('logbook:v2:' + owner);
        });

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect(await readLocal(owner)).toBeUndefined();
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('requires a durable exact batch when the remote commit succeeds but its response is lost', async () => {
        await commitLocal(owner, data(171), data(170));
        remote.apply.mockImplementationOnce(async (_db: unknown, _uid: string, ops: SemanticOperation[]) => {
            const outcome = applySemanticOperations(cloudDocuments, ops, cloudSyncMeta);
            cloudDocuments = outcome.documents;
            cloudSyncMeta = outcome.syncMetas;
            throw Object.assign(new Error('Injected lost remote response'), { code: 'unavailable' });
        });

        const first = await replicateJournal();

        expect(first.status).toBe('local-pending');
        const committedCloud = cloudSnapshot();
        expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);

        installReplaySafeRemote();
        invalidateSession();
        const retry = await replicateJournal();

        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect(cloudSnapshot()).toBe(committedCloud);
        expect((await readLocal(owner))?.pending).toEqual([]);
    });

    it('hard-fails a lost remote response when the delivered batch is no longer durable', async () => {
        await commitLocal(owner, data(171), data(170));
        remote.apply.mockImplementationOnce(async (_db: unknown, _uid: string, ops: SemanticOperation[]) => {
            const outcome = applySemanticOperations(cloudDocuments, ops, cloudSyncMeta);
            cloudDocuments = outcome.documents;
            cloudSyncMeta = outcome.syncMetas;
            await del('logbook:v2:' + owner);
            throw Object.assign(new Error('Injected lost remote response'), { code: 'unavailable' });
        });

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect(await readLocal(owner)).toBeUndefined();
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('fails closed when a current-version envelope loses its journal field', async () => {
        await commitLocal(owner, data(171), data(170));
        const before = (await readLocal(owner))!;
        await updateArchiveRecord<LocalEnvelope>(owner, () => {
            const invalid = structuredClone(before);
            delete (invalid as Partial<LocalEnvelope>).pending;
            return invalid;
        });
        const encrypted = await get('logbook:v2:' + owner);
        expect(encrypted).toMatch(/^tlb-sealed:v1:/);

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect(await get('logbook:v2:' + owner)).toEqual(encrypted);
    });

    it('rejects an acknowledgement whose durable operation payload no longer matches the delivered batch', async () => {
        await commitLocal(owner, data(171), data(170));
        let changedCiphertext: unknown;
        installReplaySafeRemote(async () => {
            await updateArchiveRecord<LocalEnvelope>(owner, current => {
                if (!current) throw new Error('Expected durable journal');
                const changed = structuredClone(current);
                changed.pending[0] = { ...changed.pending[0], value: 'corrupted-after-delivery' };
                return changed;
            });
            changedCiphertext = await get('logbook:v2:' + owner);
        });

        const result = await replicateJournal();

        expect(result).toMatchObject({
            ok: false, status: 'failed',
            error: {
                name: 'UnsafeDeliveredBatchError',
                cause: { message: 'Acknowledgement invalidato: replica o batch locale cambiati; journal preservato.' },
            },
        });
        expect(changedCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(await get('logbook:v2:' + owner)).toBe(changedCiphertext);
        const retained = await readLocal(owner);
        expect(retained?.pending).toHaveLength(1);
        expect(retained?.pending[0].value).toBe('corrupted-after-delivery');
        expect(retained?.baseline.profile?.height).toBe('170');
        expect(retained?.data.profile?.height).toBe('171');
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('preserves a newer local edit created between remote commit and acknowledgement', async () => {
        await commitLocal(owner, data(171), data(170));
        let injected = false;
        installReplaySafeRemote(async () => {
            if (injected) return;
            injected = true;
            await commitLocal(owner, data(172), data(171));
        });

        const result = await replicateJournal();

        expect(result).toMatchObject({ ok: true, status: 'synced' });
        expect(remote.apply).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect((await readLocal(owner))?.data.profile?.height).toBe('172');
        expect(currentCloudData().profile?.height).toBe('172');
    });

    it('rehydrates safely after remote commit with a lost acknowledgement, then clears the replayed journal', async () => {
        await commitLocal(owner, data(171), data(170));
        let fault: ReturnType<typeof failNextOwnerEnvelopeWrite> | undefined;
        installReplaySafeRemote(() => { fault ??= failNextOwnerEnvelopeWrite(); });
        try {
            const first = await replicateJournal();
            expect(first).toMatchObject({ ok: false, status: 'local-pending' });
            await waitForJournalIdle(owner);
            expect(fault?.hit).toBe(true);
            expect(currentCloudData().profile?.height).toBe('171');
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('170');
        } finally {
            fault?.restore();
        }

        const committedCloud = cloudSnapshot();
        invalidateSession();
        const hydrated = await hydrateLocal(owner, currentCloudData(), [], cloudDocumentsWithSync());
        expect(hydrated.data.profile?.height).toBe('171');
        expect(hydrated.pending.length).toBeGreaterThan(0);

        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect(cloudSnapshot()).toBe(committedCloud);
        expect((await readLocal(owner))?.pending).toEqual([]);
    });

    it('recovers offline activity journal entries without losing steps or keyed cardio sessions', async () => {
        await commitDomainOperations(owner, [
            { type: 'activity-steps.set', date: '2026-09-24', steps: 11000, source: 'manual', capturedAt: 100 },
            { type: 'cardio-session.upsert', date: '2026-09-24', session: { id: 'cardio-a', modality: 'bike', durationMinutes: 40, intensity: 'moderate', source: 'manual' } },
        ], data(170));
        const unavailable = Object.assign(new Error('Injected remote outage'), { code: 'unavailable' });
        remote.apply.mockRejectedValueOnce(unavailable);

        const first = await replicateJournal();
        expect(first.status).toBe('local-pending');
        expect((await readLocal(owner))?.data.nutrition?.['2026-09-24']).toMatchObject({ steps: 11000, cardioSessions: [{ id: 'cardio-a', durationMinutes: 40 }] });

        installReplaySafeRemote();
        invalidateSession();
        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect(currentCloudData().nutrition?.['2026-09-24']).toMatchObject({ steps: 11000, cardioSessions: [{ id: 'cardio-a', durationMinutes: 40 }] });
    });

    it('does not acknowledge a writer integrity rejection and retains the encrypted journal for recovery', async () => {
        await commitLocal(owner, data(171), data(170));
        const before = await readLocal(owner);
        const ciphertext = await get('logbook:v2:' + owner);
        const initialCloud = cloudSnapshot();
        const integrityError = new CloudDataIntegrityError('', ['profile', 'height']);
        remote.apply.mockRejectedValueOnce(integrityError);

        const result = await replicateJournal();
        await waitForJournalIdle(owner);

        expect(result).toMatchObject({ ok: false, status: 'failed', error: integrityError });
        expect(remote.apply).toHaveBeenCalledTimes(1);
        expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
        expect(await readLocal(owner)).toEqual(before);
        expect(before?.pending.length).toBeGreaterThan(0);
        expect(cloudSnapshot()).toBe(initialCloud);

        installReplaySafeRemote();
        invalidateSession();
        expect(await replicateJournal()).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('leaves cloud untouched and journal durable when the remote fails before commit, then converges on retry', async () => {
        await commitLocal(owner, data(171), data(170));
        const initialCloud = cloudSnapshot();
        const unavailable = Object.assign(new Error('Injected remote outage'), { code: 'unavailable' });
        remote.apply.mockRejectedValueOnce(unavailable);

        const first = await replicateJournal();
        expect(first.status).toBe('local-pending');
        expect(cloudSnapshot()).toBe(initialCloud);
        expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);

        installReplaySafeRemote();
        invalidateSession();
        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect(currentCloudData().profile?.height).toBe('171');
    });
});
