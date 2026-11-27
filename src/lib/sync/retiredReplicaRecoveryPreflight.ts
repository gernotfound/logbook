import equal from 'fast-deep-equal';
import type { CachedGlobalCatalog } from '../../types';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import type { CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { projectDocuments } from './documentProjection';
import type { LocalEnvelope } from './localEnvelopeValidation';
import { userOwner } from './owner';
import { isReplicaMembershipEligible, parseReplicaControl } from './replicaProtocol';
import { applySemanticOperations, parseSyncMeta } from './semanticProjection';
import { pathFromFieldKey } from './semanticProjection/metadata';

type RetiredReplicaDivergenceEvidence = Readonly<{
    changedCloudFieldStamps: number;
    pendingWithOverlappingCloudStamps: number;
    unclassifiedDocuments: number;
}>;

export type RetiredReplicaRecoveryPreflight =
    | { kind: 'baseline-unchanged'; pendingOperations: number; cloudRevision: number }
    | { kind: 'reconciliation-required'; reason:
        'no-pending' | 'transition' | 'no-old-replica' | 'replica-active' | 'possible-lost-ack'
        | 'local-replay-diverged' }
    | { kind: 'reconciliation-required'; reason: 'cloud-diverged'; evidence: RetiredReplicaDivergenceEvidence };

function pathsOverlap(left: readonly string[], right: readonly string[]): boolean {
    const prefixLength = Math.min(left.length, right.length);
    return left.slice(0, prefixLength).every((segment, index) => segment === right[index]);
}

/**
 * Counts causal witnesses, not user-visible conflicts or safe-to-replay edits.
 * A field-level non-overlap cannot prove semantic independence (guards,
 * derived state and absent/compacted stamps also matter). No values or paths
 * leave this summary, and recovery must still obtain fresh, atomic fences.
 */
function describeCloudDivergence(
    local: LocalEnvelope,
    cloud: AuthenticatedCloudflareCheckpoint,
    base: ReturnType<typeof projectDocuments>,
): RetiredReplicaDivergenceEvidence {
    let changedCloudFieldStamps = 0;
    let unclassifiedDocuments = 0;
    const overlappingPending = new Set<number>();
    const paths = new Set([...base.keys(), ...cloud.documents.keys(), ...Object.keys(local.syncMetaByDocument)]);
    for (const path of paths) {
        const baseline = base.get(path);
        const remote = cloud.documents.get(path);
        if (!baseline || !remote || !Object.hasOwn(local.syncMetaByDocument, path)) {
            unclassifiedDocuments++;
            continue;
        }
        const previousMeta = parseSyncMeta(local.syncMetaByDocument[path]);
        const currentMeta = parseSyncMeta(remote.sync);
        const fieldKeys = new Set([...Object.keys(previousMeta.fields), ...Object.keys(currentMeta.fields)]);
        let changedFields = 0;
        for (const key of fieldKeys) {
            if (equal(previousMeta.fields[key], currentMeta.fields[key])) continue;
            changedFields++;
            changedCloudFieldStamps++;
            const changedPath = pathFromFieldKey(key);
            local.pending.forEach((operation, index) => {
                if (operation.docPath === path && (pathsOverlap(operation.path, changedPath)
                    || (operation.guard && pathsOverlap(operation.guard.path, changedPath)))) {
                    overlappingPending.add(index);
                }
            });
        }
        // A changed document or frontier without field witnesses (e.g. ABA,
        // compaction or an out-of-band writer) cannot be classified by paths.
        if (changedFields === 0 && (!equal(baseline, remote.business)
            || !equal(previousMeta, currentMeta))) unclassifiedDocuments++;
    }
    return { changedCloudFieldStamps,
        pendingWithOverlappingCloudStamps: overlappingPending.size, unclassifiedDocuments };
}

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
    let diverged = base.size !== cloud.documents.size
        || Object.keys(local.syncMetaByDocument).length !== cloud.documents.size;
    for (const [path, expected] of base) {
        const verified = cloud.documents.get(path);
        if (!verified || !equal(expected, verified.business)
            || !Object.hasOwn(local.syncMetaByDocument, path)
            || !equal(parseSyncMeta(local.syncMetaByDocument[path]), parseSyncMeta(verified.sync))) {
            diverged = true;
        }
    }
    if (diverged) return { kind: 'reconciliation-required', reason: 'cloud-diverged',
        evidence: describeCloudDivergence(local, cloud, base) };
    const replay = applySemanticOperations(base, local.pending, local.syncMetaByDocument).documents;
    if (replay.size !== current.size || [...current].some(([path, desired]) => !equal(replay.get(path), desired))) {
        return { kind: 'reconciliation-required', reason: 'local-replay-diverged' };
    }
    return { kind: 'baseline-unchanged', pendingOperations: local.pending.length,
        cloudRevision: cloud.revision };
}
