import { describe, expect, it } from 'vitest';
import { compactSyncMeta } from '../../src/lib/sync/causalCompaction';
import { applySemanticOperations, parseSyncMeta, type SemanticOperation, type SyncMeta } from '../../src/lib/sync/semanticProjection';
import { applyOne, compactedOutcome, rootBase, tombstonedProfileMeta } from './causalCompactionFixtures';

describe('M4 causal metadata compaction', () => {
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
});
