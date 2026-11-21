import { NutritionPlanning } from '../types';

export function normalizeOnDaysCount(value: unknown): number {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return 4;
    if (typeof value !== 'number' && typeof value !== 'string') return 4;
    const count = Number(value);
    return Number.isInteger(count) ? Math.min(7, Math.max(0, count)) : 4;
}

/** Keep editor values distinct from the fallback/clamping policy for stored plans. */
export function parseOnDaysCount(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value >= 0 && value <= 7 ? value : null;
    }
    if (typeof value === 'string' && /^[0-7]$/.test(value.trim())) {
        return Number(value.trim());
    }
    return null;
}

export function createDefaultNutritionPlanning(): NutritionPlanning {
    return {
        weight: 80,
        onDaysCount: 4,
        avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
        onBoost: { carbsPercent: 20, proPercent: 0, fatPercent: 0 },
        normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    };
}
