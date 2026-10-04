import { get, update } from 'idb-keyval';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { generateId } from '../utils/date';
import { getNutritionConflictFingerprint } from '../utils/object';
import { parseReplicaIdentity, type CloudCheckpoint, type ReplicaCheckpoint, type ReplicaIdentity } from './replicaProtocol';
import equal from 'fast-deep-equal';
import { type SemanticOperation, type VectorClock, type SyncMeta, diffDocuments, applySemanticOperations, coversVectorClock, mergeVectors, parseSemanticOperation, parseSyncMeta, parseVectorClock } from './semanticProjection';
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

export interface LocalEnvelopeV5 {
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
    replica: ReplicaIdentity | null;
    revision: number;
}

export type LocalEnvelope = LocalEnvelopeV5;
export type CloudCoverageMode = 'window' | 'all';
export type LocalWriteGuard = () => boolean;

export class InvalidCloudSyncMetadataError extends Error {
    readonly code = 'invalid-cloud-sync-metadata';

    constructor(readonly documentPath: string, readonly originalError: unknown) {
        super(`Metadati di sincronizzazione cloud non validi per ${documentPath || 'root'}.`);
        this.name = 'InvalidCloudSyncMetadataError';
    }
}

export class StaleLocalRevisionError extends Error {
    readonly code = 'stale-local-revision';

    constructor(readonly expectedRevision: number, readonly actualRevision: number | null) {
        super('I dati locali sono cambiati durante l’operazione. Ripeti l’anteprima.');
        this.name = 'StaleLocalRevisionError';
    }
}

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

function parseCloudSyncMeta(documentPath: string, raw: unknown): SyncMeta {
    try {
        return parseSyncMeta(raw);
    } catch (error) {
        throw new InvalidCloudSyncMetadataError(documentPath, error);
    }
}

