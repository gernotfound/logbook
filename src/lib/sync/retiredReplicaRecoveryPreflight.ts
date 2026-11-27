import equal from 'fast-deep-equal';
import type { CachedGlobalCatalog } from '../../types';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import type { CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { projectDocuments } from './documentProjection';
import type { LocalEnvelope } from './localEnvelopeValidation';
import { userOwner } from './owner';
import { isReplicaMembershipEligible, parseReplicaControl } from './replicaProtocol';
import { applySemanticOperations, parseSyncMeta } from './semanticProjection';

export type RetiredReplicaRecoveryPreflight =
    | { kind: 'baseline-unchanged'; pendingOperations: number; cloudRevision: number }
    | { kind: 'reconciliation-required'; reason:
        'no-pending' | 'transition' | 'no-old-replica' | 'replica-active' | 'possible-lost-ack'
        | 'cloud-diverged' | 'local-replay-diverged' };

/**
 * Read-only precondition for a future explicit recovery. Even an unchanged
 * baseline is not permission to claim, rewrite or acknowledge: the remote
 * revision, session, consent and local journal need fresh atomic fences at
 * the eventual write. A lost ACK must never be inferred from clock coverage.
 */
export function preflightRetiredReplicaRecovery(
    uid: string,
    local: LocalEnvelope,
    cloud: AuthenticatedCloudflareCheckpoint,
    control: CloudReplicaControlSnapshot,
    catalog: CachedGlobalCatalog,
    nowMs = Date.now(),
): RetiredReplicaRecoveryPreflight {
    if (local.owner !== userOwner(uid) || local.cloudIntegrityFence
        || local.consentRevision !== control.consentRevision
        || control.uid !== uid || control.revision !== cloud.revision
        || control.consentRevision !== cloud.consentRevision
        || control.fenceEpoch !== cloud.fenceEpoch) {
        throw new Error('Preflight replica: owner, consenso o snapshot D1 non verificabile.');
    }
    if (!local.pending.length) return { kind: 'reconciliation-required', reason: 'no-pending' };
    if (local.cloudflareDelivery || local.cloudflareReplicaClaim
        || local.cloudflareReplicaRetirement || local.cloudflareReplicaCancellation) {
        return { kind: 'reconciliation-required', reason: 'transition' };
    }
    const previous = local.replica;
    if (!previous || previous.slot !== local.actorId) {
        return { kind: 'reconciliation-required', reason: 'no-old-replica' };
    }
    const parsed = parseReplicaControl({
        protocolVersion: 3, consentRevision: control.consentRevision, replicas: control.replicas,
        mutation: { slot: previous.slot, action: 'checkpoint' },
    });
    const entry = parsed.replicas[previous.slot];
    const sameIncarnation = entry?.replicaId === previous.replicaId
        && entry.generation === previous.generation;
    if (sameIncarnation && entry && isReplicaMembershipEligible(entry, nowMs)) {
        return { kind: 'reconciliation-required', reason: 'replica-active' };
    }
    // A remote lastSeq from the original incarnation may cover a delivered
    // prefix whose local receipt was lost. Only a content-bound receipt and
    // guarded local ACK can close it; never reissue it under a new actor.
    if (sameIncarnation && local.pending.some(op => op.seq <= entry.lastSeq)) {
        return { kind: 'reconciliation-required', reason: 'possible-lost-ack' };
    }

    const base = projectDocuments(local.baseline, catalog);
    const current = projectDocuments(local.data, catalog);
    if (base.size !== cloud.documents.size
        || Object.keys(local.syncMetaByDocument).length !== cloud.documents.size) {
        return { kind: 'reconciliation-required', reason: 'cloud-diverged' };
    }
    for (const [path, expected] of base) {
        const verified = cloud.documents.get(path);
        if (!verified || !equal(expected, verified.business)
            || !Object.hasOwn(local.syncMetaByDocument, path)
            || !equal(parseSyncMeta(local.syncMetaByDocument[path]), parseSyncMeta(verified.sync))) {
            return { kind: 'reconciliation-required', reason: 'cloud-diverged' };
        }
    }
    const replay = applySemanticOperations(base, local.pending, local.syncMetaByDocument).documents;
    if (replay.size !== current.size || [...current].some(([path, desired]) => !equal(replay.get(path), desired))) {
        return { kind: 'reconciliation-required', reason: 'local-replay-diverged' };
    }
    return { kind: 'baseline-unchanged', pendingOperations: local.pending.length,
        cloudRevision: cloud.revision };
}
