import 'fake-indexeddb/auto';
import { clear, del, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { LEGAL_VERSIONS } from '../../src/lib/legalVersions';
import { UserDataSchema } from '../../src/lib/schema';
import { CURRENT_SYNC_PROTOCOL } from '../../src/lib/schemaEvolution';
import {
    adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal,
    rebaseConsentRecoveryWithExplicitChoice, StaleLocalRevisionError,
} from '../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../src/lib/sync/localRepository';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from '../../src/lib/sync/documentProjection';
import { applySemanticOperations, parseSyncMeta, type SyncMeta, type VectorClock } from '../../src/lib/sync/semanticProjection';
import { sealCloudDocument } from '../../src/lib/sync/cloudDocumentCipher';
import { readAccountCloudDocument } from '../../src/lib/sync/cloudDocumentRead';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { updateArchiveRecord } from '../../src/lib/sync/secureArchiveRepository';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../../src/types';

const owner = 'user:consent-diagnostic';
const key = 'logbook:v2:' + owner;
const accountKey = new Uint8Array(32).fill(37);
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'consent-journal-diagnostic', updatedAt: '2026-11-09T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const state = (input: Record<string, unknown> = {}) => UserDataSchema.parse(input) as unknown as UserData;
const legal = (acceptedAt: string) => ({
    hasAcceptedHealthData: true, hasAcceptedTerms: true, acceptedAt,
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
});
const initial = () => state({ profile: { height: '170' }, legalConsent: legal('2026-10-01T10:00:00.000Z') });
const workout = (id: string, date: string): WorkoutSession => ({ id, date, routineName: id, exercises: [] });

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    localStorage.setItem(key + ':health-consent-generation', '1');
    await createAndMigrateVault(owner);
    await initializeLocal(owner, initial());
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function snapshot(): Promise<LocalEnvelope> {
    const current = await readLocal(owner);
    if (!current) throw new Error('Missing diagnostic consent archive');
    return current;
}

async function preparePending(): Promise<LocalEnvelope> {
    const current = await snapshot();
    const chosen = state({ ...current.data, profile: { ...current.data.profile, height: '180' } });
    await commitLocal(owner, chosen, current.data);
    const pending = await snapshot();
    expect(pending.pending.length).toBeGreaterThan(0);
    return pending;
}

// Positive evidence crosses the same AEAD and metadata codecs as the cloud reader.
function serverSnapshot(data: UserData, clocks: Record<string, VectorClock> = {}) {
    const documents = new Map<string, DocumentData>();
    const business = new Map<string, DocumentData>();
    const metadata: Record<string, SyncMeta> = {};
    for (const [path, value] of projectDocuments(data, catalog)) {
        const clock = clocks[path] ?? { s01: 7 };
        const writer = Object.entries(clock).find(([, sequence]) => sequence > 0);
        if (!writer) throw new Error('Missing diagnostic cloud writer');
        const sync: SyncMeta = {
            protocolVersion: CURRENT_SYNC_PROTOCOL, clock, fields: {},
            writer: { slot: writer[0], replicaId: 'consent-server-' + writer[0],
                generation: 1, seq: writer[1], consentRevision: 3 },
        };
        const sealed = sealCloudDocument(accountKey, owner.slice(5), path, value, sync);
        const decoded = readAccountCloudDocument(sealed, 'consent diagnostic snapshot', owner.slice(5), path, accountKey);
        const verifiedMeta = parseSyncMeta(decoded.sync);
        documents.set(path, { ...decoded.business, _sync: verifiedMeta });
        business.set(path, decoded.business);
        metadata[path] = verifiedMeta;
    }
    return { data: applyRemoteDocuments(state(), business, catalog), documents, metadata };
}

const remoteRoot = () => serverSnapshot(state({
    profile: { height: '175' }, legalConsent: legal('2026-11-09T00:00:00.000Z'),
}));

describe('diagnostic explicit consent journal transition', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid consent revision %s before reading the catalog or changing ciphertext', async revision => {
            const before = await preparePending();
            const ciphertext = await get(key);
            const remote = remoteRoot();
            catalogSource.read.mockClear();

            await expect(rebaseConsentRecoveryWithExplicitChoice(
                owner, revision, before.revision, remote.data, before.data, remote.documents, () => true,
            )).rejects.toThrow('Nuovo consenso non valido');
            expect(catalogSource.read).not.toHaveBeenCalled();
            expect(await get(key)).toBe(ciphertext);
            expect(await snapshot()).toEqual(before);
        },
    );

    it('installs a fresh causal journal, sorted full monthly coverage and authoritative cloud consent atomically', async () => {
        const now = Date.now();
        await adoptReplicaCheckpoint(owner, {
            identity: { slot: 's00', replicaId: 'consent-old-local', generation: 1,
                checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 },
            baseSeq: 0,
        }, { clock: {}, syncMetaByDocument: {} });
        const before = await preparePending();
        const remote = serverSnapshot(state({
            profile: { height: '175' }, legalConsent: legal('2026-11-09T00:00:00.000Z'),
            history: [workout('keep-november', '2026-11-01'), workout('remove-september', '2026-09-01')],
            nutrition: {
                '2026-10-01': { date: '2026-10-01', weight: 80 },
                '2026-09-01': { date: '2026-09-01', weight: 70 },
            },
        }), { 'history_months/2026-11': { s02: 4 }, 'nutrition_months/2026-09': { s03: 2 } });
        const chosen = state({
            ...remote.data, profile: { height: '180' }, legalConsent: before.data.legalConsent,
            history: [workout('keep-november', '2026-11-01')],
            nutrition: { '2026-10-01': { date: '2026-10-01', weight: 82 } },
            pendingConflicts: { nutritionPlanning: { weight: 78 } },
        });
        const inputs = structuredClone({ remote, chosen });
        const started = Date.now();

        await rebaseConsentRecoveryWithExplicitChoice(
            owner, 3, before.revision, remote.data, chosen, remote.documents, () => true,
        );
        const result = await snapshot();
        expect(result.data).toEqual(state({ ...chosen, legalConsent: remote.data.legalConsent }));
        expect(result.baseline).toEqual(remote.data);
        expect(result.consentRevision).toBe(3);
        expect(result.replica).toBeNull();
        expect(result.actorId).not.toBe(before.actorId);
        expect(result.actorSeq).toBe(1);
        expect(result.clock).toEqual({ s01: 7, s02: 4, s03: 2, [result.actorId]: 1 });
        expect(result.syncMetaByDocument).toEqual(remote.metadata);
        expect(result.completeMonths).toEqual(['2026-09', '2026-10', '2026-11']);
        expect(result.revision).toBe(before.revision + 1);
        expect(result.pending).toHaveLength(4);
        expect(new Set(result.pending.map(operation => operation.docPath))).toEqual(new Set([
            '', 'history_months/2026-09', 'nutrition_months/2026-09', 'nutrition_months/2026-10',
        ]));
        for (const operation of result.pending) {
            expect(operation.actorId).toBe(result.actorId);
            expect(operation.seq).toBe(1);
            expect(operation.clock).toEqual(result.clock);
        }
        expect(result.pending.filter(operation => operation.isDelete).map(operation => ({
            docPath: operation.docPath, path: operation.path,
        }))).toEqual([
            { docPath: 'history_months/2026-09', path: ['remove-september'] },
            { docPath: 'nutrition_months/2026-09', path: ['2026-09-01'] },
        ]);
        const replayed = applySemanticOperations(projectDocuments(remote.data, catalog), result.pending, remote.metadata);
        const replay = applyRemoteDocuments(state(), replayed.documents, catalog);
        expect(replay.profile?.height).toBe('180');
        expect(replay.history?.map(item => item.id)).toEqual(['keep-november']);
        expect(replay.nutrition?.['2026-09-01']).toBeUndefined();
        expect(replay.nutrition?.['2026-10-01']?.weight).toBe(82);
        expect(replay.legalConsent).toEqual(remote.data.legalConsent);
        expect(result.archivedConsentJournals).toEqual([{
            sourceConsentRevision: 1, capturedAt: expect.any(String),
            data: before.data, baseline: before.baseline, pending: before.pending,
        }]);
        const capturedAt = Date.parse(result.archivedConsentJournals![0].capturedAt);
        expect(capturedAt).toBeGreaterThanOrEqual(started);
        expect(capturedAt).toBeLessThanOrEqual(Date.now());
        expect({ remote, chosen }).toEqual(inputs);
        expect(await get(key)).toMatch(/^tlb-sealed:v1:/);
    });

    it('archives the old journal even when the chosen cloud result needs no new operations', async () => {
        const before = await preparePending();
        const remote = remoteRoot();
        await rebaseConsentRecoveryWithExplicitChoice(
            owner, 3, before.revision, remote.data, remote.data, remote.documents, () => true,
        );
        const result = await snapshot();
        expect(result.data).toEqual(remote.data);
        expect(result.baseline).toEqual(remote.data);
        expect(result.pending).toEqual([]);
        expect(result.actorSeq).toBe(0);
        expect(result.clock).toEqual({ s01: 7, [result.actorId]: 0 });
        expect(result.revision).toBe(before.revision + 1);
        expect(result.archivedConsentJournals?.[0].pending).toEqual(before.pending);
    });

    it.each(['missing', 'clean', 'changed'] as const)(
        'reports the actual revision for a %s archive without replacing ciphertext', async scenario => {
            const preview = scenario === 'clean' ? await snapshot() : await preparePending();
            if (scenario === 'missing') await del(key);
            if (scenario === 'changed') {
                await commitLocal(owner, state({ ...preview.data, profile: { height: '185' } }), preview.data);
            }
            const current = await readLocal(owner);
            const ciphertext = await get(key);
            const remote = remoteRoot();
            const attempt = rebaseConsentRecoveryWithExplicitChoice(
                owner, 3, preview.revision, remote.data, preview.data, remote.documents, () => true,
            );
            await expect(attempt).rejects.toBeInstanceOf(StaleLocalRevisionError);
            await expect(attempt).rejects.toMatchObject({
                expectedRevision: preview.revision, actualRevision: current?.revision ?? null,
            });
            expect(await get(key)).toBe(ciphertext);
            expect(await readLocal(owner)).toEqual(current);
        },
    );

    it.each(['catalog', 'indexeddb'] as const)(
        'rejects a session invalidated during the %s wait inside the atomic transition', async boundary => {
            const before = await preparePending();
            const ciphertext = await get(key);
            const remote = remoteRoot();
            let current = true;
            if (boundary === 'catalog') {
                catalogSource.read.mockImplementationOnce(async () => { current = false; return catalog; });
            } else {
                const originalGet = IDBObjectStore.prototype.get;
                vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
                    current = false;
                    return originalGet.call(this, query);
                });
            }
            await expect(rebaseConsentRecoveryWithExplicitChoice(
                owner, 3, before.revision, remote.data, before.data, remote.documents, () => current,
            )).rejects.toThrow('Sessione cambiata: recupero annullato');
            expect(await get(key)).toBe(ciphertext);
            expect(await snapshot()).toEqual(before);
        },
    );

    it('appends the last available recovery slot without dropping any of the 31 previous originals', async () => {
        const before = await preparePending();
        const originals = Array.from({ length: 31 }, (_, index) => ({
            sourceConsentRevision: 0, capturedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
            data: structuredClone(before.data), baseline: structuredClone(before.baseline),
            pending: structuredClone(before.pending),
        }));
        await updateArchiveRecord<LocalEnvelope>(owner, current => {
            if (!current) throw new Error('Missing diagnostic archive');
            return { ...current, archivedConsentJournals: originals };
        });
        const remote = remoteRoot();
        await rebaseConsentRecoveryWithExplicitChoice(
            owner, 3, before.revision, remote.data, before.data, remote.documents, () => true,
        );
        const result = await snapshot();
        expect(result.archivedConsentJournals).toHaveLength(32);
        expect(result.archivedConsentJournals?.slice(0, 31)).toEqual(originals);
        expect(result.archivedConsentJournals?.[31]).toEqual({
            sourceConsentRevision: 1, capturedAt: expect.any(String),
            data: before.data, baseline: before.baseline, pending: before.pending,
        });
    });

    it('retains the exact original on quota failure and recovers once after a successful retry', async () => {
        const before = await preparePending();
        const ciphertext = await get(key);
        const remote = remoteRoot();
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });
        await expect(rebaseConsentRecoveryWithExplicitChoice(
            owner, 3, before.revision, remote.data, before.data, remote.documents, () => true,
        )).rejects.toThrow('Quota exceeded');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
        put.mockRestore();

        await rebaseConsentRecoveryWithExplicitChoice(
            owner, 3, before.revision, remote.data, before.data, remote.documents, () => true,
        );
        const result = await snapshot();
        expect(result.revision).toBe(before.revision + 1);
        expect(result.archivedConsentJournals).toHaveLength(1);
        expect(result.archivedConsentJournals?.[0].pending).toEqual(before.pending);
    });
});