function validate(value: any, owner: string): LocalEnvelope | undefined {
    if (!value) return undefined;

    const canonicalOwner = normalizeStorageOwner(owner);
    // Dispatch on the container version before assuming the current envelope shape.
    // A future envelope may legitimately rename/move current-version fields such as owner.
    const migrated = normalizeLocalEnvelopeRecord(value);
    const record = migrated as Record<string, unknown>;
    if (record.owner !== canonicalOwner) throw new Error('Archivio locale non riconosciuto: conservato per il recupero');
    if (typeof record.actorId !== 'string' || !record.actorId.trim()) throw new Error('Archivio locale causale non valido');
    if (typeof record.actorSeq !== 'number' || !Number.isSafeInteger(record.actorSeq) || record.actorSeq < 0) {
        throw new Error('Archivio locale causale non valido');
    }

    const clock = parseVectorClock(record.clock, 'local envelope clock');
    if ((clock[record.actorId] ?? 0) !== record.actorSeq) throw new Error('Archivio locale causale non valido');

    if (!Array.isArray(record.pending)) throw new Error('Journal locale non valido');
    const pending = record.pending.map(parseSemanticOperation);
    for (const operation of pending) {
        if (operation.actorId !== record.actorId || operation.seq > record.actorSeq || !coversVectorClock(clock, operation.clock)) {
            throw new Error('Journal locale causale non valido');
        }
    }

    if (!record.syncMetaByDocument || typeof record.syncMetaByDocument !== 'object' || Array.isArray(record.syncMetaByDocument)) {
        throw new Error('Metadati sync locali non validi');
    }
    const syncMetaByDocument: Record<string, SyncMeta> = {};
    for (const [path, rawMeta] of Object.entries(record.syncMetaByDocument as Record<string, unknown>)) {
        const meta = parseSyncMeta(rawMeta);
        if (!coversVectorClock(clock, meta.clock)) throw new Error('Metadati sync locali fuori dal frontier');
        syncMetaByDocument[path] = meta;
    }

    if (!Array.isArray(record.completeMonths) || record.completeMonths.some(month => typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
        throw new Error('Copertura mensile locale non valida');
    }
    if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 0) {
        throw new Error('Revisione locale non valida');
    }

    const replica = parseReplicaIdentity(record.replica);

    return {
        ...(record as unknown as LocalEnvelopeV5),
        actorId: record.actorId,
        actorSeq: record.actorSeq,
        clock,
        data: parse(record.data),
        baseline: parse(record.baseline),
        completeMonths: [...record.completeMonths] as string[],
        pending,
        syncMetaByDocument,
        replica,
        revision: record.revision,
    };
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

export async function commitLocal(owner: string, data: UserData, initialBase: UserData, guard?: LocalWriteGuard, expectedRevision?: number): Promise<SemanticOperation[]> {
    owner = normalizeStorageOwner(owner);
    const desired = structuredClone(parse(data));
    const callerBase = structuredClone(parse(initialBase));
    let operations: SemanticOperation[] = [];
    const catalog = await getCachedCatalog();
    await update<any>(keyFor(owner), raw => {
        if (guard && !guard()) return raw;
        const current = validate(raw, owner);
        if (expectedRevision !== undefined && (
            current?.revision !== expectedRevision
            || !current
            || !equal(parse(current.data), callerBase)
        )) {
            throw new StaleLocalRevisionError(expectedRevision, current?.revision ?? null);
        }
        const currentData = structuredClone(parse(current?.data ?? callerBase));
        const baseDocs = projectDocuments(callerBase, catalog);
        const desiredDocs = projectDocuments(desired, catalog);
        const actorId = current?.replica?.slot ?? current?.actorId ?? generateId('actor');
        const nextSeq = (current?.actorSeq ?? 0) + 1;
        const testClock = { ...(current?.clock ?? {}) };
        testClock[actorId] = nextSeq;
        operations = diffDocuments(baseDocs, desiredDocs, actorId, nextSeq, testClock);
        operations = enforceMonthlyEntityTombstones(baseDocs, desiredDocs, operations, actorId, nextSeq, testClock);

        if (operations.length === 0) {
            const stableData = current?.data ?? desired;
            return { ...(current ?? { completeMonths: [], replica: null }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: stableData, baseline: current?.baseline ?? callerBase, completeMonths: current?.completeMonths ?? [], pending: current?.pending ?? [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: current?.revision ?? 0 };
        }

        // Snapshot boundaries express intent relative to the caller's observed base.
        // Replay only that delta over the latest durable envelope so concurrent changes
        // unknown to this tab cannot be converted into deletions/tombstones.
        const currentDocs = projectDocuments(currentData, catalog);
        const { documents: reconciledDocs } = applySemanticOperations(currentDocs, operations);
        const reconciled = applyRemoteDocuments(currentData, reconciledDocs, catalog);
        reconciled.pendingConflicts = currentData.pendingConflicts;
        const savedData = parse(reconciled);

        return { ...(current ?? { completeMonths: [], replica: null }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: nextSeq, clock: testClock, data: savedData, baseline: current?.baseline ?? callerBase, completeMonths: current?.completeMonths ?? [], pending: owner === 'guest' ? [] : [...(current?.pending ?? []), ...operations], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: (current?.revision ?? 0) + 1 };
    });
    return operations;
}

export interface DomainCommitResult { operations: SemanticOperation[]; data: UserData; }

export async function commitDomainOperations(owner: string, batch: DomainOperationBatch, initialBase: UserData, guard?: LocalWriteGuard): Promise<DomainCommitResult> {
    owner = normalizeStorageOwner(owner);
    const domainOperations = normalizeDomainOperationBatch(batch);
    const fallback = structuredClone(parse(initialBase));
    const catalog = await getCachedCatalog();
    let operations: SemanticOperation[] = [];
    let savedData = fallback;
    await update<any>(keyFor(owner), raw => {
        if (guard && !guard()) throw new Error('Commit locale invalidato dal cambio sessione');
        const current = validate(raw, owner);
        const base = current?.data ?? fallback;
        const desired = applyDomainOperations(base, domainOperations);
        const actorId = current?.replica?.slot ?? current?.actorId ?? generateId('actor');
        const nextSeq = (current?.actorSeq ?? 0) + 1;
        const nextClock = { ...(current?.clock ?? {}) };
        nextClock[actorId] = nextSeq;
        operations = compileDomainOperations(base, desired, domainOperations, catalog, actorId, nextSeq, nextClock);
        savedData = desired;
        if (operations.length === 0) return { ...(current ?? { completeMonths: [], replica: null }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: desired, baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [], pending: current?.pending ?? [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: current?.revision ?? 0 };
        return { ...(current ?? { completeMonths: [], replica: null }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: nextSeq, clock: nextClock, data: desired, baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [], pending: owner === 'guest' ? [] : [...(current?.pending ?? []), ...operations], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: (current?.revision ?? 0) + 1 };
    });
    return { operations, data: savedData };
}

export async function markReplicaCheckpointRequired(
    owner: string,
    expectedReplica?: ReplicaIdentity,
): Promise<void> {
    owner = normalizeStorageOwner(owner);
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current?.replica) return current;
        if (expectedReplica && (
            current.replica.slot !== expectedReplica.slot
            || current.replica.replicaId !== expectedReplica.replicaId
            || current.replica.generation !== expectedReplica.generation
        )) return current;

        return {
            ...current,
            replica: {
                ...current.replica,
                checkpointAtMs: 1,
                leaseUntilMs: 1,
            },
            revision: current.revision + 1,
        };
    });
}

export async function adoptReplicaCheckpoint(
    owner: string,
    claim: ReplicaCheckpoint,
    checkpoint: CloudCheckpoint,
    guard?: LocalWriteGuard,
): Promise<LocalEnvelope> {
    owner = normalizeStorageOwner(owner);
    const catalog = await getCachedCatalog();
    let saved: LocalEnvelope | undefined;

    await update<any>(keyFor(owner), raw => {
        if (guard && !guard()) return raw;
        const current = validate(raw, owner);
        if (!current) throw new Error('Archivio locale non trovato durante il checkpoint replica');

        const sameReplica = current.replica
            && current.replica.slot === claim.identity.slot
            && current.replica.replicaId === claim.identity.replicaId
            && current.replica.generation === claim.identity.generation;

        if (sameReplica) {
            saved = {
                ...current,
                ...currentEnvelopeVersions(),
                clock: mergeVectors(current.clock, checkpoint.clock),
                replica: claim.identity,
                revision: current.revision + 1,
            };
            return saved;
        }

        const baseline = structuredClone(parse(current.baseline));
        const desired = structuredClone(parse(current.data));
        const baseDocs = projectDocuments(baseline, catalog);
        const desiredDocs = projectDocuments(desired, catalog);
        const actorId = claim.identity.slot;
        const nextSeq = claim.baseSeq + 1;
        const nextClock: VectorClock = { ...checkpoint.clock, [actorId]: nextSeq };

        let operations = diffDocuments(baseDocs, desiredDocs, actorId, nextSeq, nextClock);
        operations = enforceMonthlyEntityTombstones(baseDocs, desiredDocs, operations, actorId, nextSeq, nextClock);

        const actorSeq = operations.length ? nextSeq : claim.baseSeq;
        const clock: VectorClock = {
            ...checkpoint.clock,
            ...(actorSeq > 0 ? { [actorId]: Math.max(checkpoint.clock[actorId] ?? 0, actorSeq) } : {}),
        };

        saved = {
            ...current,
            ...currentEnvelopeVersions(),
            actorId,
            actorSeq,
            clock,
            data: desired,
            baseline,
            pending: operations,
            syncMetaByDocument: structuredClone(checkpoint.syncMetaByDocument),
            replica: claim.identity,
            revision: current.revision + 1,
        };
        return saved;
    });

    if (!saved) throw new Error('Checkpoint replica invalidato o non riuscito');
    return saved;
}

export async function acknowledgeThrough(owner: string, expectedSeq: number, remote: UserData, months: string[] = [], syncMeta?: Record<string, SyncMeta>): Promise<void> {
    owner = normalizeStorageOwner(owner);
    const parsed = parse(remote);
    const catalog = await getCachedCatalog();
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current) throw new Error('Archivio locale non trovato');
        const pending = current.pending.filter(op => op.seq > expectedSeq);
        const incomingMeta = syncMeta ?? {};
        const incomingIsStale = Object.keys(incomingMeta).length > 0 && Object.entries(incomingMeta).some(([path, meta]) => {
            const durable = current.syncMetaByDocument[path];
            return durable !== undefined
                && coversVectorClock(durable.clock, meta.clock)
                && !coversVectorClock(meta.clock, durable.clock);
        });
        // Another tab may already have installed a causally newer acknowledgement.
        // Never let an older remote snapshot replace that durable business state after
        // the newer journal entries have already been acknowledged and removed.
        if (incomingIsStale) return current;
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
        return { ...current, ...currentEnvelopeVersions(), owner, actorId: current?.actorId ?? generateId('actor'), actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: parsed, baseline: parsed, completeMonths: completeMonths ?? current?.completeMonths ?? [], pending: [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: current?.revision ?? 0 };
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
                const meta = parseCloudSyncMeta(path, doc._sync);
                syncMetaByDocument[path] = meta;
                for (const [actor, seq] of Object.entries(meta.clock)) clock[actor] = Math.max(clock[actor] || 0, seq);
            }
            saved = { ...currentEnvelopeVersions(), owner, actorId: generateId('actor'), actorSeq: 0, clock, data: cloud, baseline: cloud, completeMonths: months, pending: [], syncMetaByDocument, replica: null, revision: 0 };
        } else {
            const syncMeta: Record<string, SyncMeta> = {};
            const authoritativePaths = new Set(['', ...months.map(m => `history_months/${m}`), ...months.map(m => `nutrition_months/${m}`)]);
            if (coverageMode === 'window') for (const [path, meta] of Object.entries(current.syncMetaByDocument ?? {})) if (!authoritativePaths.has(path)) syncMeta[path] = meta;
            const updatedClock = { ...current.clock };
            let staleCloudSnapshot = false;
            if (cloudDocuments) for (const [path, doc] of cloudDocuments.entries()) if (doc._sync) {
                const meta = parseCloudSyncMeta(path, doc._sync);
                const durable = current.syncMetaByDocument[path];
                if (authoritativePaths.has(path) && durable
                    && coversVectorClock(durable.clock, meta.clock)
                    && !coversVectorClock(meta.clock, durable.clock)) {
                    staleCloudSnapshot = true;
                }
                syncMeta[path] = meta;
                for (const [actor, seq] of Object.entries(meta.clock)) updatedClock[actor] = Math.max(updatedClock[actor] || 0, seq);
            }
            // A foreground request started in another tab can complete after a newer
            // acknowledgement has already become durable. Its older snapshot is not
            // authoritative anymore; keep the durable envelope rather than rolling it back.
            if (staleCloudSnapshot) {
                saved = current;
                return current;
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
        return { ...(current ?? { ...currentEnvelopeVersions(), owner, actorId: generateId('actor'), actorSeq: 0, clock: {}, completeMonths: [], pending: [], syncMetaByDocument: {}, replica: null, revision: 0 }), data: saved, baseline: clear(current?.baseline ?? data) };
    });
    return saved;
}

export async function revertRejectedConsent(owner: string, expected: UserData['legalConsent'], previous: UserData['legalConsent']): Promise<void> {
    owner = normalizeStorageOwner(owner);
    await update<any>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current || !equal(current.data.legalConsent, expected)) return raw!;

        const legalConsentOps = current.pending.filter(op =>
            op.docPath === ''
            && op.path[0] === 'legalConsent'
            && op.actorId === current.actorId
        );
        const rejectedSeq = legalConsentOps.reduce((max, op) => Math.max(max, op.seq), -1);
        const pending = rejectedSeq < 0
            ? current.pending
            : current.pending.filter(op => !(
                op.docPath === ''
                && op.path[0] === 'legalConsent'
                && op.actorId === current.actorId
                && op.seq === rejectedSeq
            ));
        const data = parse({ ...current.data, legalConsent: previous });
        return { ...current, data, pending };
    });
}
