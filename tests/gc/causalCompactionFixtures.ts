import { compactSyncMeta } from '../../src/lib/sync/causalCompaction';
import { applySemanticOperations, parseSyncMeta, type SemanticOperation, type SyncMeta } from '../../src/lib/sync/semanticProjection';
import type { DocumentData } from '../../src/lib/sync/documentProjection';

export const tombstonedProfileMeta = (): SyncMeta => ({
    protocolVersion: 3,
    clock: { A: 2, B: 1, C: 1, R: 1, ZERO: 0 },
    fields: {
        profile: { actorId: 'A', seq: 2, clock: { A: 2, B: 1, ZERO: 0 }, deleted: true },
        'profile/name': { actorId: 'A', seq: 1, clock: { A: 1 } },
        'profile/height': { actorId: 'B', seq: 1, clock: { B: 1 }, deleted: true },
        // C was never observed by the parent tombstone, so this stamp is not collectible.
        'profile/weight': { actorId: 'C', seq: 1, clock: { C: 1 } },
        routines: { actorId: 'R', seq: 1, clock: { R: 1 } },
    },
});


export function expandedDescendantBarrier(): SyncMeta {
    // Concurrent deletions may extend the barrier without changing the
    // winning event clock; both are accepted by the current metadata codec.
    return parseSyncMeta({
        protocolVersion: 3,
        clock: { s00: 1, s01: 1, s02: 1 },
        writer: { slot: 's00', replicaId: 'gc-barrier-fixture', generation: 1, seq: 1 },
        fields: {
            profile: {
                actorId: 's00', seq: 1, clock: { s00: 1, s01: 1 },
                deleted: true, deleteClock: { s00: 1, s01: 1 },
            },
            'profile/name': {
                actorId: 's01', seq: 1, clock: { s01: 1 },
                deleted: true, deleteClock: { s01: 1, s02: 1 },
            },
        },
    });
}

export function rootBase(): Map<string, DocumentData> {
    return new Map([['', {}]]);
}

export function applyOne(meta: SyncMeta, operation: SemanticOperation) {
    return applySemanticOperations(rootBase(), [operation], { '': meta });
}

export function compactedOutcome(meta: SyncMeta, operation: SemanticOperation) {
    const outcome = applyOne(meta, operation);
    return {
        documents: outcome.documents,
        syncMeta: compactSyncMeta(outcome.syncMetas['']),
    };
}

