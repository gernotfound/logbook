import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const remote = vi.hoisted(() => ({
    apply: vi.fn(),
    auth: { currentUser: { uid: 'a' } as { uid: string } | null },
}));
const catalog = vi.hoisted(() => ({ exercises: [], foods: [] }));

vi.mock('../../src/lib/firebase', () => ({
    auth: remote.auth,
    getDb: () => ({}),
    ensureAppCheck: async () => {},
    waitForPendingWrites: async () => {},
}));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => catalog }));
vi.mock('../../src/lib/sync/transactionWriter', () => ({ applyDocumentChanges: remote.apply }));

import type { UserData } from '../../src/types';
import { UserDataSchema } from '../../src/lib/schema';
import {
    commitDomainOperations,
    commitLocal,
    hydrateLocal,
    initializeLocal,
    readLocal,
} from '../../src/lib/sync/localRepository';
import { replicateJournal, waitForJournalIdle } from '../../src/lib/sync/replicateJournal';
import { invalidateSession } from '../../src/lib/sync/session';
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
const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

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

beforeEach(async () => {
    vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(() => null),
        length: 0,
    });
    await clear();
    invalidateSession();
    vi.stubGlobal('navigator', { onLine: true });
    remote.auth.currentUser = { uid: 'a' };
    remote.apply.mockReset();
    await initializeLocal(owner, data(170));
    cloudDocuments = projectDocuments(data(170), catalog);
    cloudSyncMeta = {};
});

afterEach(async () => {
    await waitForJournalIdle(owner);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('M3 journal crash consistency', () => {
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
        expect(beforeRestart?.data.profile.height).toBe('171');
        expect(beforeRestart?.pending.length).toBeGreaterThan(0);

        invalidateSession();
        installReplaySafeRemote();

        const result = await replicateJournal();
        expect(result).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect((await readLocal(owner))?.data.profile.height).toBe('171');
        expect(currentCloudData().profile.height).toBe('171');
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
        installReplaySafeRemote();

        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('Injected acknowledgement failure', 'UnknownError');
        });

        const first = await replicateJournal();
        expect(first).toMatchObject({ ok: false, status: 'local-pending' });
        await waitForJournalIdle(owner);
        expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);
        const committedCloud = cloudSnapshot();
        put.mockRestore();

        invalidateSession();
        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect(remote.apply).toHaveBeenCalledTimes(2);
        expect(cloudSnapshot()).toBe(committedCloud);
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect((await readLocal(owner))?.data.profile.height).toBe('171');
    });

    it('keeps a post-commit acknowledgement error hard-failed when the local journal is no longer durable', async () => {
        await commitLocal(owner, data(171), data(170));
        installReplaySafeRemote(async () => {
            await clear();
        });

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect(await readLocal(owner)).toBeUndefined();
        expect(currentCloudData().profile.height).toBe('171');
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
            await clear();
            throw Object.assign(new Error('Injected lost remote response'), { code: 'unavailable' });
        });

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect(await readLocal(owner)).toBeUndefined();
        expect(currentCloudData().profile.height).toBe('171');
    });

    it('fails closed when a current-version envelope loses its journal field', async () => {
        await commitLocal(owner, data(171), data(170));
        const raw = await get<any>('logbook:v2:user:a');
        delete raw.pending;
        await set('logbook:v2:user:a', raw);

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect((await get<any>('logbook:v2:user:a')).pending).toBeUndefined();
    });

    it('hard-fails a lost acknowledgement when the retained operation payload changed', async () => {
        await commitLocal(owner, data(171), data(170));
        installReplaySafeRemote(async () => {
            const raw = await get<any>('logbook:v2:user:a');
            raw.pending[0] = { ...raw.pending[0], value: 'corrupted-after-delivery' };
            await set('logbook:v2:user:a', raw);
        });

        const originalPut = IDBObjectStore.prototype.put;
        let putCount = 0;
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: any[]) {
            putCount += 1;
            if (putCount === 2) throw new DOMException('Injected acknowledgement failure', 'UnknownError');
            return (originalPut as any).apply(this, args);
        } as any);

        const result = await replicateJournal();
        put.mockRestore();

        expect(result.status).toBe('failed');
        const retained = await readLocal(owner);
        expect(retained?.pending).toHaveLength(1);
        expect(retained?.pending[0].value).toBe('corrupted-after-delivery');
        expect(currentCloudData().profile.height).toBe('171');
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
        expect((await readLocal(owner))?.data.profile.height).toBe('172');
        expect(currentCloudData().profile.height).toBe('172');
    });

    it('rehydrates safely after remote commit with a lost acknowledgement, then clears the replayed journal', async () => {
        await commitLocal(owner, data(171), data(170));
        installReplaySafeRemote();

        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('Injected acknowledgement failure', 'UnknownError');
        });
        const first = await replicateJournal();
        expect(first).toMatchObject({ ok: false, status: 'local-pending' });
        await waitForJournalIdle(owner);
        put.mockRestore();

        const committedCloud = cloudSnapshot();
        invalidateSession();
        const hydrated = await hydrateLocal(owner, currentCloudData(), [], cloudDocumentsWithSync());
        expect(hydrated.data.profile.height).toBe('171');
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
        expect(currentCloudData().profile.height).toBe('171');
    });
});
