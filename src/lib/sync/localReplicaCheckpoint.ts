import type { UserData } from '../../types';
import { UserDataSchema } from '../schema';
import { getCachedCatalog } from '../catalog/catalogService';
import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../schemaEvolution';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
import { projectDocuments } from './documentProjection';
import { diffDocuments, mergeVectors, type VectorClock } from './semanticProjection';
import { enforceMonthlyEntityTombstones } from './monthlyEntityTombstones';
import { sequenceOperationsForBoundedTransactions } from './syncBatching';
import type { ReplicaCheckpoint, CloudCheckpoint } from './replicaProtocol';

type LocalWriteGuard = () => boolean;
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const currentEnvelopeVersions = () => ({
    version: CURRENT_LOCAL_ENVELOPE,
    dataSchemaVersion: CURRENT_DATA_SCHEMA,
    syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
});

export async function adoptReplicaCheckpoint(
    owner: string,
    claim: ReplicaCheckpoint,
    checkpoint: CloudCheckpoint,
    guard?: LocalWriteGuard,
): Promise<LocalEnvelope> {
    owner = normalizeStorageOwner(owner);
    const catalog = await getCachedCatalog();
    let saved: LocalEnvelope | undefined;

    await updateArchiveRecord<unknown>(owner, raw => {
        if (guard && !guard()) return raw;
        const current = validateLocalEnvelope(raw, owner);
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
        const provisionalSeq = claim.baseSeq + 1;
        const provisionalClock: VectorClock = { ...checkpoint.clock, [actorId]: provisionalSeq };

        let operations = diffDocuments(baseDocs, desiredDocs, actorId, provisionalSeq, provisionalClock);
        operations = enforceMonthlyEntityTombstones(baseDocs, desiredDocs, operations, actorId, provisionalSeq, provisionalClock);
        const sequenced = sequenceOperationsForBoundedTransactions(
            operations,
            actorId,
            claim.baseSeq,
            checkpoint.clock,
        );
        operations = sequenced.operations;

        const actorSeq = operations.length ? sequenced.actorSeq : claim.baseSeq;
        const clock: VectorClock = operations.length
            ? sequenced.clock
            : { ...checkpoint.clock };

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
