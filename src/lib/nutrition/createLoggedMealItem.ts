import type { Food, LoggedMealItem } from '../../types';

/** Persist per-piece nutrients against one piece, not the source food's 100 g reference. */
export function createLoggedMealItem(food: Food, meal: string, id: string, time: number): LoggedMealItem {
    const baseQty = typeof food.baseQty === 'number' && Number.isFinite(food.baseQty) && food.baseQty > 0
        ? food.baseQty : 100;
    const isPiece = food.unit === 'pezzo' || food.unit === 'pcs';
    if (isPiece && (typeof food.servingWeight !== 'number' || !Number.isFinite(food.servingWeight) || food.servingWeight <= 0)) {
        throw new Error('Per aggiungere un alimento a pezzo, indica prima il peso di un pezzo.');
    }
    const factor = isPiece ? food.servingWeight! / baseQty : 1;
    if (![food.kcal, food.carbs, food.pro, food.fat].every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error('Valori nutrizionali non validi.');
    }
    const nutrients = {
        kcal: food.kcal * factor,
        carbs: food.carbs * factor,
        pro: food.pro * factor,
        fat: food.fat * factor,
    };
    if (!Object.values(nutrients).every(Number.isFinite)) {
        throw new Error('Valori nutrizionali non validi.');
    }
    return {
        id,
        foodId: food.id,
        name: food.name,
        meal,
        quantity: isPiece ? 1 : baseQty,
        baseQty: isPiece ? 1 : baseQty,
        unit: isPiece ? 'pezzo' : (food.unit || 'g'),
        ...nutrients,
        time,
    };
}
