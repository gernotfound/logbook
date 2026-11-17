import { describe, it, expect } from 'vitest';
import { FoodSchema } from '../../../src/lib/schema';
import { calculateCustomFoodKcal } from '../../../src/lib/nutrition/calculateCustomFoodKcal';

describe('Nutrition macro boundary permutations', () => {
    describe('R2 Stress: Macro Combinations & Schema Boundary Testing', () => {

        it('Macro boundary permutations: zero, integer, decimal, string format invariance', () => {
            expect(calculateCustomFoodKcal(0, 0, 0)).toBe(0);
            expect(calculateCustomFoodKcal(10, 10, 10)).toBe(170);
            expect(calculateCustomFoodKcal('10', '10', '10')).toBe(170);
            expect(calculateCustomFoodKcal('10.0', '10.0', '10.0')).toBe(170);
            expect(calculateCustomFoodKcal('10,0', '10,0', '10,0')).toBe(170);
            expect(calculateCustomFoodKcal(' 10.5 ', ' 20.2 ', ' 5.1 ')).toBe(169); // 42 + 80.8 + 45.9 = 168.7 -> 169
        });

        it('does not infer macros from malformed partial or non-finite inputs', () => {
            expect(calculateCustomFoodKcal('12abc', '5', '2')).toBe(38);
            expect(calculateCustomFoodKcal('1e', '2', '3')).toBe(35);
            expect(calculateCustomFoodKcal('1e309', 0, 0)).toBe(0);
            expect(calculateCustomFoodKcal('1e308', '1e308', '1e308')).toBe(0);
            expect(calculateCustomFoodKcal('0x10', 0, 0)).toBe(0);
            expect(calculateCustomFoodKcal('-10', '-5', '-2')).toBe(-78);
        });

        it('FoodSchema validates and parses 100 deterministic macro combinations', () => {
            for (let i = 0; i < 100; i++) {
                const food = {
                    id: `food_${i}`,
                    name: `Food Item ${i}`,
                    carbs: (i * 1.5) % 100,
                    pro: (i * 0.8) % 50,
                    fat: (i * 0.5) % 40,
                    kcal: calculateCustomFoodKcal((i * 1.5) % 100, (i * 0.8) % 50, (i * 0.5) % 40),
                    isCustom: i % 2 === 0
                };
                const parsed = FoodSchema.parse(food);
                expect(parsed.name).toBe(`Food Item ${i}`);
                expect(Number.isFinite(parsed.kcal)).toBe(true);
            }
        });
    });
});
