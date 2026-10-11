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
    it('retains quick-meal and gram serving defaults', () => {
        const portion = meal({ meal: 'quick', unit: 'porzione', quantity: 2, kcal: 120, carbs: 10 });
        expect(getLoggedMealPortion(portion)).toEqual({ quantity: 2, ratio: 2 });
        expect(calculateLoggedMealTotals([portion])).toEqual({ kcal: 240, carbs: 20, pro: 0, fat: 0 });
        expect(getLoggedMealPortion(meal({ quantity: 50 })).ratio).toBe(0.5);
    });
});
