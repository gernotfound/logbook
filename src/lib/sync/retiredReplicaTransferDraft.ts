import equal from 'fast-deep-equal';
import type { CachedGlobalCatalog } from '../../types';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import type { CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
import { userOwner } from './owner';
import { previewRetiredReplicaTransferCoverage } from './retiredReplicaTransferCoverage';
import { parseRetiredReplicaTransferDraft, type RetiredReplicaTransferDraft } from './retiredReplicaTransferDraftRecord';
import { updateArchiveRecord } from './secureArchiveRepository';

/** Prepare historical evidence from an authenticated full scan, without a cloud or local write. */
export function buildRetiredReplicaTransferDraft(
    uid: string, local: LocalEnvelope, cloud: AuthenticatedCloudflareCheckpoint,
    control: CloudReplicaControlSnapshot, catalog: CachedGlobalCatalog, nowMs = Date.now(),
): RetiredReplicaTransferDraft {
    const coverage = previewRetiredReplicaTransferCoverage(local, cloud, control, catalog);
    if (local.retiredReplicaTransferDraft || local.owner !== userOwner(uid)
        || local.consentRevision !== control.consentRevision || cloud.consentRevision !== control.consentRevision
        || cloud.fenceEpoch !== control.fenceEpoch || cloud.revision !== control.revision) {
        throw new Error('Proposta di trasferimento non associabile al frontier corrente.');
    }
    // JSON round-trip matches the device vault's durable JSON representation;
    // no schema-added undefined values may change the historical snapshot.
    const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    return parseRetiredReplicaTransferDraft({
        format: 1, owner: local.owner, consentRevision: control.consentRevision,
        fenceEpoch: control.fenceEpoch, cloudRevision: coverage.cloudRevision,
        localRevision: coverage.localRevision, sourceReplica: snapshot(coverage.originalReplica),
        sourceActorSeq: local.actorSeq, sourceClock: snapshot(coverage.originalClock),
        sourcePending: snapshot(coverage.originalPending), sourceBaseline: snapshot(local.baseline),
        sourceData: snapshot(local.data), sourceSyncMetaByDocument: snapshot(local.syncMetaByDocument),
        remoteDocuments: [...cloud.documents].map(([path, item]) => ({
            path, business: snapshot(item.business), sync: snapshot(item.sync),
        })),
        proposedDocuments: [...coverage.proposedDocuments].map(([path, business]) => ({ path, business: snapshot(business) })),
        selectedConflicts: snapshot(coverage.selectedConflicts), capturedAt: new Date(nowMs).toISOString(),
    }, local.owner);
}

/** Encrypted single-transaction escrow, preserving the original actor and every pending sequence. */
export async function stageRetiredReplicaTransferDraft(
    owner: string, observedLocal: LocalEnvelope, draft: RetiredReplicaTransferDraft,
    stillCurrent: () => boolean,
): Promise<number> {
    let storedRevision = 0;
    await updateArchiveRecord<unknown>(owner, raw => {
        if (!stillCurrent()) throw new Error('Sessione cambiata: journal originale preservato.');
        const current = validateLocalEnvelope(raw, owner);
        if (!current || !equal(current, observedLocal) || current.retiredReplicaTransferDraft
            || current.cloudIntegrityFence || current.cloudflareDelivery || current.cloudflareReplicaClaim
            || current.cloudflareReplicaRetirement || current.cloudflareReplicaCancellation
            || current.consentRevision !== draft.consentRevision || current.revision !== draft.localRevision
            || !equal(current.replica, draft.sourceReplica) || current.actorSeq !== draft.sourceActorSeq
            || !equal(current.clock, draft.sourceClock) || !equal(current.pending, draft.sourcePending)
            || !equal(current.baseline, draft.sourceBaseline) || !equal(current.data, draft.sourceData)
            || !equal(current.syncMetaByDocument, draft.sourceSyncMetaByDocument)) {
            throw new Error('Stato locale concorrente: trasferimento non salvato.');
        }
        const verified = parseRetiredReplicaTransferDraft(draft, owner);
        storedRevision = current.revision + 1;
        return { ...current, retiredReplicaTransferDraft: verified, revision: storedRevision };
    });
    return storedRevision;
}
