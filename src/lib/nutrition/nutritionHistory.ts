import type { NutritionDay } from '../../types';

export function selectNutritionHistory(nutrition: Readonly<Record<string, NutritionDay>> | undefined): NutritionDay[] {
    if (!nutrition) return [];
    return Object.values(nutrition)
        .filter(day => Boolean(day?.meals?.length))
        .sort((a, b) => b.date.localeCompare(a.date));
}
