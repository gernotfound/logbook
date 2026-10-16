import { describe, expect, it } from 'vitest';
import { createFoodSearcher, searchFoods } from './nutrition';
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
    it('reuses normalized data while preserving fuzzy ranking and owner isolation', () => {
        const catalog = [
            { ...foods[0], brand: 'Marca', category: 'carne' },
            { ...foods[1], brand: 'Extra', category: 'olio' },
            { id: 'c', name: 'Pollo arrosto', kcal: 180, carbs: 0, pro: 28, fat: 7, category: 'carne' }
        ];
        const search = createFoodSearcher(catalog);
        for (const query of ['', 'pollo', 'POLLO', 'polo', 'pollo arrosto', 'ma']) {
            expect(search(query)).toEqual(searchFoods(catalog, query));
        }
        expect(createFoodSearcher(catalog, 'carne')('pollo')).toEqual(searchFoods(catalog, 'pollo', 'carne'));
        expect(search('pollo').map(item => item.id)).toEqual(['c', 'a']);
        const anotherOwner = createFoodSearcher([{ ...catalog[1], id: 'private' }]);
        expect(anotherOwner('pollo')).toEqual([]);
        expect(search('pollo')).toHaveLength(2);
    });

    it('preserves the category filter, case folding and empty-query contract', () => {
        const withCategory = foods.map((f, i) => ({ ...f, category: i ? 'olio' : 'carne' }));
        expect(searchFoods(withCategory, '', 'carne').map(x => x.id)).toEqual(['a']);
        expect(searchFoods(withCategory, 'POLLO').map(x => x.id)).toEqual(['a']);
        expect(searchFoods(withCategory, 'pesce')).toEqual([]);
    });
});
