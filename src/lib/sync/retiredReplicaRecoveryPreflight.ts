import equal from 'fast-deep-equal';
import type { CachedGlobalCatalog } from '../../types';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import type { CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { projectDocuments, type DocumentData } from './documentProjection';
import type { LocalEnvelope } from './localEnvelopeValidation';
import { userOwner } from './owner';
import { isReplicaMembershipEligible, parseReplicaControl } from './replicaProtocol';
import {
    applySemanticOperations, coversVectorClock, diffDocuments, getMergePolicy, mergeVectors, parseSyncMeta,
} from './semanticProjection';
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

function hasIgnoredBusinessChange(path: string, baseline: DocumentData, remote: DocumentData): boolean {
    if (!path.startsWith('nutrition_months/')) return false;
    // The current semantic diff intentionally ignores calculated daily totals.
    // Their independent mutation is not proof of a safe causal reconciliation.
    for (const day of new Set([...Object.keys(baseline), ...Object.keys(remote)])) {
        const before = baseline[day];
        const after = remote[day];
        if ((before !== undefined && (!before || typeof before !== 'object' || Array.isArray(before)))
            || (after !== undefined && (!after || typeof after !== 'object' || Array.isArray(after)))) return true;
        // A newly added/removed day still changes ignored totals. A field
        // stamp on the day must not make those omitted changes disappear.
        const left = (before ?? {}) as Record<string, unknown>;
        const right = (after ?? {}) as Record<string, unknown>;
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
            if (getMergePolicy(path, [day, key]) === 'ignore' && !equal(left[key], right[key])) return true;
        }
    }
    return false;
}

function hasUnexplainedBusinessChange(
    path: string,
    baseline: DocumentData,
    remote: DocumentData,
    witnessedPaths: readonly string[][],
): boolean {
    if (equal(baseline, remote)) return false;
    try {
        const changes = diffDocuments(new Map([[path, baseline]]), new Map([[path, remote]]),
            'diagnostic', 1, { diagnostic: 1 });
        // A changed child stamp cannot explain a wholesale parent replacement.
        // Nor can a semantic diff explain fields intentionally ignored by its policy.
        return changes.length === 0 || hasIgnoredBusinessChange(path, baseline, remote)
            || changes.some(change => !witnessedPaths.some(witness =>
                witness.length <= change.path.length && pathsOverlap(witness, change.path)));
    } catch {
        // A diagnostic must not interpret an un-diffable document as independent.
        return true;
    }
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
        let explainedClock = previousMeta.clock;
        const witnessedPaths: string[][] = [];
        for (const key of fieldKeys) {
            if (equal(previousMeta.fields[key], currentMeta.fields[key])) continue;
            changedFields++;
            changedCloudFieldStamps++;
            const changedPath = pathFromFieldKey(key);
            const currentStamp = currentMeta.fields[key];
            if (currentStamp) {
                witnessedPaths.push(changedPath);
                explainedClock = mergeVectors(explainedClock, currentStamp.clock,
                    ...(currentStamp.deleteClock ? [currentStamp.deleteClock] : []),
                    ...(currentStamp.candidates?.map(candidate => candidate.clock) ?? []));
            }
            local.pending.forEach((operation, index) => {
                if (operation.docPath === path && (pathsOverlap(operation.path, changedPath)
                    || (operation.guard && pathsOverlap(operation.guard.path, changedPath)))) {
                    overlappingPending.add(index);
                }
            });
        }
        // A legitimate stamped edit can coexist with an untracked business edit
        // or an advanced frontier. Never let the presence of one stamp mask it.
        if (hasUnexplainedBusinessChange(path, baseline, remote.business, witnessedPaths)
            || !coversVectorClock(currentMeta.clock, previousMeta.clock)
            || !coversVectorClock(explainedClock, currentMeta.clock)
            || (changedFields === 0 && !equal(previousMeta, currentMeta))) {
            unclassifiedDocuments++;
        }
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
    // D1 inherits lastSeq when a slot is reused. Even a NEW generation with
    // an overlapping sequence cannot disprove a lost ACK from its predecessor:
    // the counter alone identifies neither the committed incarnation nor its
    // immutable body. Only a content-bound receipt can close that journal.
    if (entry && local.pending.some(op => op.seq <= entry.lastSeq)) {
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
