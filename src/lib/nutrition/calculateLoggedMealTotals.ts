import type { LoggedMealItem } from '../../types';

/** Shared serving rules for the UI and the persisted domain projection. */
export function getLoggedMealPortion(item: LoggedMealItem): { quantity: number; ratio: number } {
    const base = item.baseQty != null && item.baseQty > 0
        ? item.baseQty : (item.unit === 'porzione' || item.meal === 'quick' ? 1 : 100);
    const quantity = item.quantity != null ? item.quantity : base;
    return { quantity, ratio: base > 0 ? quantity / base : 1 };
}

/** Preserve full precision for UI rounding. */
export function calculateRawLoggedMealTotals(meals: readonly LoggedMealItem[]) {
    let kcal = 0, carbs = 0, pro = 0, fat = 0;
    for (const item of meals ?? []) {
        const { ratio } = getLoggedMealPortion(item);
        kcal += (Number(item.kcal) || 0) * ratio;
        carbs += (Number(item.carbs) || 0) * ratio;
        pro += (Number(item.pro) || 0) * ratio;
        fat += (Number(item.fat) || 0) * ratio;
    }
    return { kcal, carbs, pro, fat };
}

/** Historical persisted rounding semantics, unchanged. */
export function calculateLoggedMealTotals(meals: readonly LoggedMealItem[]) {
    const { kcal, carbs, pro, fat } = calculateRawLoggedMealTotals(meals);
    return {
        kcal: Math.round(kcal),
        carbs: Math.round(carbs * 10) / 10,
        pro: Math.round(pro * 10) / 10,
        fat: Math.round(fat * 10) / 10,
    };
}
