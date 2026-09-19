import { get, update } from 'idb-keyval';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { generateId } from '../utils/date';
import { getNutritionConflictFingerprint } from '../utils/object';
import equal from 'fast-deep-equal';
import { type SemanticOperation, type VectorClock, type SyncMeta, diffDocuments, applySemanticOperations, parseSyncMeta } from './semanticProjection';
import { projectDocuments, applyRemoteDocuments, type DocumentData } from './documentProjection';
import { getCachedCatalog } from '../catalog/catalogService';
import { normalizeStorageOwner } from './owner';
import {
    applyDomainOperations,
    compileDomainOperations,
    normalizeDomainOperationBatch,
    type DomainOperationBatch,
} from './domainOperations';
import {
    CURRENT_DATA_SCHEMA,
    CURRENT_LOCAL_ENVELOPE,
    CURRENT_SYNC_PROTOCOL,
    normalizeLocalEnvelopeRecord,
} from '../schemaEvolution';

export interface LocalEnvelopeV4 {
    version: typeof CURRENT_LOCAL_ENVELOPE;
    dataSchemaVersion: typeof CURRENT_DATA_SCHEMA;
    syncProtocolVersion: typeof CURRENT_SYNC_PROTOCOL;
    owner: string;
    actorId: string;
    actorSeq: number;
    clock: VectorClock;
    data: UserData;
    baseline: UserData;
    completeMonths: string[];
    pending: SemanticOperation[];
    syncMetaByDocument: Record<string, SyncMeta>;
    revision: number;
}

export type LocalEnvelope = LocalEnvelopeV4;
export type CloudCoverageMode = 'window' | 'all';
export type LocalWriteGuard = () => boolean;

const currentEnvelopeVersions = () => ({
    version: CURRENT_LOCAL_ENVELOPE,
    dataSchemaVersion: CURRENT_DATA_SCHEMA,
    syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
});

const keyFor = (owner: string) => {
    const canonicalOwner = normalizeStorageOwner(owner);
    return `logbook:v2:${canonicalOwner}`;
};
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

function validate(value: any, owner: string): LocalEnvelope | undefined {
    if (!value) return undefined;

    const canonicalOwner = normalizeStorageOwner(owner);
    if (value.owner !== canonicalOwner) {
        throw new Error('Archivio locale non riconosciuto: conservato per il recupero');
    }

    const migrated = normalizeLocalEnvelopeRecord(value);
    const v4 = migrated as unknown as LocalEnvelopeV4;
    return { ...v4, data: parse(v4.data), baseline: parse(v4.baseline) };
}

function enforceMonthlyEntityTombstones(
    baseDocs: Map<string, DocumentData>, desiredDocs: Map<string, DocumentData>, input: SemanticOperation[],
    actorId: string, seq: number, clock: VectorClock
): SemanticOperation[] {
    let operations = [...input];
    const paths = new Set([...baseDocs.keys(), ...desiredDocs.keys()]);
    for (const docPath of paths) {
        if (!docPath.startsWith('history_months/') && !docPath.startsWith('nutrition_months/')) continue;
        const baseDoc = baseDocs.get(docPath) ?? {};
        const desiredDoc = desiredDocs.get(docPath) ?? {};
        for (const entityId of Object.keys(baseDoc)) {
            if (Object.hasOwn(desiredDoc, entityId)) continue;
            operations = operations.filter(op => !(op.docPath === docPath && op.path[0] === entityId));
            operations.push({ docPath, path: [entityId], isDelete: true, actorId, seq, clock });
        }
    }
    return operations;
}

export async function readLocal(owner: string): Promise<LocalEnvelope | undefined> {
    owner = normalizeStorageOwner(owner);
    return validate(await get<any>(keyFor(owner)), owner);
}

