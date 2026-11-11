import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import 'fake-indexeddb/auto';
import { clear, del, get } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const catalogReader = vi.hoisted(() => ({ read: vi.fn() }));
const remote = vi.hoisted(() => ({ apply: vi.fn(), appCheck: vi.fn(), pendingWrites: vi.fn(), auth: { currentUser: { uid: 'a' } } }));
vi.mock('../../../src/lib/firebase', () => ({ auth: remote.auth, getDb: () => ({}), ensureAppCheck: () => remote.appCheck(), waitForPendingWrites: () => remote.pendingWrites() }));
// Isolate server consent transport with a verified active revision. The durable
// generation and session fences remain real for delayed-ACK interleavings.
vi.mock('../../../src/lib/healthConsent', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/healthConsent')>('../../../src/lib/healthConsent');
    const writable = (owner: string) => owner.startsWith('user:')
        ? owner === 'user:' + remote.auth.currentUser?.uid
        : actual.isHealthConsentWritable(owner);
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
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogReader.read }));
vi.mock('../../../src/lib/sync/transactionWriter', () => ({ applyDocumentChanges: remote.apply }));
// Delayed-ACK tests use the real journal but isolate the independent online key transport.
vi.mock('../../../src/lib/sync/cloudAccountKeyAccess', () => ({
    requireCloudAccountDataKey: vi.fn(async () => new Uint8Array(32).fill(18)),
}));

