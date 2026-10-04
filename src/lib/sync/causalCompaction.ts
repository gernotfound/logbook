import type { FieldStamp, SyncMeta, VectorClock } from './semanticProjection';

export function compactVector(clock: VectorClock): VectorClock {
    const compacted: VectorClock = {};
    for (const [actorId, seq] of Object.entries(clock)) {
        if (seq > 0) compacted[actorId] = seq;
    }
    return compacted;
}

export function coversVector(cover: VectorClock, covered: VectorClock): boolean {
    for (const [actorId, seq] of Object.entries(covered)) {
        if ((cover[actorId] ?? 0) < seq) return false;
    }
    return true;
}

function cloneStamp(stamp: FieldStamp): FieldStamp {
    return {
        ...stamp,
        clock: compactVector(stamp.clock),
        ...(stamp.deleteClock ? { deleteClock: compactVector(stamp.deleteClock) } : {}),
        ...(stamp.legacyClock ? { legacyClock: compactVector(stamp.legacyClock) } : {}),
        ...(stamp.guard ? { guard: structuredClone(stamp.guard) } : {}),
        ...(stamp.candidates?.length ? {
            candidates: stamp.candidates.map(candidate => ({
                ...candidate,
                clock: compactVector(candidate.clock),
                ...(candidate.legacyClock ? { legacyClock: compactVector(candidate.legacyClock) } : {}),
                ...(candidate.guard ? { guard: structuredClone(candidate.guard) } : {}),
                value: structuredClone(candidate.value),
            })),
        } : {}),
    };
}

function pathDepth(fieldKey: string): number {
    return fieldKey.split('/').length;
}

/**
 * Lossless metadata compaction for the current hierarchical merge protocol.
 *
 * A remove-wins delete barrier is durable for every descendant path, including after
 * recreation. A descendant stamp is redundant only when that delete barrier already
 * covers the descendant's complete causal clock. Concurrent/unobserved descendants
 * are retained. Terminal barriers and document-level actor coordinates are never
 * retired here because the protocol has no replica-membership/stable-frontier proof.
 */
export function compactSyncMeta(meta: SyncMeta): SyncMeta {
    const fields: Record<string, FieldStamp> = Object.fromEntries(
        Object.entries(meta.fields).map(([key, stamp]) => [key, cloneStamp(stamp)]),
    );

    const deleteBarriers = Object.entries(fields)
        .filter(([, stamp]) => stamp.deleted === true || stamp.deleteClock !== undefined)
        .sort(([left], [right]) => pathDepth(left) - pathDepth(right) || left.localeCompare(right));

    for (const [ancestorKey, ancestorStamp] of deleteBarriers) {
        if (!fields[ancestorKey]) continue;
        const coverage = ancestorStamp.deleteClock ?? ancestorStamp.clock;
        const descendantPrefix = `${ancestorKey}/`;
        for (const [candidateKey, candidateStamp] of Object.entries(fields)) {
            if (!candidateKey.startsWith(descendantPrefix)) continue;
            if (coversVector(coverage, candidateStamp.clock)) {
                delete fields[candidateKey];
            }
        }
    }

    return {
        protocolVersion: meta.protocolVersion,
        clock: compactVector(meta.clock),
        fields,
    };
}

export function compactSyncMetas(metas: Record<string, SyncMeta>): Record<string, SyncMeta> {
    return Object.fromEntries(
        Object.entries(metas).map(([path, meta]) => [path, compactSyncMeta(meta)]),
    );
}
