import { describe, expect, it } from 'vitest';
import {
    diffDocuments,
    applySemanticOperations,
    parseSyncMeta,
    getMergePolicy,
    resolveIdentity,
} from '../src/lib/sync/semanticProjection';
import type { DocumentData } from '../src/lib/sync/documentProjection';
import { removeUndefinedValues } from '../src/lib/utils/object';

describe('Semantic sync reference invariants', () => {
    it('preserves prototype-named workout IDs and causal tombstones as own properties', () => {
        const path = 'history_months/2026-09';
        const workout = { id: '__proto__', date: '2026-09-13', exercises: [] };
        const input = Object.fromEntries([['__proto__', workout]]);
        const clean = removeUndefinedValues(input);
        expect(Object.keys(clean)).toEqual(['__proto__']);
        expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);

        const desired = new Map<string, DocumentData>([[path, input]]);
        const operations = diffDocuments(new Map(), desired, 's00', 1, { s00: 1 });
        expect(operations.length).toBeGreaterThan(0);
        expect(operations.every(op => op.path[0] === '__proto__')).toBe(true);

        const create = {
            docPath: path, path: ['__proto__'], value: workout,
            isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        };
        const created = applySemanticOperations(new Map([[path, {}]]), [create]);
        const cloud = created.documents.get(path)!;
        expect(Object.hasOwn(cloud, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(cloud)).toBe(Object.prototype);
        expect(cloud['__proto__']).toEqual(workout);
        const metadata = created.syncMetas[path];
        expect(Object.hasOwn(metadata.fields, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(metadata.fields)).toBe(Object.prototype);
        expect(Object.hasOwn(parseSyncMeta(metadata).fields, '__proto__')).toBe(true);

        const deleted = applySemanticOperations(created.documents, [{
            docPath: path, path: ['__proto__'], isDelete: true,
            actorId: 's00', seq: 2, clock: { s00: 2 },
        }], created.syncMetas);
        expect(Object.hasOwn(deleted.documents.get(path)!, '__proto__')).toBe(false);
        expect(Object.hasOwn(deleted.syncMetas[path].fields, '__proto__')).toBe(true);
        expect(deleted.syncMetas[path].fields['__proto__'].deleted).toBe(true);
        const replay = applySemanticOperations(deleted.documents, [create], deleted.syncMetas);
        expect(Object.hasOwn(replay.documents.get(path)!, '__proto__')).toBe(false);
    });

    it('does not traverse inherited constructors when applying nested semantic paths', () => {
        const op = {
            docPath: '', path: ['constructor', 'prototype', 'polluted'],
            value: true, isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        };
        const result = applySemanticOperations(new Map([['', {}]]), [op]);
        expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
        const document = result.documents.get('')!;
        expect(Object.hasOwn(document, 'constructor')).toBe(true);
        expect(document.constructor).toEqual({ prototype: { polluted: true } });
        expect(Object.getPrototypeOf(document)).toBe(Object.prototype);
    });

    it('diffs profile at property level instead of replacing the whole profile', () => {
        const base = new Map<string, DocumentData>([
            ['', { profile: { height: '170', gender: 'M' } }],
        ]);
        const desired = new Map<string, DocumentData>([
            ['', { profile: { height: '180', gender: 'M' } }],
        ]);

        const ops = diffDocuments(base, desired, 'A', 1, { A: 1 });

        expect(getMergePolicy('', ['profile'])).toBe('property');
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({
            docPath: '',
            path: ['profile', 'height'],
            value: '180',
            isDelete: false,
        });
    });

    it('uses routineId as the identity inside trainingCycles[].routines', () => {
        expect(resolveIdentity(
            ['trainingCycles', 'cycle-1', 'routines'],
            { routineId: 'routine-2', frequencyPerWeek: 2 }
        )).toBe('routine-2');
    });

    it('does not generate causal operations for derived daily nutrition totals', () => {
        const base = new Map<string, DocumentData>([
            ['nutrition_months/2026-09', {
                '2026-09-13': {
                    date: '2026-09-13',
                    kcal: 100,
                    carbs: 10,
                    pro: 5,
                    fat: 3,
                    meals: [],
                },
            }],
        ]);
        const desired = new Map<string, DocumentData>([
            ['nutrition_months/2026-09', {
                '2026-09-13': {
                    date: '2026-09-13',
                    kcal: 999,
                    carbs: 99,
                    pro: 55,
                    fat: 33,
                    meals: [],
                },
            }],
        ]);

        const ops = diffDocuments(base, desired, 'A', 1, { A: 1 });

        expect(ops).toEqual([]);
    });

    it('keeps persisted meal macros causal because they are source data for daily totals', () => {
        const base = new Map<string, DocumentData>([
            ['nutrition_months/2026-09', {
                '2026-09-13': {
                    date: '2026-09-13',
                    kcal: 100,
                    carbs: 10,
                    pro: 5,
                    fat: 3,
                    meals: [{
                        id: 'meal-1',
                        name: 'Riso',
                        meal: 'pranzo',
                        quantity: 100,
                        baseQty: 100,
                        kcal: 100,
                        carbs: 10,
                        pro: 5,
                        fat: 3,
                    }],
                },
            }],
        ]);
        const desired = new Map<string, DocumentData>([
            ['nutrition_months/2026-09', {
                '2026-09-13': {
                    date: '2026-09-13',
                    kcal: 120,
                    carbs: 10,
                    pro: 5,
                    fat: 3,
                    meals: [{
                        id: 'meal-1',
                        name: 'Riso',
                        meal: 'pranzo',
                        quantity: 100,
                        baseQty: 100,
                        kcal: 120,
                        carbs: 10,
                        pro: 5,
                        fat: 3,
                    }],
                },
            }],
        ]);

        const ops = diffDocuments(base, desired, 'A', 1, { A: 1 });

        expect(ops).toHaveLength(1);
        expect(ops[0].path).toEqual(['2026-09-13', 'meals', 'meal-1', 'kcal']);
        expect(ops[0].value).toBe(120);
    });
});
