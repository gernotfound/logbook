import { describe, expect, it } from 'vitest';
import { compactSyncMeta, compactSyncMetas, coversVector } from '../../src/lib/sync/causalCompaction';
import {
    applySemanticOperations,
    parseSyncMeta,
    type SemanticOperation,
    type SyncMeta,
} from '../../src/lib/sync/semanticProjection';
import type { DocumentData } from '../../src/lib/sync/documentProjection';
import { openCloudDocument, sealCloudDocument } from '../../src/lib/sync/cloudDocumentCipher';

const tombstonedProfileMeta = (): SyncMeta => ({
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


function expandedDescendantBarrier(): SyncMeta {
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
    it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])(
        'requires own causal evidence before collecting the %s actor',
        actor => {
            const clock = { [actor]: 2 };
            const meta: SyncMeta = {
                protocolVersion: 3, clock,
                fields: {
                    profile: { actorId: 's00', seq: 1, clock: { s00: 1 }, deleted: true, deleteClock: { s00: 1 } },
                    'profile/name': { actorId: actor, seq: 2, clock, deleted: true, deleteClock: clock },
                },
            };
            meta.clock = { ...clock, s00: 1 };
            const before = structuredClone(meta);
            expect(coversVector({}, clock)).toBe(false);
            const preserved = compactSyncMeta(meta, {});
            expect(preserved).toEqual(meta);
            expect(Object.hasOwn(preserved.clock, actor)).toBe(true);
            expect(Object.getPrototypeOf(preserved.clock)).toBe(Object.prototype);
            expect(compactSyncMeta(preserved, {})).toEqual(preserved);
            expect(compactSyncMeta(meta, { ...clock, s00: 1 }).fields).toEqual({});
            expect(meta).toEqual(before);
        },
    );

    it('compacts many sibling fields using only the ancestor delete coverage', () => {
        const fields: SyncMeta['fields'] = {
            profile: { actorId: 'A', seq: 2, clock: { A: 2 }, deleted: true },
        };
        for (let index = 0; index < 480; index++) {
            fields[`profile/measurements/${index}`] = index % 3 === 0
                ? { actorId: 'B', seq: 1, clock: { B: 1 } }
                : { actorId: 'A', seq: 1, clock: { A: 1 } };
        }
        const source = parseSyncMeta({ protocolVersion: 3, clock: { A: 2, B: 1 }, fields });
        const compacted = compactSyncMeta(source);
        expect(Object.keys(compacted.fields)).toHaveLength(161);
        for (let index = 0; index < 480; index++) {
            expect(Object.hasOwn(compacted.fields, `profile/measurements/${index}`))
                .toBe(index % 3 === 0);
        }
        expect(compactSyncMeta(compacted)).toEqual(compacted);
        expect(Object.keys(source.fields)).toHaveLength(481);
    });

    it('retires terminal ancestor tombstones only after every descendant has retired', () => {
        const fields: SyncMeta['fields'] = {
            profile: { actorId: 'A', seq: 2, clock: { A: 2 }, deleted: true },
        };
        for (let index = 0; index < 160; index++) {
            fields[`profile/measurements/${index}`] = {
                actorId: 'B', seq: 1, clock: { B: 1 }, deleted: true,
            };
        }
        const source = parseSyncMeta({ protocolVersion: 3, clock: { A: 2, B: 1 }, fields });
        const concurrent = compactSyncMeta(source);
        expect(Object.keys(concurrent.fields)).toHaveLength(161);
        const retired = compactSyncMeta(source, { A: 2, B: 1 });
        expect(retired.fields).toEqual({});
        expect(retired.clock).toEqual(source.clock);
    });

    it('uses componentwise causal coverage rather than age or tie-break order', () => {
        expect(coversVector({ A: 4, B: 2 }, { A: 3, B: 2 })).toBe(true);
        expect(coversVector({ A: 4 }, { A: 3, B: 1 })).toBe(false);
        expect(coversVector({ A: 4, B: 0 }, { A: 4 })).toBe(true);
    });

    it('collects only causally covered descendants and keeps the terminal tombstone', () => {
        // The fixture must be accepted by the persisted causal-metadata parser.
        expect(() => parseSyncMeta(tombstonedProfileMeta())).not.toThrow();
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
        expect(compacted.clock).toEqual({ A: 2, B: 1, C: 1, R: 1 });
    });

    it('does not compact a descendant when a hidden candidate is not covered by the ancestor delete barrier', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
            clock: { A: 2, B: 1 },
            fields: {
                profile: { actorId: 'A', seq: 2, clock: { A: 2 }, deleted: true, deleteClock: { A: 2 } },
                'profile/name': {
                    actorId: 'A',
                    seq: 1,
                    clock: { A: 1 },
                    candidates: [{
                        actorId: 'B',
                        seq: 1,
                        clock: { B: 1 },
                        value: 'hidden',
                    }],
                },
            },
        };

        const compacted = compactSyncMeta(meta);
        expect(compacted.fields['profile/name']).toBeDefined();
        expect(compacted.fields['profile/name'].candidates).toEqual([
            expect.objectContaining({ actorId: 'B', seq: 1, clock: { B: 1 }, value: 'hidden' }),
        ]);
    });

    it('preserves the descendant tombstone identity when an ancestor only observes its context indirectly', () => {
        const initial: SyncMeta = {
            protocolVersion: 3,
            clock: { B: 1, C: 1 },
            fields: {
                profile: {
                    actorId: 'B',
                    seq: 1,
                    clock: { B: 1 },
                    deleted: true,
                    deleteClock: { B: 1 },
                },
                'profile/name': {
                    actorId: 'C',
                    seq: 1,
                    clock: { C: 1 },
                    deleted: true,
                    deleteClock: { C: 1 },
                },
            },
        };
        const observedDescendantUpdate: SemanticOperation = {
            docPath: '',
            path: ['profile', 'name'],
            value: 'observed-C',
            isDelete: false,
            actorId: 'A',
            seq: 1,
            clock: { A: 1, C: 1 },
        };
        const laterDelete: SemanticOperation = {
            docPath: '',
            path: ['profile', 'name'],
            isDelete: true,
            actorId: 'B',
            seq: 2,
            clock: { B: 2 },
        };

        const first = applySemanticOperations(rootBase(), [observedDescendantUpdate], { '': initial });
        const afterFirstCompaction = compactSyncMeta(first.syncMetas['']);
        expect(afterFirstCompaction.fields.profile.clock).toEqual({ B: 1 });
        expect(afterFirstCompaction.fields.profile.deleteClock).toEqual({ B: 1 });
        expect(afterFirstCompaction.fields['profile/name']).toBeDefined();

        const split = applySemanticOperations(first.documents, [laterDelete], { '': afterFirstCompaction });
        const splitMeta = compactSyncMeta(split.syncMetas['']);

        const batched = applySemanticOperations(
            rootBase(),
            [observedDescendantUpdate, laterDelete],
            { '': initial },
        );
        const batchedMeta = compactSyncMeta(batched.syncMetas['']);

        expect(split.documents).toEqual(batched.documents);
        expect(splitMeta).toEqual(batchedMeta);
    });

    it('keeps positive actor-frontier coordinates and terminal tombstones without a stable-frontier proof', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
            clock: { A: 9, B: 7, C: 3 },
            fields: {
                'history/old': { actorId: 'A', seq: 9, clock: { A: 9, B: 7 }, deleted: true },
            },
        };

        const compacted = compactSyncMeta(meta);
        expect(compacted.clock).toEqual({ A: 9, B: 7, C: 3 });
        expect(compacted.fields['history/old']).toEqual(meta.fields['history/old']);
    });

    it('retires a terminal tombstone only after the stable frontier covers its full causal state', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
            clock: { s00: 4, s01: 2 },
            fields: {
                'profile/name': {
                    actorId: 's00',
                    seq: 4,
                    clock: { s00: 4, s01: 2 },
                    deleted: true,
                    deleteClock: { s00: 4, s01: 2 },
                },
            },
        };

        expect(compactSyncMeta(meta, { s00: 4, s01: 1 }).fields['profile/name']).toBeDefined();
        expect(compactSyncMeta(meta, { s00: 4, s01: 2 }).fields['profile/name']).toBeUndefined();
    });

    it('retires a covered historical delete barrier after recreation but keeps uncovered hidden candidates', () => {
        const recreated: SyncMeta = {
            protocolVersion: 3,
            clock: { s00: 4, s01: 2 },
            fields: {
                profile: {
                    actorId: 's00',
                    seq: 4,
                    clock: { s00: 4, s01: 2 },
                    deleteClock: { s01: 2 },
                },
            },
        };
        expect(compactSyncMeta(recreated, { s00: 4, s01: 2 }).fields.profile.deleteClock).toBeUndefined();

        // A deleted winner cannot have update candidates. Model a recreated
        // winner with a concurrent candidate, both observing the delete barrier.
        const hidden: SyncMeta = {
            protocolVersion: 3,
            clock: { s00: 4, s01: 2, s02: 1 },
            fields: {
                profile: {
                    actorId: 's00',
                    seq: 4,
                    clock: { s00: 4, s01: 2 },
                    deleteClock: { s01: 2 },
                    candidates: [{
                        actorId: 's02',
                        seq: 1,
                        clock: { s01: 2, s02: 1 },
                        value: { name: 'late' },
                    }],
                },
            },
        };
        expect(() => parseSyncMeta(hidden)).not.toThrow();
        expect(compactSyncMeta(hidden, { s00: 4, s01: 2 }).fields.profile.deleteClock)
            .toEqual({ s01: 2 });
        expect(compactSyncMeta(hidden, { s00: 4, s01: 2, s02: 1 }).fields.profile.deleteClock)
            .toBeUndefined();
    });

    it('is deterministic and idempotent', () => {
        const once = compactSyncMeta(tombstonedProfileMeta());
        const twice = compactSyncMeta(once);
        expect(twice).toEqual(once);
        expect(compactSyncMeta(tombstonedProfileMeta())).toEqual(once);
    });

    it('keeps a blocking ancestor stamp immutable while the document frontier observes the rejected child', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
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
        expect(outcome.syncMetas[''].fields.profile.clock).toEqual({ A: 2 });
        expect(outcome.syncMetas[''].clock).toEqual({ A: 2, B: 1 });

        const compacted = compactSyncMeta(outcome.syncMetas['']);
        expect(compacted.fields.profile.clock).toEqual({ A: 2 });
        expect(compacted.clock).toEqual({ A: 2, B: 1 });
        expect(compacted.fields['profile/name']).toBeUndefined();
    });

    it('preserves future merge results across stale, concurrent and causally newer writes', () => {
        const original: SyncMeta = {
            protocolVersion: 3,
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
            protocolVersion: 3,
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

    it('preserves and independently clones field guards, hidden candidates and replica writer', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
            clock: { s00: 4, s01: 2, s02: 1, ZERO: 0 },
            writer: { slot: 's00', replicaId: 'replica-a', generation: 1, seq: 4 },
            fields: {
                'profile/name': {
                    actorId: 's00', seq: 4, clock: { s00: 4, s02: 1, ZERO: 0 },
                    deleteClock: { s02: 1, ZERO: 0 },
                    guard: { path: ['profile', 'name'], equals: { token: 'parent' } },
                    candidates: [{
                        actorId: 's01', seq: 2, clock: { s01: 2, s02: 1, ZERO: 0 },
                        value: { names: ['hidden'] },
                        guard: { path: ['profile', 'status'], equals: { allowed: true } },
                    }],
                },
            },
        };
        const before = structuredClone(meta);
        expect(() => parseSyncMeta(meta)).not.toThrow();
        const result = compactSyncMeta(meta);
        expect(result.clock).toEqual({ s00: 4, s01: 2, s02: 1 });
        expect(result.fields['profile/name'].clock).toEqual({ s00: 4, s02: 1 });
        expect(result.fields['profile/name'].deleteClock).toEqual({ s02: 1 });
        expect(result.fields['profile/name'].candidates?.[0].clock).toEqual({ s01: 2, s02: 1 });
        expect(result).not.toBe(meta);
        expect(result.fields['profile/name']).not.toBe(meta.fields['profile/name']);
        expect(result.writer).toEqual(meta.writer);
        expect(result.writer).not.toBe(meta.writer);

        const stamp = result.fields['profile/name'];
        stamp.clock.s00 = 99;
        stamp.deleteClock!.s02 = 99;
        stamp.candidates![0].clock.s01 = 99;
        stamp.guard!.path[0] = 'changed';
        (stamp.guard!.equals as { token: string }).token = 'changed';
        stamp.candidates![0].guard!.path[0] = 'changed';
        (stamp.candidates![0].value as { names: string[] }).names.push('changed');
        result.writer!.seq = 99;
        expect(meta).toEqual(before);
    });

    it('retains a recreated field delete barrier until a stable frontier covers the entire winner', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
            clock: { A: 3 },
            fields: {
                profile: { actorId: 'A', seq: 3, clock: { A: 3 }, deleteClock: { A: 2 } },
                'profile/name': { actorId: 'A', seq: 1, clock: { A: 1 } },
            },
        };
        const before = structuredClone(meta);
        const withoutFrontier = compactSyncMeta(meta);
        expect(withoutFrontier.fields.profile.deleteClock).toEqual({ A: 2 });
        expect(withoutFrontier.fields['profile/name']).toBeUndefined();
        expect(compactSyncMeta(meta, { A: 2 }).fields.profile.deleteClock).toEqual({ A: 2 });
        expect(compactSyncMeta(meta, { A: 3 }).fields.profile.deleteClock).toBeUndefined();
        expect(meta).toEqual(before);
    });

    it('retains a covered terminal ancestor when it still protects a concurrent live descendant', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
            clock: { A: 1, B: 1 },
            fields: {
                profile: { actorId: 'A', seq: 1, clock: { A: 1 }, deleted: true, deleteClock: { A: 1 } },
                'profile/name': { actorId: 'B', seq: 1, clock: { B: 1 } },
                profiles: { actorId: 'B', seq: 1, clock: { B: 1 } },
            },
        };
        const stable = { A: 1, B: 1 };
        const compacted = compactSyncMeta(meta, stable);
        expect(compacted.fields.profile).toEqual(meta.fields.profile);
        expect(compacted.fields['profile/name']).toEqual(meta.fields['profile/name']);
        expect(compacted.fields.profiles).toEqual(meta.fields.profiles);
        expect(compactSyncMeta(compacted, stable)).toEqual(compacted);
    });



    it('uses an explicit ancestor delete barrier for descendants and terminal stable frontier retirement', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
            clock: { A: 3, B: 2 },
            fields: {
                profile: {
                    actorId: 'A', seq: 3, clock: { A: 3 },
                    deleted: true, deleteClock: { A: 3, B: 2 },
                },
                'profile/name': {
                    actorId: 'B', seq: 2, clock: { B: 2 },
                },
            },
        };
        const original = structuredClone(meta);
        expect(() => parseSyncMeta(meta)).not.toThrow();
        const compacted = compactSyncMeta(meta);
        expect(compacted.fields['profile/name']).toBeUndefined();
        expect(compacted.fields.profile.deleteClock).toEqual({ A: 3, B: 2 });
        expect(compactSyncMeta(meta, { A: 3 }).fields.profile).toBeDefined();
        expect(compactSyncMeta(meta, { A: 3, B: 2 }).fields).toEqual({});
        expect(meta).toEqual(original);
    });

    it('keeps live ancestor and descendant metadata when no delete barrier exists', () => {
        const operations: SemanticOperation[] = [
            {
                docPath: '', path: ['profile'], value: { name: 'parent' }, isDelete: false,
                actorId: 's00', seq: 1, clock: { s00: 1 },
            },
            {
                docPath: '', path: ['profile', 'name'], value: 'child', isDelete: false,
                actorId: 's00', seq: 1, clock: { s00: 1 },
            },
        ];
        const merged = applySemanticOperations(rootBase(), operations);
        const meta = merged.syncMetas[''];
        expect(merged.documents.get('')).toEqual({ profile: { name: 'child' } });
        expect(Object.keys(meta.fields).sort()).toEqual(['profile', 'profile/name']);
        expect(() => parseSyncMeta(meta)).not.toThrow();
        expect(compactSyncMeta(meta)).toEqual(meta);
        expect(compactSyncMeta(meta, { s00: 1 })).toEqual(meta);
    });

    it('uses the terminal winner clock when no explicit delete clock was supplied', () => {
        const meta: SyncMeta = {
            protocolVersion: 3,
            clock: { s00: 2, s01: 1 },
            fields: {
                'profile/name': {
                    actorId: 's00', seq: 2, clock: { s00: 2, s01: 1 }, deleted: true,
                },
            },
        };
        expect(() => parseSyncMeta(meta)).not.toThrow();
        expect(compactSyncMeta(meta, { s00: 2 })).toEqual(meta);
        expect(compactSyncMeta(meta, { s00: 2, s01: 1 })).toEqual({
            protocolVersion: 3, clock: { s00: 2, s01: 1 }, fields: {},
        });
    });

    it('compacts each document against the shared frontier without collecting another document prematurely', () => {
        const root: SyncMeta = {
            protocolVersion: 3, clock: { s00: 2 },
            fields: {
                profile: { actorId: 's00', seq: 2, clock: { s00: 2 }, deleted: true, deleteClock: { s00: 2 } },
            },
        };
        const month: SyncMeta = {
            protocolVersion: 3, clock: { s01: 1 },
            fields: {
                workout: { actorId: 's01', seq: 1, clock: { s01: 1 }, deleted: true, deleteClock: { s01: 1 } },
            },
        };
        const metas = { '': root, 'history_months/2026-11': month };
        const before = structuredClone(metas);
        const compacted = compactSyncMetas(metas, { s00: 2 });
        expect(compacted).toEqual({
            '': { protocolVersion: 3, clock: { s00: 2 }, fields: {} },
            'history_months/2026-11': month,
        });
        expect(compacted['history_months/2026-11']).not.toBe(month);
        expect(compactSyncMetas(compacted, { s00: 2 })).toEqual(compacted);
        expect(metas).toEqual(before);
    });


    it.each([
        { order: ['profile', 'profile/name', 'profile/name/value'] },
        { order: ['profile', 'profile/name/value', 'profile/name'] },
        { order: ['profile/name', 'profile', 'profile/name/value'] },
        { order: ['profile/name', 'profile/name/value', 'profile'] },
        { order: ['profile/name/value', 'profile', 'profile/name'] },
        { order: ['profile/name/value', 'profile/name', 'profile'] },
    ])('preserves nested terminal barriers across insertion order $order until the entire subtree is stable', ({ order }) => {
        const operations: SemanticOperation[] = [
            { docPath: '', path: ['profile'], isDelete: true,
                actorId: 's00', seq: 1, clock: { s00: 1 } },
            { docPath: '', path: ['profile', 'name'], isDelete: true,
                actorId: 's01', seq: 1, clock: { s00: 1, s01: 1 } },
            { docPath: '', path: ['profile', 'name', 'value'], isDelete: true,
                actorId: 's02', seq: 1, clock: { s00: 1, s01: 1, s02: 1 } },
            { docPath: '', path: ['profiles'], value: 'unrelated', isDelete: false,
                actorId: 's03', seq: 1, clock: { s03: 1 } },
        ];
        let documents = rootBase();
        let metas: Record<string, SyncMeta> = {};
        for (const operation of operations) {
            const outcome = applySemanticOperations(documents, [operation], metas);
            documents = outcome.documents;
            metas = outcome.syncMetas;
        }
        const original = metas[''];
        expect(() => parseSyncMeta(original)).not.toThrow();
        expect(Object.keys(original.fields).sort()).toEqual([
            'profile', 'profile/name', 'profile/name/value', 'profiles',
        ]);
        const terminal = {
            actorId: 's02', seq: 1, clock: { s00: 1, s01: 1, s02: 1 },
            deleted: true, deleteClock: { s02: 1 },
        };
        expect(original.fields['profile/name/value']).toEqual(terminal);

        const entries = order.map(key => [key, original.fields[key]] as const);
        entries.splice(1, 0, ['profiles', original.fields.profiles]);
        const input = { ...original, fields: Object.fromEntries(entries) };
        const before = structuredClone(input);
        const partialFrontier = { s00: 1, s01: 1, s03: 1 };

        expect(compactSyncMeta(input)).toEqual(original);
        const partial = compactSyncMeta(input, partialFrontier);
        // Acknowledging both ancestors cannot retire their barriers while
        // a terminal descendant still lies outside the stable frontier.
        expect(partial).toEqual(original);
        expect(compactSyncMeta(partial, partialFrontier)).toEqual(partial);

        const staleUpdate: SemanticOperation = {
            docPath: '', path: ['profile', 'name', 'value'], value: 'stale', isDelete: false,
            actorId: 's03', seq: 2, clock: { s00: 1, s01: 1, s03: 2 },
        };
        const replay = applySemanticOperations(documents, [staleUpdate], { '': partial });
        expect(replay.documents).toEqual(documents);
        expect(replay.syncMetas[''].fields['profile/name/value']).toEqual(terminal);

        const fullFrontier = { ...partialFrontier, s02: 1 };
        const collected = compactSyncMeta(input, fullFrontier);
        expect(collected).toEqual({
            protocolVersion: 3, clock: { s00: 1, s01: 1, s02: 1, s03: 1 },
            fields: { profiles: original.fields.profiles },
        });
        expect(compactSyncMeta(collected, fullFrontier)).toEqual(collected);
        expect(documents.get('')).toHaveProperty('profiles', 'unrelated');
        expect(documents.get('')).not.toHaveProperty('profile.name.value');
        expect(input).toEqual(before);
    });


    it.each([
        { label: 'no frontier', frontier: undefined },
        { label: 'frontier missing the additional delete', frontier: { s00: 1, s01: 1 } },
    ])('preserves a descendant delete barrier beyond its winner clock ($label)', ({ frontier }) => {
        const meta = expandedDescendantBarrier();
        const before = structuredClone(meta);
        const compacted = compactSyncMeta(meta, frontier);
        expect(compacted).toEqual(meta);
        expect(parseSyncMeta(compacted)).toEqual(compacted);
        expect(compactSyncMeta(compacted, frontier)).toEqual(compacted);
        expect(meta).toEqual(before);

        const fullyStable = compactSyncMeta(meta, { s00: 1, s01: 1, s02: 1 });
        expect(fullyStable).toEqual({ ...meta, fields: {} });
    });

    it.each([
        { label: 'no frontier', frontier: undefined },
        { label: 'partial frontier', frontier: { s00: 1, s01: 1 } },
    ])('keeps an unobserved delete effective after authenticated metadata compaction ($label)', ({ frontier }) => {
        const key = new Uint8Array(32).fill(29);
        const sealed = sealCloudDocument(key, 'gc-fixture', '', {}, expandedDescendantBarrier());
        const restored = openCloudDocument(key, 'gc-fixture', '', sealed);
        const future: SemanticOperation = {
            docPath: '', path: ['profile', 'name'], value: 'must-not-return', isDelete: false,
            actorId: 's03', seq: 1, clock: { s00: 1, s01: 1, s03: 1 },
        };
        const original = applySemanticOperations(
            new Map([['', restored.business]]), [future], { '': restored.sync },
        );
        const compacted = applySemanticOperations(
            new Map([['', restored.business]]), [future],
            { '': compactSyncMeta(restored.sync, frontier) },
        );

        expect(original.documents.get('')).not.toHaveProperty('profile.name');
        expect(compacted.documents).toEqual(original.documents);
        expect(compacted.syncMetas).toEqual(original.syncMetas);
    });

    it.each([
        { order: ['profile', 'profile/name', 'profile/name/value'] },
        { order: ['profile', 'profile/name/value', 'profile/name'] },
        { order: ['profile/name', 'profile', 'profile/name/value'] },
        { order: ['profile/name', 'profile/name/value', 'profile'] },
        { order: ['profile/name/value', 'profile', 'profile/name'] },
        { order: ['profile/name/value', 'profile/name', 'profile'] },
    ])('retains the stronger nested barrier regardless of insertion order $order', ({ order }) => {
        const meta = expandedDescendantBarrier();
        const fields = {
            ...meta.fields,
            'profile/name/value': {
                actorId: 's02', seq: 1, clock: { s02: 1 },
                deleted: true, deleteClock: { s02: 1 },
            },
        };
        const permuted = parseSyncMeta({
            ...meta, fields: Object.fromEntries(order.map(key => [key, fields[key as keyof typeof fields]])),
        });
        const before = structuredClone(permuted);
        const result = compactSyncMeta(permuted);
        expect(result).toEqual(meta);
        expect(result.fields['profile/name'].deleteClock).toEqual({ s01: 1, s02: 1 });
        expect(result.fields['profile/name/value']).toBeUndefined();
        expect(compactSyncMeta(result)).toEqual(result);
        expect(permuted).toEqual(before);
    });

    it('collects the descendant only when the ancestor covers its complete delete barrier', () => {
        const meta = expandedDescendantBarrier();
        const covered = parseSyncMeta({
            ...meta,
            fields: {
                ...meta.fields,
                profile: { ...meta.fields.profile, deleteClock: { s00: 1, s01: 1, s02: 1 } },
            },
        });
        const result = compactSyncMeta(covered);
        expect(result).toEqual({
            ...covered, fields: { profile: covered.fields.profile },
        });
        expect(compactSyncMeta(result)).toEqual(result);
    });

});