export async function commitLocal(owner: string, data: UserData, initialBase: UserData, guard?: LocalWriteGuard): Promise<SemanticOperation[]> {
    owner = normalizeStorageOwner(owner);
    const desired = structuredClone(parse(data));
    const fallback = structuredClone(parse(initialBase));
    let operations: SemanticOperation[] = [];
    const catalog = await getCachedCatalog();
    await update<any>(keyFor(owner), raw => {
        if (guard && !guard()) return raw;
        const current = validate(raw, owner);
        const baseDocs = projectDocuments(current?.data ?? fallback, catalog);
        const desiredDocs = projectDocuments(desired, catalog);
        const actorId = current?.actorId ?? generateId('actor');
        const nextSeq = (current?.actorSeq ?? 0) + 1;
        const testClock = { ...(current?.clock ?? {}) };
        testClock[actorId] = nextSeq;
        operations = diffDocuments(baseDocs, desiredDocs, actorId, nextSeq, testClock);
        operations = enforceMonthlyEntityTombstones(baseDocs, desiredDocs, operations, actorId, nextSeq, testClock);
        if (operations.length === 0) {
            return { ...(current ?? { completeMonths: [] }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: desired, baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [], pending: current?.pending ?? [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, revision: current?.revision ?? 0 };
        }
        return { ...(current ?? { completeMonths: [] }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: nextSeq, clock: testClock, data: desired, baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [], pending: owner === 'guest' ? [] : [...(current?.pending ?? []), ...operations], syncMetaByDocument: current?.syncMetaByDocument ?? {}, revision: nextSeq };
    });
    return operations;
}

export interface DomainCommitResult { operations: SemanticOperation[]; data: UserData; }

export async function commitDomainOperations(owner: string, batch: DomainOperationBatch, initialBase: UserData): Promise<DomainCommitResult> {
    owner = normalizeStorageOwner(owner);
    const domainOperations = normalizeDomainOperationBatch(batch);
    const fallback = structuredClone(parse(initialBase));
    const catalog = await getCachedCatalog();
    let operations: SemanticOperation[] = [];
    let savedData = fallback;
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        const base = current?.data ?? fallback;
        const desired = applyDomainOperations(base, domainOperations);
        const actorId = current?.actorId ?? generateId('actor');
        const nextSeq = (current?.actorSeq ?? 0) + 1;
        const nextClock = { ...(current?.clock ?? {}) };
        nextClock[actorId] = nextSeq;
        operations = compileDomainOperations(base, desired, domainOperations, catalog, actorId, nextSeq, nextClock);
        savedData = desired;
        if (operations.length === 0) return { ...(current ?? { completeMonths: [] }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: desired, baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [], pending: current?.pending ?? [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, revision: current?.revision ?? 0 };
        return { ...(current ?? { completeMonths: [] }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: nextSeq, clock: nextClock, data: desired, baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [], pending: owner === 'guest' ? [] : [...(current?.pending ?? []), ...operations], syncMetaByDocument: current?.syncMetaByDocument ?? {}, revision: nextSeq };
    });
    return { operations, data: savedData };
}

export async function acknowledgeLocal(owner: string, _id: string, remote: UserData): Promise<void> {
    owner = normalizeStorageOwner(owner);
    const parsed = parse(remote);
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current || current.pending[0] === undefined) throw new Error('Conferma obsoleta o fuori ordine');
        const pending = current.pending.slice(1);
        return { ...current, baseline: parsed, data: pending.length ? current.data : parsed, pending };
    });
}

export async function acknowledgeThrough(owner: string, expectedSeq: number, remote: UserData, _expected?: UserData, months: string[] = [], syncMeta?: Record<string, SyncMeta>): Promise<void> {
    owner = normalizeStorageOwner(owner);
    const parsed = parse(remote);
    const catalog = await getCachedCatalog();
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current) throw new Error('Archivio locale non trovato');
        const pending = current.pending.filter(op => op.seq > expectedSeq);
        const newClock = { ...current.clock };
        if (syncMeta) for (const meta of Object.values(syncMeta)) for (const [actor, seq] of Object.entries(meta.clock)) newClock[actor] = Math.max(newClock[actor] || 0, seq);
        const newSyncMeta = { ...current.syncMetaByDocument, ...(syncMeta || {}) };
        const remoteDocs = projectDocuments(parsed, catalog);
        const { documents: mergedDocs, syncMetas: mergedMetas } = applySemanticOperations(remoteDocs, pending, newSyncMeta);
        const reconciled = applyRemoteDocuments(current.data, mergedDocs, catalog);
        reconciled.pendingConflicts = current.data.pendingConflicts;
        const data = parse(reconciled);
        return { ...current, clock: newClock, baseline: parsed, data, pending, completeMonths: [...new Set([...current.completeMonths, ...months])], syncMetaByDocument: mergedMetas };
    });
}

export async function initializeLocal(owner: string, data: UserData, completeMonths?: string[]): Promise<void> {
    owner = normalizeStorageOwner(owner);
    const parsed = structuredClone(parse(data));
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (current?.pending.length) return current;
        return { ...current, ...currentEnvelopeVersions(), owner, actorId: current?.actorId ?? generateId('actor'), actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: parsed, baseline: parsed, completeMonths: completeMonths ?? current?.completeMonths ?? [], pending: [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, revision: 0 };
    });
}

