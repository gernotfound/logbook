import { describe, expect, it } from 'vitest';
import { createLoggedMealItem } from './createLoggedMealItem';
import { calculateLoggedMealTotals } from './calculateLoggedMealTotals';

describe('logged food reference quantities', () => {
    const food = { id: 'f1', name: 'Biscotto', unit: 'pezzo', baseQty: 100, servingWeight: 60, kcal: 120, carbs: 15, pro: 5, fat: 4 };

    it('records one piece against one piece of nutrients instead of 100 pieces', () => {
        const item = createLoggedMealItem(food, 'Colazione', 'meal-1', 1234);
        expect(item).toMatchObject({ id: 'meal-1', foodId: 'f1', quantity: 1, baseQty: 1, unit: 'pezzo', kcal: 72, carbs: 9, pro: 3, fat: 2.4 });
        expect(calculateLoggedMealTotals([{ ...item, quantity: 2 }])).toEqual({ kcal: 144, carbs: 18, pro: 6, fat: 4.8 });
    });

    it('preserves gram and millilitre reference quantities', () => {
        for (const unit of ['g', 'ml']) {
            const item = createLoggedMealItem({ ...food, unit }, 'Pranzo', 'meal-2', 4);
            expect(item).toMatchObject({ quantity: 100, baseQty: 100, unit, kcal: 120, carbs: 15 });
        }
    });

    it('rejects a piece with missing or nonpositive weight rather than inventing a serving', () => {
        for (const servingWeight of [undefined, null, 0, -3, Infinity]) {
            expect(() => createLoggedMealItem({ ...food, servingWeight }, 'Pranzo', 'meal-3', 4)).toThrow('peso di un pezzo');
        }
    });
});
