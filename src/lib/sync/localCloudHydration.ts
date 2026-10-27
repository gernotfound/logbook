import type { UserData } from '../../types';
import { UserDataSchema } from '../schema';
import { generateId } from '../utils/date';
import { getCachedCatalog } from '../catalog/catalogService';
import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../schemaEvolution';
import { normalizeStorageOwner } from './owner';
import { ReplicaFencedError } from './replicaProtocol';
import { fenceCloudIntegrity } from './localCloudIntegrity';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
import { ownerConsentRevision } from './localConsentReconciliation';
import { projectDocuments, applyRemoteDocuments, type DocumentData } from './documentProjection';
import { type SyncMeta, applySemanticOperations, coversVectorClock, parseSyncMeta } from './semanticProjection';

export type CloudCoverageMode = 'window' | 'all';
type LocalWriteGuard = () => boolean;
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const currentEnvelopeVersions = () => ({
    version: CURRENT_LOCAL_ENVELOPE,
    dataSchemaVersion: CURRENT_DATA_SCHEMA,
    syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
});

class InvalidCloudSyncMetadataError extends Error {
    readonly code = 'invalid-cloud-sync-metadata';

    constructor(readonly documentPath: string, readonly originalError: unknown) {
        super(`Metadati di sincronizzazione cloud non validi per ${documentPath || 'root'}.`);
        this.name = 'InvalidCloudSyncMetadataError';
    }
}

/**
 * Cloud business evidence is missing or causally older than an already
 * acknowledged local document. Unlike a transport/replica failure this is
 * evidence that destructive cleanup must be fenced durably.
 */
export class IncompleteCloudSnapshotError extends ReplicaFencedError {
    readonly evidence = 'cloud-snapshot-integrity';

    constructor(
        message: string,
        readonly causeKind: 'missing-document' | 'stale-document',
        readonly documentPaths: readonly string[],
    ) {
        super(message);
        this.name = 'IncompleteCloudSnapshotError';
    }
}

function parseCloudSyncMeta(documentPath: string, raw: unknown): SyncMeta {
    try {
        return parseSyncMeta(raw);
    } catch (error) {
        throw new InvalidCloudSyncMetadataError(documentPath, error);
    }
}

export async function hydrateLocal(owner: string, cloudData: UserData, months: string[], cloudDocuments?: Map<string, DocumentData>, coverageMode: CloudCoverageMode = 'window', guard?: LocalWriteGuard): Promise<LocalEnvelope> {
    owner = normalizeStorageOwner(owner);
    // UserDataSchema has a catch-all fallback: never treat a non-object
    // cloud transport payload as a confirmed empty account snapshot.
    if (cloudData === null || typeof cloudData !== 'object' || Array.isArray(cloudData)) {
        throw new Error('Snapshot cloud non valido: hydration sospesa per preservare il journal.');
    }
    const cloud = structuredClone(parse(cloudData));
    let saved: LocalEnvelope | undefined;
    let integrityFailure: IncompleteCloudSnapshotError | undefined;
    const catalog = await getCachedCatalog();
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) return raw;
        const current = validateLocalEnvelope(raw, owner);
        if (!current) {
            const syncMetaByDocument: Record<string, SyncMeta> = {};
            const clock: Record<string, number> = {};
            if (cloudDocuments) for (const [path, doc] of cloudDocuments.entries()) if (doc._sync) {
                const meta = parseCloudSyncMeta(path, doc._sync);
                syncMetaByDocument[path] = meta;
                for (const [actor, seq] of Object.entries(meta.clock)) clock[actor] = Math.max(clock[actor] || 0, seq);
            }
            saved = { ...currentEnvelopeVersions(), ...ownerConsentRevision(owner), owner, actorId: generateId('actor'), actorSeq: 0, clock, data: cloud, baseline: cloud, completeMonths: months, pending: [], syncMetaByDocument, replica: null, revision: 0 };
        } else {
            // In the supported release, only server-confirmed documents may
            // enter the durable acknowledgement map. Even an empty, writerless
            // record is evidence we cannot silently discard on a later read.
            const durableMeta = current.syncMetaByDocument;
            const syncMeta: Record<string, SyncMeta> = {};
            const authoritativePaths = new Set(['', ...months.map(m => `history_months/${m}`), ...months.map(m => `nutrition_months/${m}`)]);
            // A full scan may race with a newer acknowledgement in another tab.
            // Protocol 3 does not physically delete sync documents. If a document
            // with known durable causal metadata is absent (or lacks _sync), the
            // response cannot prove that its acknowledged data was removed.
            // Reject before installing the cloud snapshot or claiming a checkpoint.
            const missingPaths = cloudDocuments
                ? Object.keys(durableMeta).filter(path =>
                    (coverageMode === 'all' || authoritativePaths.has(path))
                    && !cloudDocuments.get(path)?._sync
                )
                : [];
            if (missingPaths.length) {
                integrityFailure = new IncompleteCloudSnapshotError(
                    'Snapshot cloud incompleto rispetto alla copia locale: sincronizzazione sospesa senza cancellare dati.',
                    'missing-document', missingPaths,
                );
                // The same IndexedDB commit that detects missing acknowledged
                // evidence also installs the owner-scoped destructive-purge fence.
                return fenceCloudIntegrity(current);
            }
            if (coverageMode === 'window') for (const [path, meta] of Object.entries(durableMeta)) if (!authoritativePaths.has(path)) syncMeta[path] = meta;
            const updatedClock = { ...current.clock };
            const stalePaths: string[] = [];
            if (cloudDocuments) for (const [path, doc] of cloudDocuments.entries()) if (doc._sync) {
                const meta = parseCloudSyncMeta(path, doc._sync);
                const durable = durableMeta[path];
                if ((coverageMode === 'all' || authoritativePaths.has(path)) && durable
                    && !coversVectorClock(meta.clock, durable.clock)) {
                    stalePaths.push(path);
                }
                syncMeta[path] = meta;
                for (const [actor, seq] of Object.entries(meta.clock)) updatedClock[actor] = Math.max(updatedClock[actor] || 0, seq);
            }
            // A delayed or causally incomparable snapshot cannot certify a replica
            // checkpoint, even if the local envelope is preserved. Fail closed so the
            // caller does not publish a frontier derived from stale cloud evidence.
            if (stalePaths.length) {
                integrityFailure = new IncompleteCloudSnapshotError(
                    'Snapshot cloud non aggiornato rispetto alla copia locale: checkpoint sospeso senza sovrascrivere dati.',
                    'stale-document', stalePaths,
                );
                return fenceCloudIntegrity(current);
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
            const { documents: mergedDocs } = applySemanticOperations(localDocs, current.pending, syncMeta);
            const data = applyRemoteDocuments(applicationBase, mergedDocs, catalog);
            data.pendingConflicts = current.data.pendingConflicts;
            const parsedData = parse(data);
            saved = { ...current, ...currentEnvelopeVersions(), clock: updatedClock, data: parsedData, baseline: parsedBaseline, completeMonths: coverageMode === 'all' ? [...new Set(months)] : [...new Set([...current.completeMonths, ...months])], // Derived merge stamps belong to the pending journal, not to the
                // acknowledged cloud frontier. Only server reads can prove
                // that a document was ever stored remotely.
                syncMetaByDocument: syncMeta };
        }
        return saved;
    });
    if (integrityFailure) throw integrityFailure;
    if (!saved) throw new Error('Hydration locale invalidata o non riuscita');
    return saved;
}
