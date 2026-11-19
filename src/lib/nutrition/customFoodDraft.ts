import type { Food } from '../../types';

// UI draft data is intentionally separate from the validated, persisted Food model.
export interface CustomFoodDraft {
    name: string;
    unit: string;
    brand?: string;
    pieceWeight?: string | number;
    kcal?: string | number;
    carbs?: string | number;
    pro?: string | number;
    fat?: string | number;
}

export function emptyCustomFoodDraft(): CustomFoodDraft {
    return { name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' };
}

export function customFoodDraftFrom(food: Food): CustomFoodDraft {
    return {
        name: food.name || '',
        brand: food.brand || '',
        unit: food.unit || 'g',
        pieceWeight: food.servingWeight ?? '',
        kcal: food.kcal !== undefined ? String(food.kcal) : '',
        carbs: food.carbs !== undefined ? String(food.carbs) : '',
        pro: food.pro !== undefined ? String(food.pro) : '',
        fat: food.fat !== undefined ? String(food.fat) : '',
    };
}

export function customFoodValidationInput(draft: CustomFoodDraft) {
    return {
        ...draft,
        baseQty: 100,
        servingWeight: draft.unit === 'pezzo' ? draft.pieceWeight : null,
    };
}