import { projectDocuments } from '../../../src/lib/sync/documentProjection';
import { applySemanticOperations } from '../../../src/lib/sync/semanticProjection';
import { markAccountDeletion, clearAccountDeletion } from '../../../src/lib/sync/accountGate';
import { replicateJournal, waitForJournalIdle } from '../../../src/lib/sync/replicateJournal';
import { acknowledgeThrough, adoptReplicaCheckpoint, initializeLocal, commitLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../../src/lib/schema';
import { invalidateSession } from '../../../src/lib/sync/session';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import type { CachedGlobalCatalog, UserData } from '../../../src/types';

const catalog: CachedGlobalCatalog = {
    manifest: { version: 'ack-tests', updatedAt: '2026-11-03T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};
const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) }, legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z', privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms } }) as unknown as UserData;
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (err: any) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

beforeEach(async () => {
    catalogReader.read.mockReset().mockResolvedValue(catalog);
    lockAllVaults();
    localStorage.clear();
    localStorage.setItem('logbook:v2:user:a:health-consent-generation', '1');
    vi.stubGlobal('navigator', { onLine: true, locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    invalidateSession();
    await clear();
    remote.auth.currentUser = { uid: 'a' }; remote.apply.mockReset();
    remote.appCheck.mockReset().mockResolvedValue(undefined);
    remote.pendingWrites.mockReset().mockResolvedValue(undefined);
    await createAndMigrateVault('user:a');
    await initializeLocal('user:a', data(170));
    const now = Date.now();
    await adoptReplicaCheckpoint('user:a', {
        identity: {
            slot: 's00',
            replicaId: 'replica-a',
            generation: 1,
            checkpointAtMs: now,
            leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        },
        baseSeq: 0,
    }, { clock: {}, syncMetaByDocument: {} });
    await commitLocal('user:a', data(171), data(170));
    expect(await get('logbook:v2:user:a')).toMatch(/^tlb-sealed:v1:/);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { vi.useRealTimers(); lockAllVaults(); vi.unstubAllGlobals(); });

it('keeps the account journal pending when consent is missing, without starting a remote write', async () => {
    await commitLocal('user:a', { ...data(171), legalConsent: undefined }, data(171));
    const before = await readLocal('user:a');
    expect(before?.pending.length).toBeGreaterThan(0);

    const result = await replicateJournal();
    expect(result.status).toBe('local-pending');
    if (result.ok) throw new Error('La replica senza consenso non doveva riuscire.');
    expect(result.error).toMatchObject({ code: 'legal-consent-required' });
    expect(remote.apply).not.toHaveBeenCalled();

    const after = await readLocal('user:a');
    expect(after?.pending).toEqual(before?.pending);
});

it('does not report a stale empty journal as synced after an A→B→A Auth transition during its IndexedDB read', async () => {
    const delivered = (await readLocal('user:a'))!;
    await acknowledgeThrough('user:a', delivered.actorSeq, data(171), [], undefined, {
        operations: structuredClone(delivered.pending), replica: delivered.replica!,
    });
    const before = await readLocal('user:a');
    const ciphertext = await get('logbook:v2:user:a');
    expect(before?.pending).toHaveLength(0);

    const originalGet = IDBObjectStore.prototype.get;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
        const request = originalGet.call(this, key);
        if (key === 'logbook:v2:user:a') {
            request.addEventListener('success', () => {
                spy.mockRestore();
                remote.auth.currentUser = { uid: 'b' }; invalidateSession();
                remote.auth.currentUser = { uid: 'a' }; invalidateSession();
            }, { once: true });
        }
        return request;
    });
    try {
        const result = await replicateJournal();
        expect(result.status).toBe('failed');
        expect(remote.apply).not.toHaveBeenCalled();
        expect(await readLocal('user:a')).toEqual(before);
        expect(await get('logbook:v2:user:a')).toEqual(ciphertext);
    } finally {
        spy.mockRestore();
    }
});

it('retains one writer after timeout and acknowledges its late commit before retrying', async () => {
    const completion = deferred<any>();
    remote.apply.mockReturnValue(completion.promise);
    const first = replicateJournal();
    
    // Allow the microtasks to process so runTransaction starts
    await vi.waitFor(() => expect(remote.apply).toHaveBeenCalledTimes(1));
    
    // Simulate timeout
    await vi.advanceTimersByTimeAsync(7001);
    expect((await first).status).toBe('local-pending');
    expect((await readLocal('user:a'))?.pending).toHaveLength(1);
    
    const retry = replicateJournal();
    await vi.advanceTimersByTimeAsync(50);
    expect(remote.apply).toHaveBeenCalledTimes(1); // Still 1 because late commit is blocking
    
    // Resolve the late commit
    completion.resolve({ documents: new Map(), syncMeta: {} });
    await waitForJournalIdle('user:a');
    
    expect((await retry).status).toBe('synced');
    expect((await readLocal('user:a'))?.pending).toHaveLength(0);
    expect(remote.apply).toHaveBeenCalledTimes(1);
});

it('keeps a queued epoch retry pending when the prior writer has a different delivered batch', async () => {
    const stalled = deferred<any>();
    remote.apply.mockReturnValueOnce(stalled.promise)
        .mockRejectedValueOnce(Object.assign(new Error('Injected transient failure'), { code: 'unavailable' }));
    const previousEpoch = replicateJournal();
    await vi.waitFor(() => expect(remote.apply).toHaveBeenCalledTimes(1));

    // A checkpoint can rebase the same owner journal onto a new replica while
    // the old remote write is still in flight. The new attempt is queued.
    invalidateSession();
    const now = Date.now();
    await adoptReplicaCheckpoint('user:a', {
        identity: {
            slot: 's01',
            replicaId: 'replica-b',
            generation: 1,
            checkpointAtMs: now,
            leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        },
        baseSeq: 0,
    }, { clock: {}, syncMetaByDocument: {} });
    const rebased = await readLocal('user:a');
    expect(rebased?.pending.length).toBeGreaterThan(0);
    expect(rebased?.pending.every(operation => operation.actorId === 's01')).toBe(true);
    const ciphertext = await get('logbook:v2:user:a');

    const queuedEpoch = replicateJournal();
    await vi.advanceTimersByTimeAsync(7001);

    expect((await previousEpoch).status).toBe('failed');
    // The queued epoch has delivered nothing yet. Its valid s01 journal must
    // not be tested against the old s00 delivery and classified as lost.
    expect((await queuedEpoch).status).toBe('local-pending');
    expect(await get('logbook:v2:user:a')).toEqual(ciphertext);

    stalled.reject(new Error('Previous session expired'));
    await waitForJournalIdle('user:a');
    expect(remote.apply).toHaveBeenCalledTimes(2);
    expect((await readLocal('user:a'))?.pending).toEqual(rebased?.pending);
});

it('hard-fails a timeout when the in-flight delivered batch is no longer durable', async () => {
    const completion = deferred<any>();
    remote.apply.mockReturnValue(completion.promise);
    const first = replicateJournal();

    await vi.waitFor(() => expect(remote.apply).toHaveBeenCalledTimes(1));
    // Lose only the owner envelope while retaining the current vault and its control mirror.
    await del('logbook:v2:user:a');

    await vi.advanceTimersByTimeAsync(7001);
    expect((await first).status).toBe('failed');

    completion.resolve({ documents: new Map(), syncMeta: {} });
    await waitForJournalIdle('user:a');
});

it('does not acknowledge a late result after A to B to A even though the uid matches again', async () => {
    const completion = deferred<any>();
    remote.apply.mockReturnValue(completion.promise);
    const first = replicateJournal();
    await vi.waitFor(() => expect(remote.apply).toHaveBeenCalledTimes(1));
    
    remote.auth.currentUser = { uid: 'b' }; invalidateSession();
    remote.auth.currentUser = { uid: 'a' }; invalidateSession();
    
    completion.resolve({ documents: new Map(), syncMeta: {} });
    await waitForJournalIdle('user:a');
    
    expect((await first).status).toBe('failed');
    expect((await readLocal('user:a'))?.pending).toHaveLength(1);
});

it.each(['app-check', 'pending-writes'] as const)(
    'rejects a retryable %s preflight error from an obsolete A→B→A Auth epoch', async boundary => {
        const before = await readLocal('user:a');
        const ciphertext = await get('logbook:v2:user:a');
        const obsoleteNetworkFailure = async () => {
            remote.auth.currentUser = { uid: 'b' }; invalidateSession();
            remote.auth.currentUser = { uid: 'a' }; invalidateSession();
            throw Object.assign(new Error('Transient network failure after session switch'), { code: 'unavailable' });
        };
        if (boundary === 'app-check') remote.appCheck.mockImplementationOnce(obsoleteNetworkFailure);
        else remote.pendingWrites.mockImplementationOnce(obsoleteNetworkFailure);

        const result = await replicateJournal();
        expect(result.status).toBe('failed');
        expect(remote.apply).not.toHaveBeenCalled();
        expect(await get('logbook:v2:user:a')).toEqual(ciphertext);
        expect(await readLocal('user:a')).toEqual(before);
    },
);

it.each([
    ['catalog', 'owner-roundtrip'],
    ['catalog', 'consent-generation'],
    ['catalog', 'account-deletion'],
    ['indexeddb', 'owner-roundtrip'],
    ['indexeddb', 'consent-generation'],
    ['indexeddb', 'account-deletion'],
] as const)('preserves the exact journal when %s waits across %s before ACK, then recovers', async (boundary, change) => {
    const completion = deferred<Awaited<ReturnType<typeof remote.apply>>>();
    remote.apply.mockReturnValueOnce(completion.promise);
    const first = replicateJournal();
    await vi.waitFor(() => expect(remote.apply).toHaveBeenCalledTimes(1));

    const before = await readLocal('user:a');
    const ciphertext = await get('logbook:v2:user:a');
    expect(before?.pending).toHaveLength(1);
    // The cloud collaborator returns a coherent semantic outcome, including
    // an independent remote change. IndexedDB, AEAD and the ACK path are real.
    const base = data(170);
    base.profile!.neck = '39';
    const { documents, syncMetas } = applySemanticOperations(
        projectDocuments(base, catalog), before!.pending,
    );
    const outcome = { documents, syncMeta: syncMetas };
    let invalidated = false;
    const invalidate = () => {
        invalidated = true;
        if (change === 'owner-roundtrip') {
            remote.auth.currentUser = { uid: 'b' }; invalidateSession();
            remote.auth.currentUser = { uid: 'a' }; invalidateSession();
        } else if (change === 'consent-generation') {
            localStorage.setItem('logbook:v2:user:a:health-consent-generation', '2');
        } else {
            markAccountDeletion('user:a');
        }
    };

    if (boundary === 'catalog') {
        const catalogWait = deferred<CachedGlobalCatalog>();
        const entered = deferred<void>();
        catalogReader.read.mockImplementationOnce(() => {
            entered.resolve();
            return catalogWait.promise;
        });
        completion.resolve(outcome);
        await entered.promise;
        invalidate();
        catalogWait.resolve(catalog);
    } else {
        // Invalidate after updateArchiveRecord has dispatched its IDB read,
        // just before the synchronous update callback. An earlier check alone
        // cannot protect this interleaving.
        catalogReader.read.mockImplementationOnce(async () => {
            const originalGet = IDBObjectStore.prototype.get;
            const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
                const request = originalGet.call(this, key);
                if (key === 'logbook:v2:user:a') {
                    request.addEventListener('success', () => {
                        spy.mockRestore();
                        invalidate();
                    }, { once: true });
                }
                return request;
            });
            return catalog;
        });
        completion.resolve(outcome);
    }

    await waitForJournalIdle('user:a');
    expect((await first).status).toBe('failed');
    expect(invalidated).toBe(true);
    expect(await get('logbook:v2:user:a')).toEqual(ciphertext);
    expect(await readLocal('user:a')).toEqual(before);

    clearAccountDeletion('user:a');
    localStorage.setItem('logbook:v2:user:a:health-consent-generation', '1');
    invalidateSession();
    remote.apply.mockResolvedValueOnce(outcome);
    expect((await replicateJournal()).status).toBe('synced');
    expect(remote.apply).toHaveBeenCalledTimes(2);
    const recovered = await readLocal('user:a');
    expect(recovered?.pending).toEqual([]);
    expect(recovered?.data.profile?.height).toBe('171');
    expect(recovered?.data.profile?.neck).toBe('39');
    expect(recovered?.baseline.profile).toEqual(recovered?.data.profile);
});
