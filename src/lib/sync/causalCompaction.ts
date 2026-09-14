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
    };
}

function pathDepth(fieldKey: string): number {
    return fieldKey.split('/').length;
}

/**
 * Lossless metadata compaction for the current hierarchical merge protocol.
 *
 * A deleted ancestor is a durable barrier for every descendant path. A descendant
 * stamp is redundant only when the ancestor's causal clock already covers the
 * descendant stamp's complete causal clock. Concurrent/unobserved descendants are
 * retained. Terminal tombstones and document-level actor coordinates are never
 * retired here because the protocol has no replica-membership/stable-frontier proof.
 */
export function compactSyncMeta(meta: SyncMeta): SyncMeta {
    const fields: Record<string, FieldStamp> = Object.fromEntries(
        Object.entries(meta.fields).map(([key, stamp]) => [key, cloneStamp(stamp)]),
    );

    const tombstones = Object.entries(fields)
        .filter(([, stamp]) => stamp.deleted === true)
        .sort(([left], [right]) => pathDepth(left) - pathDepth(right) || left.localeCompare(right));

    for (const [ancestorKey, ancestorStamp] of tombstones) {
        if (!fields[ancestorKey]) continue;
        const descendantPrefix = `${ancestorKey}/`;
        for (const [candidateKey, candidateStamp] of Object.entries(fields)) {
            if (!candidateKey.startsWith(descendantPrefix)) continue;
            if (coversVector(ancestorStamp.clock, candidateStamp.clock)) {
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
