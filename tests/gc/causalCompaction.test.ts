import { describe, expect, it } from 'vitest';
import { compactSyncMeta, coversVector } from '../../src/lib/sync/causalCompaction';
import {
    applySemanticOperations,
    type SemanticOperation,
    type SyncMeta,
} from '../../src/lib/sync/semanticProjection';
import type { DocumentData } from '../../src/lib/sync/documentProjection';

const tombstonedProfileMeta = (): SyncMeta => ({
    protocolVersion: 1,
    clock: { A: 2, B: 1, C: 1, ZERO: 0 },
    fields: {
        profile: { actorId: 'A', seq: 2, clock: { A: 2, B: 1, ZERO: 0 }, deleted: true },
        'profile/name': { actorId: 'A', seq: 1, clock: { A: 1 } },
        'profile/height': { actorId: 'B', seq: 1, clock: { B: 1 }, deleted: true },
        // C was never observed by the parent tombstone, so this stamp is not collectible.
        'profile/weight': { actorId: 'C', seq: 1, clock: { C: 1 } },
        routines: { actorId: 'R', seq: 1, clock: { R: 1 } },
    },
});

function rootBase(): Map<string, DocumentData> {
    return new Map([['', {}]]);
}

function applyOne(meta: SyncMeta, operation: SemanticOperation) {
    return applySemanticOperations(rootBase(), [operation], { '': meta });
}

function compactedOutcome(meta: SyncMeta, operation: SemanticOperation) {
    const outcome = applyOne(meta, operation);
    return {
        documents: outcome.documents,
        syncMeta: compactSyncMeta(outcome.syncMetas['']),
    };
}

