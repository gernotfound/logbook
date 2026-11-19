import { describe, expect, it } from 'vitest';
import { calculateDailyMacroTarget } from './nutrition';

describe('shared daily macro target policy', () => {
    const plan = {
        weight: 80,
        onMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 },
        offMacros: { carbsPerKg: 2, proPerKg: 2, fatPerKg: 1 },
    };

    it('uses the selected ON/OFF ratios and does not invent a target for unspecified days', () => {
        expect(calculateDailyMacroTarget(plan, true, 75)).toEqual({
            kcal: 2480, carbs: 280, pro: 160, fat: 80,
        });
        expect(calculateDailyMacroTarget(plan, false, 75)).toEqual({
            kcal: 2000, carbs: 160, pro: 160, fat: 80,
        });
        expect(calculateDailyMacroTarget(plan, undefined, 75)).toBeNull();
        expect(calculateDailyMacroTarget(undefined, true, 75)).toBeNull();
        expect(calculateDailyMacroTarget({ weight: 80 }, true, 75)).toBeNull();
    });

    it('uses the last valid observed weight when the plan has no valid weight', () => {
        expect(calculateDailyMacroTarget({ ...plan, weight: Number.POSITIVE_INFINITY }, true, 75)).toEqual({
            kcal: 2325, carbs: 263, pro: 150, fat: 75,
        });
        expect(calculateDailyMacroTarget({ ...plan, weight: 0 }, true, 75)?.kcal).toBe(2325);
    });

    it('returns zero targets for malformed ratios rather than presenting partial calories', () => {
        const bad = { ...plan, onMacros: { carbsPerKg: Number.NaN, proPerKg: 2, fatPerKg: 1 } };
        expect(calculateDailyMacroTarget(bad, true, 80)).toEqual({
            kcal: 0, carbs: 0, pro: 0, fat: 0,
        });
    });
});
