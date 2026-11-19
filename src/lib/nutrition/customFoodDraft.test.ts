import { describe, expect, it } from 'vitest';
import type { Food } from '../../types';
import { customFoodDraftFrom, customFoodValidationInput, emptyCustomFoodDraft } from './customFoodDraft';
import { validateCustomFood } from '../calc/nutrition';

describe('shared custom-food draft conversions', () => {
    const food: Food = {
        id: 'piece-1', name: 'Biscotto', brand: 'Marca', unit: 'pezzo',
        baseQty: 100, servingWeight: 30, kcal: 430, carbs: 61, pro: 7.5, fat: 17,
    };

    it('creates independent empty drafts for both forms', () => {
        const a = emptyCustomFoodDraft();
        const b = emptyCustomFoodDraft();
        a.name = 'Modificato';
        expect(b).toEqual({
            name: '', brand: '', unit: 'g', pieceWeight: '',
            kcal: '', carbs: '', pro: '', fat: '',
        });
    });

    it('preserves the per-100g piece basis and validates through the production boundary', () => {
        const before = structuredClone(food);
        const draft = customFoodDraftFrom(food);
        expect(draft).toMatchObject({
            name: 'Biscotto', unit: 'pezzo', pieceWeight: 30,
            kcal: '430', carbs: '61', pro: '7.5', fat: '17',
        });
        const input = customFoodValidationInput(draft);
        expect(input.baseQty).toBe(100);
        expect(input.servingWeight).toBe(30);
        const result = validateCustomFood(input);
        expect(result.isValid).toBe(true);
        expect(result.cleanData?.servingWeight).toBe(30);
        expect(food).toEqual(before);
    });

    it('does not invent piece weight and leaves bad numeric text for strict validation', () => {
        const missing = customFoodValidationInput({ ...emptyCustomFoodDraft(), unit: 'pezzo', pieceWeight: '' });
        expect(validateCustomFood(missing).isValid).toBe(false);
        const invalid = customFoodValidationInput({ ...emptyCustomFoodDraft(), name: 'Valid', kcal: '120kcal', carbs: '15', pro: '4', fat: '3' });
        expect(validateCustomFood(invalid).isValid).toBe(false);
        expect(customFoodValidationInput(customFoodDraftFrom({ ...food, unit: 'g' })).servingWeight).toBeNull();
    });
});