describe('M4 causal metadata compaction', () => {
    it('uses componentwise causal coverage rather than age or tie-break order', () => {
        expect(coversVector({ A: 4, B: 2 }, { A: 3, B: 2 })).toBe(true);
        expect(coversVector({ A: 4 }, { A: 3, B: 1 })).toBe(false);
        expect(coversVector({ A: 4, B: 0 }, { A: 4 })).toBe(true);
    });

    it('collects only causally covered descendants and keeps the terminal tombstone', () => {
        const compacted = compactSyncMeta(tombstonedProfileMeta());

        expect(compacted.fields.profile).toMatchObject({
            actorId: 'A',
            seq: 2,
            deleted: true,
            clock: { A: 2, B: 1 },
        });
        expect(compacted.fields['profile/name']).toBeUndefined();
        expect(compacted.fields['profile/height']).toBeUndefined();
        expect(compacted.fields['profile/weight']).toBeDefined();
        expect(compacted.fields.routines).toBeDefined();
        expect(compacted.clock).toEqual({ A: 2, B: 1, C: 1 });
    });

    it('never retires positive actor-frontier coordinates or terminal tombstones', () => {
        const meta: SyncMeta = {
            protocolVersion: 1,
            clock: { A: 9, B: 7, C: 3 },
            fields: {
                'history/old': { actorId: 'A', seq: 9, clock: { A: 9, B: 7 }, deleted: true },
            },
        };

        const compacted = compactSyncMeta(meta);
        expect(compacted.clock).toEqual({ A: 9, B: 7, C: 3 });
        expect(compacted.fields['history/old']).toEqual(meta.fields['history/old']);
    });

    it('is deterministic and idempotent', () => {
        const once = compactSyncMeta(tombstonedProfileMeta());
        const twice = compactSyncMeta(once);
        expect(twice).toEqual(once);
        expect(compactSyncMeta(tombstonedProfileMeta())).toEqual(once);
    });

    it('makes a blocking ancestor absorb the causal context of a rejected child contender', () => {
        const meta: SyncMeta = {
            protocolVersion: 1,
            clock: { A: 2 },
            fields: {
                profile: { actorId: 'A', seq: 2, clock: { A: 2 }, deleted: true },
                'profile/name': { actorId: 'A', seq: 1, clock: { A: 1 } },
            },
        };
        const concurrentUpdate: SemanticOperation = {
            docPath: '',
            path: ['profile', 'name'],
            value: 'B',
            isDelete: false,
            actorId: 'B',
            seq: 1,
            clock: { B: 1 },
        };

        const outcome = applyOne(meta, concurrentUpdate);
        expect(outcome.documents.get('')).toEqual({});
        expect(outcome.syncMetas[''].fields.profile.clock).toEqual({ A: 2, B: 1 });

        const compacted = compactSyncMeta(outcome.syncMetas['']);
        expect(compacted.fields.profile.clock).toEqual({ A: 2, B: 1 });
        expect(compacted.fields['profile/name']).toBeUndefined();
    });

    it('preserves future merge results across stale, concurrent and causally newer writes', () => {
        const original: SyncMeta = {
            protocolVersion: 1,
            clock: { A: 2 },
            fields: {
                profile: { actorId: 'A', seq: 2, clock: { A: 2 }, deleted: true },
                'profile/name': { actorId: 'A', seq: 1, clock: { A: 1 } },
            },
        };
        const compacted = compactSyncMeta(original);
        const futureOperations: SemanticOperation[] = [
            {
                docPath: '', path: ['profile', 'name'], value: 'stale', isDelete: false,
                actorId: 'A', seq: 1, clock: { A: 1 },
            },
            {
                docPath: '', path: ['profile', 'name'], value: 'concurrent', isDelete: false,
                actorId: 'B', seq: 1, clock: { B: 1 },
            },
            {
                docPath: '', path: ['profile', 'name'], isDelete: true,
                actorId: 'B', seq: 1, clock: { B: 1 },
            },
            {
                docPath: '', path: ['profile', 'name'], value: 'recreated', isDelete: false,
                actorId: 'C', seq: 1, clock: { A: 2, C: 1 },
            },
        ];

        for (const operation of futureOperations) {
            const fromOriginal = compactedOutcome(original, operation);
            const fromCompacted = compactedOutcome(compacted, operation);
            expect(fromCompacted.documents).toEqual(fromOriginal.documents);
            expect(fromCompacted.syncMeta).toEqual(fromOriginal.syncMeta);
        }
    });

    it('preserves equivalence across a multi-step out-of-order descendant sequence', () => {
        const original: SyncMeta = {
            protocolVersion: 1,
            clock: { A: 2 },
            fields: {
                profile: { actorId: 'A', seq: 2, clock: { A: 2 }, deleted: true },
                'profile/name': { actorId: 'A', seq: 1, clock: { A: 1 } },
            },
        };

        const sequence: SemanticOperation[] = [
            { docPath: '', path: ['profile', 'name'], isDelete: true, actorId: 'B', seq: 1, clock: { B: 1 } },
            { docPath: '', path: ['profile', 'name'], value: 'late-3', isDelete: false, actorId: 'B', seq: 3, clock: { A: 2, B: 3 } },
            { docPath: '', path: ['profile', 'name'], value: 'late-2', isDelete: false, actorId: 'B', seq: 2, clock: { A: 2, B: 2 } },
        ];

        let originalDocs = rootBase();
        let compactedDocs = rootBase();
        let originalMeta = original;
        let compactedMeta = compactSyncMeta(original);

        for (const operation of sequence) {
            const left = applySemanticOperations(originalDocs, [operation], { '': originalMeta });
            const right = applySemanticOperations(compactedDocs, [operation], { '': compactedMeta });
            originalDocs = left.documents;
            compactedDocs = right.documents;
            originalMeta = compactSyncMeta(left.syncMetas['']);
            compactedMeta = compactSyncMeta(right.syncMetas['']);

            expect(compactedDocs).toEqual(originalDocs);
            expect(compactedMeta).toEqual(originalMeta);
        }
    });
});
