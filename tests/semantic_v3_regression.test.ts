import { describe, expect, it } from 'vitest';
import {
    applySemanticOperations,
    diffDocuments,
    parseSyncMeta,
    type SemanticOperation
} from '../src/lib/sync/semanticProjection';
import type { DocumentData } from '../src/lib/sync/documentProjection';
import type { StampLike } from '../src/lib/sync/semanticProjection/contracts';
import { compareStamps, fieldKey, parseSemanticOperation } from '../src/lib/sync/semanticProjection/metadata';
import { CURRENT_SYNC_PROTOCOL } from '../src/lib/schemaEvolution';

const nutritionPath = 'nutrition_months/2026-09';
const date = '2026-09-13';

function nutritionDocs(day?: Record<string, unknown>) {
    return new Map<string, DocumentData>([[nutritionPath, day ? { [date]: day } : {}]]);
}

describe('Semantic Merge V3 regressions', () => {
    it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])(
        'keeps %s actor coordinates independent of inherited properties',
        actor => {
            const ordinary: SemanticOperation = {
                docPath: '', path: ['profile', 'name'], value: 'ordinary',
                actorId: 's00', seq: 2, clock: { s00: 2 }, isDelete: false,
            };
            const special: SemanticOperation = {
                ...ordinary, value: 'special', actorId: actor, seq: 3, clock: { [actor]: 3 },
            };
            expect(compareStamps(ordinary, special)).toBe(-1);
            expect(compareStamps(special, ordinary)).toBe(1);
            const zero = { ...ordinary, clock: { s00: 2, [actor]: 0 } };
            expect(compareStamps(zero, ordinary)).toBe(0);
            expect(compareStamps(ordinary, zero)).toBe(0);

            const base = new Map<string, DocumentData>([['', { profile: { name: 'base' } }]]);
            const together = applySemanticOperations(base, [ordinary, special]);
            const first = applySemanticOperations(base, [special]);
            const split = applySemanticOperations(first.documents, [ordinary, special], first.syncMetas);
            expect(together.documents.get('')?.profile).toEqual({ name: 'special' });
            expect(split).toEqual(together);
            expect(parseSyncMeta(together.syncMetas[''])).toEqual(together.syncMetas['']);
            expect(together.syncMetas[''].fields['profile/name'].candidates).toEqual([
                { actorId: 's00', seq: 2, clock: { s00: 2 }, value: 'ordinary' },
            ]);
        },
    );

    it('orders safe vector coordinates beyond the safe aggregate number range transitively', () => {
        const max = Number.MAX_SAFE_INTEGER;
        const stamps: StampLike[] = [
            { actorId: 's15', seq: max, clock: { s15: max, s14: 1 } },
            { actorId: 's13', seq: max, clock: { s13: max, s12: 2 } },
            { actorId: 's11', seq: max, clock: { s11: max, s10: 3 } },
        ];
        expect(compareStamps(stamps[0], stamps[1])).toBe(-1);
        expect(compareStamps(stamps[1], stamps[2])).toBe(-1);
        expect(compareStamps(stamps[0], stamps[2])).toBe(-1);
    });

    it.each(['', '/', 'profile/', 'profile//name', '%70rofile/name', 'profile/%6Eame', 'profile/%', 'profile/%2f'])(
        'rejects ambiguous or invalid field key %s before replay',
        key => {
            const raw = {
                protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s00: 2 },
                fields: { [key]: { actorId: 's00', seq: 2, clock: { s00: 2 }, deleted: true } },
            };
            const before = structuredClone(raw);
            expect(() => parseSyncMeta(raw)).toThrow();
            expect(raw).toEqual(before);
        },
    );

    it('preserves canonical escaped and prototype-named paths without aliasing metadata', () => {
        const key = fieldKey(['__proto__', 'constructor', 'prototype', 'a/b', 'è %']);
        const raw = {
            protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s00: 2, s01: 1 },
            fields: { [key]: {
                actorId: 's00', seq: 2, clock: { s00: 2 },
                guard: { path: ['activeWorkout', 'id'], equals: 'current' },
                candidates: [{
                    actorId: 's01', seq: 1, clock: { s01: 1 },
                    value: { nested: ['original'] },
                    guard: { path: ['activeWorkout', 'id'], equals: 'current' },
                }],
            } },
        };
        const before = structuredClone(raw);
        const parsed = parseSyncMeta(raw);
        parsed.clock.s00 = 9;
        parsed.fields[key].clock.s00 = 9;
        parsed.fields[key].guard!.path[0] = 'changed';
        parsed.fields[key].candidates![0].clock.s01 = 9;
        (parsed.fields[key].candidates![0].value as { nested: string[] }).nested.push('changed');
        parsed.fields[key].candidates![0].guard!.path[0] = 'changed';
        expect(raw).toEqual(before);
        expect(Object.keys(parsed.fields)).toEqual([key]);
        expect(Object.getPrototypeOf(parsed.fields)).toBe(Object.prototype);
    });

    it.each([{}, { s00: 1 }, { s01: 1 }])('rejects a terminal barrier missing its delete dot: %j', deleteClock => {
        expect(() => parseSyncMeta({
            protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s00: 2, s01: 1 },
            fields: { 'profile/name': {
                actorId: 's00', seq: 2, clock: { s00: 2, s01: 1 }, deleted: true, deleteClock,
            } },
        })).toThrow('causal dot');
    });

    it('accepts a delete-dot barrier without requiring the full event context and blocks stale recreation', () => {
        const raw = {
            protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s00: 2, s01: 1 },
            fields: { 'profile/name': {
                actorId: 's00', seq: 2, clock: { s00: 2, s01: 1 }, deleted: true,
            } },
        };
        const meta = parseSyncMeta(raw);
        expect(meta.fields['profile/name'].deleteClock).toEqual({ s00: 2 });
        expect(parseSyncMeta(meta)).toEqual(meta);
        const result = applySemanticOperations(new Map([['', {}]]), [{
            docPath: '', path: ['profile', 'name'], value: 'stale', isDelete: false,
            actorId: 's02', seq: 1, clock: { s02: 1 },
        }], { '': meta });
        expect(result.documents.get('')).toEqual({});
        expect(result.syncMetas[''].fields['profile/name']).toEqual(meta.fields['profile/name']);
    });

    it('isolates parsed operation paths, guards, values and causal clocks', () => {
        const raw = {
            docPath: '', path: ['profile', 'name'], value: { nested: ['original'] }, isDelete: false,
            actorId: 's00', seq: 1, clock: { s00: 1 },
            guard: { path: ['activeWorkout', 'id'], equals: { nested: ['guard'] } },
        };
        const before = structuredClone(raw);
        const parsed = parseSemanticOperation(raw);
        parsed.path.push('changed');
        parsed.clock.s00 = 9;
        (parsed.value as { nested: string[] }).nested.push('changed');
        parsed.guard!.path.push('changed');
        (parsed.guard!.equals as { nested: string[] }).nested.push('changed');
        expect(raw).toEqual(before);
    });

    it('merges concurrent creation of different properties on the same new NutritionDay', () => {
        const base = nutritionDocs();
        const desiredA = nutritionDocs({ date, weight: 80 });
        const desiredB = nutritionDocs({
            date,
            meals: [{ id: 'm1', name: 'Mela', quantity: 100, baseQty: 100, kcal: 50, carbs: 12, pro: 0.3, fat: 0.2 }]
        });

        const opsA = diffDocuments(base, desiredA, 'A', 1, { A: 1 });
        const opsB = diffDocuments(base, desiredB, 'B', 1, { B: 1 });
        const ab = applySemanticOperations(base, [...opsA, ...opsB]);
        const ba = applySemanticOperations(base, [...opsB, ...opsA]);

        const dayAB = ab.documents.get(nutritionPath)?.[date] as any;
        const dayBA = ba.documents.get(nutritionPath)?.[date] as any;
        expect(dayAB.weight).toBe(80);
        expect(dayAB.meals).toHaveLength(1);
        expect(dayAB.meals[0].id).toBe('m1');
        expect(dayBA).toEqual(dayAB);
        expect(ba.syncMetas).toEqual(ab.syncMetas);
    });

    it('represents deletion of a monthly entity with a parent tombstone', () => {
        const base = nutritionDocs({ date, weight: 80, meals: [] });
        const desired = nutritionDocs();

        const ops = diffDocuments(base, desired, 'B', 1, { B: 1 });
        expect(ops).toEqual([expect.objectContaining({
            docPath: nutritionPath,
            path: [date],
            isDelete: true
        })]);

        const deleted = applySemanticOperations(base, ops);
        expect(deleted.documents.get(nutritionPath)?.[date]).toBeUndefined();
        expect(deleted.syncMetas[nutritionPath].fields[date]?.deleted).toBe(true);
    });

    it('blocks a concurrent stale child after parent deletion even when its actor would win the tie-break', () => {
        const base = nutritionDocs({ date, weight: 80, meals: [] });
        const deleteOp = diffDocuments(base, nutritionDocs(), 'B', 1, { B: 1 });
        const deleted = applySemanticOperations(base, deleteOp);

        const staleChild: SemanticOperation = {
            docPath: nutritionPath,
            path: [date, 'weight'],
            value: 90,
            isDelete: false,
            actorId: 'Z',
            seq: 1,
            clock: { Z: 1 }
        };
        const result = applySemanticOperations(deleted.documents, [staleChild], deleted.syncMetas);

        expect(result.documents.get(nutritionPath)?.[date]).toBeUndefined();
        expect(result.syncMetas[nutritionPath].clock.Z).toBe(1);
    });

    it('allows causally later recreation after observing the parent tombstone', () => {
        const base = nutritionDocs({ date, weight: 80, meals: [] });
        const deleteOps = diffDocuments(base, nutritionDocs(), 'B', 1, { B: 1 });
        const deleted = applySemanticOperations(base, deleteOps);

        const recreatedDesired = nutritionDocs({ date, weight: 82, meals: [] });
        const recreateOps = diffDocuments(nutritionDocs(), recreatedDesired, 'C', 1, { B: 1, C: 1 });
        const recreated = applySemanticOperations(deleted.documents, recreateOps, deleted.syncMetas);

        expect(recreated.documents.get(nutritionPath)?.[date]).toMatchObject({ date, weight: 82 });
    });

    it('requires a complete current SyncMeta shape', () => {
        expect(() => parseSyncMeta({ protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {} })).toThrow('fields');
        expect(() => parseSyncMeta({ protocolVersion: CURRENT_SYNC_PROTOCOL, fields: {} })).toThrow('clock');
        expect(() => parseSyncMeta({ protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {
            'profile/name': { actorId: 'A', seq: 1 }
        } })).toThrow('field clock');
        expect(() => parseSyncMeta({ protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { A: 1.5 }, fields: {} })).toThrow('seq');
        expect(() => parseSyncMeta({ protocolVersion: CURRENT_SYNC_PROTOCOL + 1, clock: {}, fields: {} })).toThrow('Unsupported protocolVersion');
        expect(() => parseSyncMeta({
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: {},
            fields: {},
            writer: { slot: 's00', replicaId: 'replica', generation: 1, seq: 0, unexpected: true },
        })).toThrow('Unsupported replica writer metadata');
        expect(() => parseSyncMeta({
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: {},
            fields: {},
            writer: { slot: 's00', replicaId: 'r'.repeat(129), generation: 1, seq: 0 },
        })).toThrow('Invalid replica writer id');
        expect(() => parseSyncMeta({
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { A: 1 },
            fields: {
                'profile/name': { actorId: 'A', seq: 1, clock: { A: 1 }, legacyClock: { A: 1 } },
            },
        })).toThrow('Unsupported legacy FieldStamp metadata');
        expect(() => parseSyncMeta({
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { A: 1, B: 1 },
            fields: {
                'profile/name': {
                    actorId: 'A',
                    seq: 1,
                    clock: { A: 1 },
                    candidates: [{
                        actorId: 'B',
                        seq: 1,
                        clock: { B: 1 },
                        value: 'hidden',
                        legacyClock: { B: 1 },
                    }],
                },
            },
        })).toThrow('Unsupported legacy FieldCandidate metadata');
    });
});
