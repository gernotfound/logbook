import { describe, expect, it } from 'vitest';
import { compactSyncMeta, coversVector } from '../../src/lib/sync/causalCompaction';
import { applySemanticOperations, parseSyncMeta, type SemanticOperation, type SyncMeta } from '../../src/lib/sync/semanticProjection';
import { rootBase, tombstonedProfileMeta } from './causalCompactionFixtures';

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
});
