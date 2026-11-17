import type { FieldStamp, SyncMeta, VectorClock } from './semanticProjection';
import { coversVectorClock } from './semanticProjection/metadata';
import { setOwnDataProperty } from '../utils/object';

function compactVector(clock: VectorClock): VectorClock {
    const compacted: VectorClock = {};
    for (const [actorId, seq] of Object.entries(clock)) {
        if (seq > 0) setOwnDataProperty(compacted, actorId, seq);
    }
    return compacted;
}

export function coversVector(cover: VectorClock, covered: VectorClock): boolean {
    return coversVectorClock(cover, covered);
}

function cloneStamp(stamp: FieldStamp): FieldStamp {
    return {
        ...stamp,
        clock: compactVector(stamp.clock),
        ...(stamp.deleteClock ? { deleteClock: compactVector(stamp.deleteClock) } : {}),
        ...(stamp.guard ? { guard: structuredClone(stamp.guard) } : {}),
        ...(stamp.candidates?.length ? {
            candidates: stamp.candidates.map(candidate => ({
                ...candidate,
                clock: compactVector(candidate.clock),
                ...(candidate.guard ? { guard: structuredClone(candidate.guard) } : {}),
                value: structuredClone(candidate.value),
            })),
        } : {}),
    };
}

function pathDepth(fieldKey: string): number {
    return fieldKey.split('/').length;
}

function forEachAncestorKey(key: string, visit: (ancestor: string) => void): void {
    for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1)) {
        visit(key.slice(0, slash));
    }
}

/**
 * Lossless metadata compaction for the current hierarchical merge protocol.
 *
 * A remove-wins delete barrier is durable for every descendant path, including after
 * recreation. A descendant stamp is redundant only when that delete barrier already
 * covers the descendant's complete causal clock. Concurrent/unobserved descendants
 * are retained. Terminal barriers require a stable-frontier proof; positive
 * document-level actor coordinates remain persisted even after terminal GC.
 */
function stampClocks(stamp: FieldStamp): VectorClock[] {
    return [
        stamp.clock,
        ...(stamp.deleteClock ? [stamp.deleteClock] : []),
        ...(stamp.candidates ?? []).flatMap(candidate => [
            candidate.clock,
        ]),
    ];
}

function coversStamp(cover: VectorClock, stamp: FieldStamp): boolean {
    return stampClocks(stamp).every(clock => coversVector(cover, clock));
}

export function compactSyncMeta(meta: SyncMeta, stableFrontier?: VectorClock): SyncMeta {
    const fields: Record<string, FieldStamp> = Object.fromEntries(
        Object.entries(meta.fields).map(([key, stamp]) => [key, cloneStamp(stamp)]),
    );

    const deleteBarriers = Object.entries(fields)
        .filter(([, stamp]) => stamp.deleted === true || stamp.deleteClock !== undefined)
        .sort(([left], [right]) => pathDepth(left) - pathDepth(right) || left.localeCompare(right));

    // Index only actual hierarchical descendants, preserving the field insertion
    // order of the previous scan. Coverage checks below remain unchanged.
    const descendantKeys = new Map<string, string[]>();
    if (deleteBarriers.length) {
        for (const key of Object.keys(fields)) {
            forEachAncestorKey(key, ancestor => {
                const descendants = descendantKeys.get(ancestor);
                if (descendants) descendants.push(key);
                else descendantKeys.set(ancestor, [key]);
            });
        }
    }

    for (const [ancestorKey, ancestorStamp] of deleteBarriers) {
        if (!Object.hasOwn(fields, ancestorKey)) continue;
        const coverage = ancestorStamp.deleteClock ?? ancestorStamp.clock;
        for (const candidateKey of descendantKeys.get(ancestorKey) ?? []) {
            const candidateStamp = Object.hasOwn(fields, candidateKey) ? fields[candidateKey] : undefined;
            if (!candidateStamp) continue;
            // Concurrent deletes can extend the barrier beyond the winner clock.
            // Removing the stamp must not discard those unobserved delete events.
            if (coversStamp(coverage, candidateStamp)) delete fields[candidateKey];
        }
    }

    if (stableFrontier) {
        for (const [key, stamp] of Object.entries(fields)) {
            if (!fields[key]) continue;

            if (!stamp.deleted && stamp.deleteClock && coversStamp(stableFrontier, stamp)) {
                const { deleteClock: _retiredBarrier, ...withoutBarrier } = stamp;
                fields[key] = withoutBarrier;
            }
        }

        const byDepthDesc = Object.keys(fields)
            .sort((left, right) => pathDepth(right) - pathDepth(left) || right.localeCompare(left));
        const descendantCounts = new Map<string, number>();
        for (const key of byDepthDesc) {
            forEachAncestorKey(key, ancestor => {
                descendantCounts.set(ancestor, (descendantCounts.get(ancestor) ?? 0) + 1);
            });
        }
        for (const key of byDepthDesc) {
            const stamp = Object.hasOwn(fields, key) ? fields[key] : undefined;
            if (!stamp?.deleted || !coversStamp(stableFrontier, stamp)) continue;
            if ((descendantCounts.get(key) ?? 0) > 0) continue;
            delete fields[key];
            forEachAncestorKey(key, ancestor => {
                descendantCounts.set(ancestor, (descendantCounts.get(ancestor) ?? 0) - 1);
            });
        }
    }

    return {
        protocolVersion: meta.protocolVersion,
        clock: compactVector(meta.clock),
        fields,
        ...(meta.writer ? { writer: { ...meta.writer } } : {}),
    };
}

export function compactSyncMetas(metas: Record<string, SyncMeta>, stableFrontier?: VectorClock): Record<string, SyncMeta> {
    return Object.fromEntries(
        Object.entries(metas).map(([path, meta]) => [path, compactSyncMeta(meta, stableFrontier)]),
    );
}
