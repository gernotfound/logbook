import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useNutritionMeals } from '../src/hooks/useNutritionMeals';
import { useAppStore } from '../src/store/useAppStore';
import { UserDataSchema } from '../src/lib/schema';

const previousData = useAppStore.getState().userData;

function ownerWithFood(id: string, name: string) {
    return {
        ...UserDataSchema.parse({}),
        customFoods: [{ id, name, unit: 'g', baseQty: 100, kcal: 100, carbs: 10, pro: 10, fat: 1 }],
    };
}

describe('owner-scoped food search', () => {
    afterEach(() => useAppStore.setState({ userData: previousData }));

    it('updates results after catalog edits and owner changes without another keystroke', () => {
        useAppStore.setState({ userData: ownerWithFood('food-a', 'Pollo') });
        const { result } = renderHook(() => useNutritionMeals('2026-10-15'));

        act(() => result.current.handleSearch('pollo'));
        expect(result.current.searchResults.map(food => food.id)).toEqual(['food-a']);

        act(() => useAppStore.setState({ userData: ownerWithFood('food-b', 'Riso') }));
        expect(result.current.searchResults).toEqual([]);

        act(() => useAppStore.setState({ userData: ownerWithFood('food-c', 'Pollo arrosto') }));
        expect(result.current.searchResults.map(food => food.id)).toEqual(['food-c']);

        act(() => result.current.clearSearch());
        expect(result.current.searchResults).toEqual([]);
    });
});
