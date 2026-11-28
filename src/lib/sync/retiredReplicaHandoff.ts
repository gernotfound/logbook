import equal from 'fast-deep-equal';
import type { CachedGlobalCatalog, UserData } from '../../types';
import { UserDataSchema } from '../schema';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from './documentProjection';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
import { normalizeStorageOwner } from './owner';
import { checkpointFromCloudDocuments, type ReplicaCheckpoint } from './replicaProtocol';
import { parseRetiredReplicaTransferDraft, type RetiredReplicaTransferDraft } from './retiredReplicaTransferDraftRecord';
import { updateArchiveRecord } from './secureArchiveRepository';
import { applySemanticOperations, diffDocuments, mergeVectors } from './semanticProjection';
import { enforceMonthlyEntityTombstones } from './monthlyEntityTombstones';
import { sequenceOperationsForBoundedTransactions } from './syncBatching';

function originalStillIntact(local: LocalEnvelope, draft: RetiredReplicaTransferDraft): boolean {
    return local.owner === draft.owner && local.consentRevision === draft.consentRevision
        && equal(local.replica, draft.sourceReplica) && local.actorId === draft.sourceReplica.slot
        && local.actorSeq === draft.sourceActorSeq && equal(local.clock, draft.sourceClock)
        && equal(local.pending, draft.sourcePending) && equal(local.baseline, draft.sourceBaseline)
        && equal(local.data, draft.sourceData)
        && equal(local.syncMetaByDocument, draft.sourceSyncMetaByDocument);
}

/** A retired actor's journal remains the authority until the new claim is proved and adopted. */
export function hasIntactRetiredReplicaHandoff(local: LocalEnvelope): boolean {
    const draft = local.retiredReplicaTransferDraft;
    return Boolean(draft && originalStillIntact(local, draft));
}

/** Complete AEAD source equality, independent of D1 pagination/document iteration order. */
export function matchRetiredReplicaDraftCloud(
    draft: RetiredReplicaTransferDraft, cloud: AuthenticatedCloudflareCheckpoint,
): boolean {
    if (cloud.consentRevision !== draft.consentRevision || cloud.fenceEpoch !== draft.fenceEpoch
        || cloud.documents.size !== draft.remoteDocuments.length) return false;
    return draft.remoteDocuments.every(original => {
        const current = cloud.documents.get(original.path);
        return current && equal(current.business, original.business) && equal(current.sync, original.sync);
    });
}

/**
 * One owner-vault commit replaces ONLY the causal writer after its own live
 * claim receipt and a fresh complete AEAD scan. The original pending/choices
 * remain immutable in the escrow even after the newly sequenced journal ACKs.
 * A lost claim response or an old-generation receipt is never sufficient.
 */
