import type { LoggedMealItem } from '../../types';
import { roundToTenth } from '../utils/rounding';

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

/** Reject arithmetic loss before permissive schema fallbacks can replace it with zero. */
export function calculateLoggedMealTotals(meals: readonly LoggedMealItem[]) {
    const { kcal, carbs, pro, fat } = calculateRawLoggedMealTotals(meals);
    if (![kcal, carbs, pro, fat].every(Number.isFinite)) {
        throw new Error('Totali nutrizionali non rappresentabili.');
    }
    return {
        kcal: Math.round(kcal),
        carbs: roundToTenth(carbs),
        pro: roundToTenth(pro),
        fat: roundToTenth(fat),
    };
}
