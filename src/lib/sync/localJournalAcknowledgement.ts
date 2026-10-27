import equal from 'fast-deep-equal';
import type { UserData } from '../../types';
import { UserDataSchema } from '../schema';
import { getCachedCatalog } from '../catalog/catalogService';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope } from './localEnvelopeValidation';
import { projectDocuments, applyRemoteDocuments, type DocumentData } from './documentProjection';
import { type SemanticOperation, type SyncMeta, applySemanticOperations, coversVectorClock } from './semanticProjection';
import type { ReplicaIdentity } from './replicaProtocol';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

/**
 * A remote delivery is not proof that a later local envelope still contains
 * the same operations. Verify the exact delivered prefix and replica generation
 * inside the IndexedDB update before retiring any local journal entries.
 */
export async function acknowledgeThrough(
    owner: string,
    expectedSeq: number,
    remote: UserData,
    months: string[] = [],
    syncMeta?: Record<string, SyncMeta>,
    delivery?: { operations: SemanticOperation[]; replica: ReplicaIdentity },
): Promise<void> {
    owner = normalizeStorageOwner(owner);
    // The general UserData schema uses a catch-all default. Reject malformed
    // transport envelopes before it can turn an invalid ACK into empty data.
    if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) {
        throw new Error('Snapshot cloud non valido: acknowledgement sospeso per preservare il journal.');
    }
    const parsed = parse(remote);
    const catalog = await getCachedCatalog();
    await updateArchiveRecord<unknown>(owner, raw => {
        const current = validateLocalEnvelope(raw, owner);
        if (!current) throw new Error('Archivio locale non trovato');
        if (delivery) {
            const replica = current.replica;
            const sameReplica = replica !== null
                && replica.slot === delivery.replica.slot
                && replica.replicaId === delivery.replica.replicaId
                && replica.generation === delivery.replica.generation
                && current.actorId === delivery.replica.slot;
            const deliveredPrefix = current.pending.filter(op => op.seq <= expectedSeq);
            if (!sameReplica
                || delivery.operations.length === 0
                || delivery.operations[delivery.operations.length - 1]?.seq !== expectedSeq
                || !equal(deliveredPrefix, delivery.operations)) {
                throw new Error('Acknowledgement invalidato: replica o batch locale cambiati; journal preservato.');
            }
        }
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
        // The confirmed transaction touched only the delivered document paths.
        // Preserve unrelated months/root hydrated by another tab while it was in flight.
        const projectedRemote = projectDocuments(parsed, catalog);
        const deliveredDocs = delivery
            ? new Map<string, DocumentData>(
                [...new Set(delivery.operations.map(op => op.docPath))]
                    .map(path => [path, projectedRemote.get(path) ?? {}]),
            )
            : null;
        // A delivered empty monthly document must clear that month, but must
        // never clear a different month absent from this transaction.
        const acknowledgedBaseline = deliveredDocs
            ? parse(applyRemoteDocuments(current.baseline, deliveredDocs, catalog))
            : parsed;
        const acknowledgedState = deliveredDocs
            ? parse(applyRemoteDocuments(current.data, deliveredDocs, catalog))
            : parsed;
        const remoteDocs = projectDocuments(acknowledgedState, catalog);
        const { documents: mergedDocs } = applySemanticOperations(remoteDocs, pending, newSyncMeta);
        const reconciled = applyRemoteDocuments(current.data, mergedDocs, catalog);
        reconciled.pendingConflicts = current.data.pendingConflicts;
        const data = parse(reconciled);
        // Persist only server-confirmed metadata; replayed pending operations are
        // speculative and must never become evidence that a cloud document exists.
        return { ...current, clock: newClock, baseline: acknowledgedBaseline, data, pending, completeMonths: [...new Set([...current.completeMonths, ...months])], syncMetaByDocument: newSyncMeta };
    });
}
