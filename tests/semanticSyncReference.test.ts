import { describe, expect, it } from 'vitest';
import {
    diffDocuments,
    getMergePolicy,
    resolveIdentity,
} from '../src/lib/sync/semanticProjection';
import type { DocumentData } from '../src/lib/sync/documentProjection';

describe('Semantic sync reference invariants', () => {
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
