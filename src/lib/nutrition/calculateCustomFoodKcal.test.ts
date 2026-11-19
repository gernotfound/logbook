import { describe, expect, it } from 'vitest';
import { calculateCustomFoodKcal } from './calculateCustomFoodKcal';

// The preview accepts incomplete edits; the durable Food validator separately
// rejects negative nutrient values before any business write.
describe('calculateCustomFoodKcal — production preview', () => {
    it.each([
        { name: 'protein only', args: [0, 25, 0], result: 100 },
        { name: 'fat only', args: [0, 0, 14], result: 126 },
        { name: 'carbohydrates only', args: [50, 0, 0], result: 200 },
        { name: 'mixed fractional macros', args: [33.5, 18.2, 7.8], result: 277 },
        { name: 'empty text fields', args: ['', '', ''], result: 0 },
        { name: 'null and undefined fields', args: [null, undefined, null], result: 0 },
        { name: 'large finite macros', args: [500, 300, 200], result: 5000 },
        { name: 'invalid text fields', args: ['abc', 'xyz', '---'], result: 0 },
        { name: 'comma-decimal inputs', args: ['10,5', '20,0', '5,5'], result: 172 },
        { name: 'negative carbohydrate preview', args: [-10, 20, 5], result: 85 },
        { name: 'whitespace', args: ['   ', null, undefined], result: 0 },
        { name: 'fractional comma-decimals', args: ['12,5', '20,5', '5,5'], result: 182 },
        { name: 'small fractional rounding', args: ['0.1', '0.2', '0.3'], result: 4 },
        { name: 'all negative preview values', args: [-10, -5, -2], result: -78 },
        { name: 'high but finite values', args: [5000, 2000, 1000], result: 37000 },
        { name: 'fractional rounding boundary', args: [0.125, 0.125, 0.125], result: 2 },
        { name: 'nonfinite numeric input', args: ['1e309', 0, 0], result: 0 },
        { name: 'partial nutrient strings', args: ['25g', 10, 0], result: 40 },
        { name: 'arithmetic overflow', args: [1e308, 1e308, 1e308], result: 0 },
    ])('$name', ({ args, result }) => {
        expect(calculateCustomFoodKcal(args[0], args[1], args[2])).toBe(result);
    });
});