export async function hydrateLocal(owner: string, cloudData: UserData, months: string[], cloudDocuments?: Map<string, DocumentData>, coverageMode: CloudCoverageMode = 'window', guard?: LocalWriteGuard): Promise<LocalEnvelope> {
    owner = normalizeStorageOwner(owner);
    const cloud = structuredClone(parse(cloudData));
    let saved: LocalEnvelope | undefined;
    const catalog = await getCachedCatalog();
    await update<any>(keyFor(owner), raw => {
        if (guard && !guard()) return raw;
        const current = validate(raw, owner);
        if (!current) {
            const syncMetaByDocument: Record<string, SyncMeta> = {};
            const clock: Record<string, number> = {};
            if (cloudDocuments) for (const [path, doc] of cloudDocuments.entries()) if (doc._sync) {
                const meta = parseSyncMeta(doc._sync);
                syncMetaByDocument[path] = meta;
                for (const [actor, seq] of Object.entries(meta.clock)) clock[actor] = Math.max(clock[actor] || 0, seq);
            }
            saved = { ...currentEnvelopeVersions(), owner, actorId: generateId('actor'), actorSeq: 0, clock, data: cloud, baseline: cloud, completeMonths: months, pending: [], syncMetaByDocument, revision: 0 };
        } else {
            const syncMeta: Record<string, SyncMeta> = {};
            const authoritativePaths = new Set(['', ...months.map(m => `history_months/${m}`), ...months.map(m => `nutrition_months/${m}`)]);
            if (coverageMode === 'window') for (const [path, meta] of Object.entries(current.syncMetaByDocument ?? {})) if (!authoritativePaths.has(path)) syncMeta[path] = meta;
            const updatedClock = { ...current.clock };
            if (cloudDocuments) for (const [path, doc] of cloudDocuments.entries()) if (doc._sync) {
                const meta = parseSyncMeta(doc._sync);
                syncMeta[path] = meta;
                for (const [actor, seq] of Object.entries(meta.clock)) updatedClock[actor] = Math.max(updatedClock[actor] || 0, seq);
            }
            const localDocs = projectDocuments(current.data, catalog);
            const cloudDocsForHydration = projectDocuments(cloud, catalog);
            localDocs.set('', cloudDocsForHydration.get('') ?? {});
            if (coverageMode === 'all') {
                for (const path of [...localDocs.keys()]) if (path.startsWith('history_months/') || path.startsWith('nutrition_months/')) localDocs.delete(path);
                for (const [path, doc] of cloudDocsForHydration.entries()) if (path.startsWith('history_months/') || path.startsWith('nutrition_months/')) localDocs.set(path, doc);
            } else {
                for (const month of months) {
                    const hKey = `history_months/${month}`; localDocs.set(hKey, cloudDocsForHydration.get(hKey) ?? {});
                    const nKey = `nutrition_months/${month}`; localDocs.set(nKey, cloudDocsForHydration.get(nKey) ?? {});
                }
            }
            const applicationBase = coverageMode === 'all' ? ({ ...current.data, history: [], nutrition: {} } as UserData) : current.data;
            const baselineData = applyRemoteDocuments(applicationBase, localDocs, catalog);
            const parsedBaseline = parse(baselineData);
            const { documents: mergedDocs, syncMetas: mergedMetas } = applySemanticOperations(localDocs, current.pending, syncMeta);
            const data = applyRemoteDocuments(applicationBase, mergedDocs, catalog);
            data.pendingConflicts = current.data.pendingConflicts;
            const parsedData = parse(data);
            saved = { ...current, ...currentEnvelopeVersions(), clock: updatedClock, data: parsedData, baseline: parsedBaseline, completeMonths: coverageMode === 'all' ? [...new Set(months)] : [...new Set([...current.completeMonths, ...months])], syncMetaByDocument: mergedMetas };
        }
        return saved;
    });
    if (!saved) throw new Error('Hydration locale invalidata o non riuscita');
    return saved;
}

export async function clearNutritionConflict(owner: string, fingerprint: string, fallback: UserData): Promise<UserData> {
    owner = normalizeStorageOwner(owner);
    let saved!: UserData;
    const clear = (data: UserData): UserData => {
        if (getNutritionConflictFingerprint(data.pendingConflicts?.nutritionPlanning) !== fingerprint) return data;
        const { nutritionPlanning: _resolved, ...remaining } = data.pendingConflicts ?? {};
        const { pendingConflicts: _old, ...rest } = data;
        return Object.keys(remaining).length ? { ...rest, pendingConflicts: remaining } : rest;
    };
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        const data = current?.data ?? fallback;
        if (getNutritionConflictFingerprint(data.pendingConflicts?.nutritionPlanning) !== fingerprint) throw new Error('Conflitto cambiato durante la risoluzione');
        saved = parse(clear(data));
        return { ...(current ?? { ...currentEnvelopeVersions(), owner, actorId: generateId('actor'), actorSeq: 0, clock: {}, completeMonths: [], pending: [], syncMetaByDocument: {}, revision: 0 }), data: saved, baseline: clear(current?.baseline ?? data) };
    });
    return saved;
}

export async function revertRejectedConsent(owner: string, expected: UserData['legalConsent'], previous: UserData['legalConsent']): Promise<void> {
    owner = normalizeStorageOwner(owner);
    const revert = (data: UserData) => equal(data.legalConsent, expected) ? parse({ ...data, legalConsent: previous }) : data;
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current) return raw!;
        return { ...current, data: revert(current.data) };
    });
}

export async function preserveLegacyCache(): Promise<boolean> {
    const legacy = await get('logbook_cached_user_data');
    if (legacy === undefined) return false;
    await update('logbook:recovery:legacy', original => original ?? legacy);
    return true;
}
