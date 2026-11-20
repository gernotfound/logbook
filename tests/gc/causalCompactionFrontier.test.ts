import { describe, expect, it } from 'vitest';
import { compactSyncMeta, compactSyncMetas } from '../../src/lib/sync/causalCompaction';
import { applySemanticOperations, parseSyncMeta, type SemanticOperation, type SyncMeta } from '../../src/lib/sync/semanticProjection';
import { openCloudDocument, sealCloudDocument } from '../../src/lib/sync/cloudDocumentCipher';
import { expandedDescendantBarrier, rootBase } from './causalCompactionFixtures';

describe('M4 causal metadata compaction', () => {
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
