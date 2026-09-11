import { NutritionPlanning } from '../types';

export function normalizeOnDaysCount(value: unknown): number {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return 4;
    if (typeof value !== 'number' && typeof value !== 'string') return 4;
    const count = Number(value);
    return Number.isInteger(count) ? Math.min(7, Math.max(0, count)) : 4;
}

export function createDefaultNutritionPlanning(): NutritionPlanning {
    return {
        weight: 80,
        carbsPerKg: 3.5,
        proPerKg: 2.0,
        fatPerKg: 1.0,
        lockedMacro: null,
        chartPeriod: 7,
        normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    };
}
