import equal from 'fast-deep-equal';
import type { CachedGlobalCatalog } from '../../types';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import type { CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { projectDocuments } from './documentProjection';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
import { userOwner } from './owner';
import { collectRetiredReplicaCompetingEntities, preflightRetiredReplicaRecovery,
    type RetiredReplicaCompetingEntity } from './retiredReplicaRecoveryPreflight';
import { MAX_CONFLICT_ENTITIES, parseRetiredReplicaConflictCapsule,
    type RetiredReplicaConflictCapsule, type RetiredConflictVersion } from './retiredReplicaConflictRecord';
import { updateArchiveRecord } from './secureArchiveRepository';
import { parseSyncMeta } from './semanticProjection';

export function buildRetiredReplicaConflictCapsule(
    uid: string, local: LocalEnvelope, cloud: AuthenticatedCloudflareCheckpoint,
    control: CloudReplicaControlSnapshot, catalog: CachedGlobalCatalog,
    nowMs = Date.now(),
): RetiredReplicaConflictCapsule {
    const preflight = preflightRetiredReplicaRecovery(uid, local, cloud, control, catalog, nowMs);
    if (preflight.kind !== 'reconciliation-required' || preflight.reason !== 'cloud-diverged'
        || preflight.evidence.entitiesWithCompetingVersions === 0 || !local.replica) {
        throw new Error('Conflitti autenticati non osservati: nessuna versione archiviata.');
    }
    const base = projectDocuments(local.baseline, catalog);
    const desired = projectDocuments(local.data, catalog);
    const remote = new Map([...cloud.documents].map(([path, document]) => [path, document.business]));
    const competing = collectRetiredReplicaCompetingEntities(local, base, desired, remote);
    if (competing.length > MAX_CONFLICT_ENTITIES) throw new Error('Troppi conflitti: originali preservati.');
    const from = (located: RetiredReplicaCompetingEntity['baseline'], source: 'local' | 'cloud'): RetiredConflictVersion => {
        if (!located) return null;
        const sync = source === 'local' ? local.syncMetaByDocument[located.docPath]
            : cloud.documents.get(located.docPath)?.sync;
        return { docPath: located.docPath, value: structuredClone(located.value),
            sync: sync ? structuredClone(parseSyncMeta(sync)) : null };
    };
    const capsule: RetiredReplicaConflictCapsule = {
        format: 1, owner: userOwner(uid), consentRevision: control.consentRevision,
        fenceEpoch: control.fenceEpoch, cloudRevision: cloud.revision, localRevision: local.revision,
        sourceReplica: structuredClone(local.replica), sourceClock: structuredClone(local.clock),
        sourcePending: structuredClone(local.pending),
        sourceDocuments: [...new Set(local.pending.map(operation => operation.docPath))].sort().map(path => ({
            path, baseline: structuredClone(base.get(path) ?? null),
            device: structuredClone(desired.get(path) ?? null),
            sync: local.syncMetaByDocument[path]
                ? structuredClone(parseSyncMeta(local.syncMetaByDocument[path])) : null,
        })),
        capturedAt: new Date(nowMs).toISOString(),
        entries: competing.map(entry => ({ kind: entry.kind, entityId: entry.entityId,
            baseline: from(entry.baseline, 'local'), device: from(entry.device, 'local'),
            cloud: from(entry.cloud, 'cloud') })),
    };
    return parseRetiredReplicaConflictCapsule(capsule, local.owner);
}

/** Only the final encrypted IndexedDB transaction can accept this observation. */
export async function stageRetiredReplicaConflictCapsule(
    owner: string, observedLocal: LocalEnvelope, capsule: RetiredReplicaConflictCapsule,
    stillCurrent: () => boolean,
): Promise<number> {
    let storedCount = 0;
    await updateArchiveRecord<unknown>(owner, raw => {
        if (!stillCurrent()) throw new Error('Sessione mutata: conflitti originali preservati.');
        const current = validateLocalEnvelope(raw, owner);
        if (!current || !equal(current, observedLocal) || current.retiredReplicaConflictCapsule
            || current.cloudIntegrityFence || current.cloudflareDelivery || current.cloudflareReplicaClaim
            || current.cloudflareReplicaRetirement || current.cloudflareReplicaCancellation
            || current.consentRevision !== capsule.consentRevision
            || !equal(current.replica, capsule.sourceReplica) || current.revision !== capsule.localRevision) {
            throw new Error('Conflitto concorrente o già archiviato: nessuna versione sostituita.');
        }
        const validated = parseRetiredReplicaConflictCapsule(capsule, owner);
        storedCount = validated.entries.length;
        return { ...current, retiredReplicaConflictCapsule: validated, revision: current.revision + 1 };
    });
    return storedCount;
}
