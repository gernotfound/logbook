import { describe, expect, it } from 'vitest';
import { searchFoods } from './nutrition';
import type { Food } from '../../types';

describe('typed food search', () => {
    const foods: Food[] = [
        { id: 'a', name: 'Petto di pollo', kcal: 100, carbs: 0, pro: 22, fat: 2 },
        { id: 'b', name: 'Olio di oliva', kcal: 900, carbs: 0, pro: 0, fat: 100 },
    ];
    it('preserves original nutrient fields and the item type', () => {
        const matches: Food[] = searchFoods(foods, 'pollo');
        expect(matches).toHaveLength(1);
        expect(matches[0].pro).toBe(22);
    });
    it('preserves the category filter, case folding and empty-query contract', () => {
        const withCategory = foods.map((f, i) => ({ ...f, category: i ? 'olio' : 'carne' }));
        expect(searchFoods(withCategory, '', 'carne').map(x => x.id)).toEqual(['a']);
        expect(searchFoods(withCategory, 'POLLO').map(x => x.id)).toEqual(['a']);
        expect(searchFoods(withCategory, 'pesce')).toEqual([]);
    });
});
