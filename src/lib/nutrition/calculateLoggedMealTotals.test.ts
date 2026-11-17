import { describe, expect, it } from 'vitest';
import type { LoggedMealItem } from '../../types';
import { calculateLoggedMealTotals, calculateRawLoggedMealTotals, getLoggedMealPortion } from './calculateLoggedMealTotals';

const meal = (partial: Partial<LoggedMealItem>): LoggedMealItem => ({
    id: 'sample', name: 'Sample', meal: 'pranzo', quantity: 100, kcal: 0, carbs: 0, pro: 0, fat: 0, ...partial,
});

describe('shared meal totals', () => {
    it('preserves full precision for the display and rounds the persisted projection', () => {
        const items = [meal({ baseQty: 100, quantity: 50, kcal: 2.9, pro: 2.9, carbs: 0.8, fat: 0.8 })];
        expect(calculateRawLoggedMealTotals(items)).toEqual({ kcal: 1.45, carbs: 0.4, pro: 1.45, fat: 0.4 });
        expect(calculateLoggedMealTotals(items)).toEqual({ kcal: 1, carbs: 0.4, pro: 1.5, fat: 0.4 });
    });
    it.each([
        ['multiplication', [meal({ baseQty: 1, quantity: 2, kcal: Number.MAX_VALUE })]],
        ['division', [meal({ baseQty: Number.MIN_VALUE, quantity: Number.MAX_VALUE })]],
        ['accumulation', [meal({ kcal: Number.MAX_VALUE }), meal({ kcal: Number.MAX_VALUE })]],
    ] as const)('rejects non-representable totals after finite-input %s', (_, items) => {
        const before = structuredClone(items);
        expect(() => calculateLoggedMealTotals(items)).toThrow('Totali nutrizionali non rappresentabili');
        expect(items).toEqual(before);
    });

    it.each([Number.MAX_SAFE_INTEGER, Number.MAX_VALUE])('preserves large finite integer macros without rounding loss: %s', value => {
        const items = [meal({ kcal: value, carbs: value, pro: value, fat: value })];
        expect(calculateLoggedMealTotals(items)).toEqual({ kcal: value, carbs: value, pro: value, fat: value });
    });

    it.each([900719925474099.5, 4503599627370495.5, 562949953421312.1, 562949953421312.5])(
        'preserves large finite fractional macros whose representable value already rounds to a tenth: %s',
        value => {
            const items = [meal({ carbs: value, pro: value, fat: value })];
            const original = structuredClone(items);
            expect(calculateLoggedMealTotals(items)).toEqual({ kcal: 0, carbs: value, pro: value, fat: value });
            expect(items).toEqual(original);
        },
    );

    it('still rounds to a tenth below the coarse-precision boundary', () => {
        const value = 562949953421311.94;
        expect(calculateLoggedMealTotals([meal({ carbs: value, pro: value, fat: value })])).toEqual({
            kcal: 0, carbs: 562949953421311.9, pro: 562949953421311.9, fat: 562949953421311.9,
        });
    });

    it('retains quick-meal and gram serving defaults', () => {
        const portion = meal({ meal: 'quick', unit: 'porzione', quantity: 2, kcal: 120, carbs: 10 });
        expect(getLoggedMealPortion(portion)).toEqual({ quantity: 2, ratio: 2 });
        expect(calculateLoggedMealTotals([portion])).toEqual({ kcal: 240, carbs: 20, pro: 0, fat: 0 });
        expect(getLoggedMealPortion(meal({ quantity: 50 })).ratio).toBe(0.5);
    });

    it('treats quick meals and per-piece units independently and avoids invalid serving bases', () => {
        expect(getLoggedMealPortion(meal({
            meal: 'quick', unit: 'g', baseQty: undefined, quantity: 2,
        }))).toEqual({ quantity: 2, ratio: 2 });
        expect(getLoggedMealPortion(meal({
            meal: 'pranzo', unit: 'porzione', baseQty: undefined, quantity: 2,
        }))).toEqual({ quantity: 2, ratio: 2 });
        for (const baseQty of [0, -10]) {
            expect(getLoggedMealPortion(meal({
                meal: 'pranzo', unit: 'g', baseQty, quantity: 50,
            }))).toEqual({ quantity: 50, ratio: 0.5 });
        }
        expect(getLoggedMealPortion(meal({
            baseQty: 80, quantity: undefined,
        }))).toEqual({ quantity: 80, ratio: 1 });
    });

    it('accepts empty collections and ignores invalid nutrient numbers without changing valid fields', () => {
        expect(calculateRawLoggedMealTotals([])).toEqual({ kcal: 0, carbs: 0, pro: 0, fat: 0 });
        expect(calculateRawLoggedMealTotals(null as unknown as LoggedMealItem[]))
            .toEqual({ kcal: 0, carbs: 0, pro: 0, fat: 0 });
        expect(calculateRawLoggedMealTotals([meal({
            kcal: NaN, carbs: 10, pro: undefined, fat: 2,
        })])).toEqual({ kcal: 0, carbs: 10, pro: 0, fat: 2 });
    });

});