export async function adoptRetiredReplicaHandoff(
    ownerInput: string, claim: ReplicaCheckpoint,
    cloud: AuthenticatedCloudflareCheckpoint, catalog: CachedGlobalCatalog,
    expectedClaimId: string, expectedLocal: LocalEnvelope, guard: () => boolean,
): Promise<LocalEnvelope> {
    const owner = normalizeStorageOwner(ownerInput);
    const draft = expectedLocal.retiredReplicaTransferDraft;
    if (!guard() || !draft || !hasIntactRetiredReplicaHandoff(expectedLocal)
        || !matchRetiredReplicaDraftCloud(draft, cloud)
        || expectedLocal.cloudflareReplicaClaim?.mutationId !== expectedClaimId
        || expectedLocal.cloudflareReplicaClaim.expectedFenceEpoch !== draft.fenceEpoch
        || expectedLocal.cloudflareReplicaClaim.consentRevision !== draft.consentRevision
        || claim.identity.replicaId === draft.sourceReplica.replicaId
        || (claim.identity.slot === draft.sourceReplica.slot
            && claim.identity.generation <= draft.sourceReplica.generation)) {
        throw new Error('Trasferimento ritirato non autorizzato: originali cifrati preservati.');
    }
    parseRetiredReplicaTransferDraft(draft, owner);

    const source = {
        ...UserDataSchema.parse({}) as unknown as UserData,
        // Pending conflicts are local-only UI recovery evidence, not part of
        // any encrypted cloud document. Keep them through writer replacement.
        pendingConflicts: structuredClone(expectedLocal.data.pendingConflicts),
    };
    const remote = new Map<string, DocumentData>();
    const proposed = new Map<string, DocumentData>();
    const evidence = new Map<string, Record<string, unknown>>();
    for (const [path, document] of cloud.documents) {
        remote.set(path, structuredClone(document.business));
        evidence.set(path, { _sync: document.sync });
    }
    for (const document of draft.proposedDocuments) proposed.set(document.path, structuredClone(document.business));
    if ([...remote.keys()].some(path => !proposed.has(path))) {
        throw new Error('Copertura proposta non completa: journal originale preservato.');
    }
    const baseline = applyRemoteDocuments(source, remote, catalog);
    const data = applyRemoteDocuments(source, proposed, catalog);
    const baseDocuments = projectDocuments(baseline, catalog);
    const desiredDocuments = projectDocuments(data, catalog);
    const allPaths = new Set([...remote.keys(), ...proposed.keys()]);
    for (const path of allPaths) {
        if (!baseDocuments.has(path) && path !== '') baseDocuments.set(path, {});
        if (!desiredDocuments.has(path) && path !== '') desiredDocuments.set(path, {});
        if (!equal(baseDocuments.get(path), remote.get(path) ?? {})
            || !equal(desiredDocuments.get(path), proposed.get(path))) {
            throw new Error('Proiezione dei dati recuperati non conservativa: originali preservati.');
        }
    }
    if (baseDocuments.size !== allPaths.size || desiredDocuments.size !== allPaths.size) {
        throw new Error('Copertura mensile del trasferimento incompleta.');
    }
    const checkpoint = checkpointFromCloudDocuments(evidence);
    const actorId = claim.identity.slot;
    if ((checkpoint.clock[actorId] ?? 0) > claim.baseSeq) {
        throw new Error('Sequenza della nuova replica precedente al cloud: originali preservati.');
    }
    const initialClock = mergeVectors(checkpoint.clock, claim.baseSeq ? { [actorId]: claim.baseSeq } : {});
    const provisionalSeq = claim.baseSeq + 1;
    if (!Number.isSafeInteger(provisionalSeq)) throw new Error('Sequenza replica esaurita.');
    const provisionalClock = { ...initialClock, [actorId]: provisionalSeq };
    let operations = diffDocuments(baseDocuments, desiredDocuments, actorId, provisionalSeq, provisionalClock);
    operations = enforceMonthlyEntityTombstones(baseDocuments, desiredDocuments, operations,
        actorId, provisionalSeq, provisionalClock);
    const sequenced = sequenceOperationsForBoundedTransactions(operations, actorId, claim.baseSeq, initialClock);
    const replay = applySemanticOperations(baseDocuments, sequenced.operations, checkpoint.syncMetaByDocument);
    if (replay.documents.size !== proposed.size || [...proposed].some(([path, business]) => !equal(replay.documents.get(path), business))) {
        throw new Error('Replay del nuovo journal non equivalente alla scelta originale.');
    }

    let saved: LocalEnvelope | undefined;
    await updateArchiveRecord<unknown>(owner, raw => {
        if (!guard()) throw new Error('Sessione cambiata: originali cifrati preservati.');
        const current = validateLocalEnvelope(raw, owner);
        if (!current || !equal(current, expectedLocal) || !hasIntactRetiredReplicaHandoff(current)
            || current.cloudIntegrityFence || current.cloudflareDelivery || current.cloudflareReplicaRetirement
            || current.cloudflareReplicaCancellation) {
            throw new Error('Journal concorrente o claim cambiato: trasferimento sospeso.');
        }
        saved = validateLocalEnvelope({
            ...current, actorId, actorSeq: sequenced.actorSeq, clock: sequenced.clock,
            baseline, data, pending: sequenced.operations, replica: claim.identity,
            syncMetaByDocument: checkpoint.syncMetaByDocument,
            completeMonths: [...new Set([...current.completeMonths,
                ...[...proposed.keys()].filter(path => path !== '').map(path => path.split('/')[1])])],
            cloudflareReplicaClaim: undefined, revision: current.revision + 1,
        }, owner);
        return saved;
    });
    if (!saved) throw new Error('Trasferimento D1 non persistito.');
    return saved;
}
