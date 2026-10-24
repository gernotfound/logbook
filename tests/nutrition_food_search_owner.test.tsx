import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useNutritionMeals } from '../src/hooks/useNutritionMeals';
import { useAppStore } from '../src/store/useAppStore';
import { UserDataSchema } from '../src/lib/schema';
import { captureSession } from '../src/lib/sync/session';

const previousData = useAppStore.getState().userData;
const previousOwner = useAppStore.getState().dataOwner;

function ownerWithFood(id: string, name: string) {
    return {
        ...UserDataSchema.parse({}),
        customFoods: [{ id, name, unit: 'g', baseQty: 100, kcal: 100, carbs: 10, pro: 10, fat: 1 }],
    };
}

describe('owner-scoped food search', () => {
    afterEach(() => useAppStore.setState({ userData: previousData, dataOwner: previousOwner }));

    it('recomputes results on owner-bound food dataset changes without another keystroke', () => {
        const dataOwner = captureSession().owner;
        useAppStore.setState({ userData: ownerWithFood('food-a', 'Pollo'), dataOwner });
        const { result } = renderHook(() => useNutritionMeals('2026-10-15'));

        act(() => result.current.handleSearch('pollo'));
        expect(result.current.searchResults.map(food => food.id)).toEqual(['food-a']);

        act(() => useAppStore.setState({ userData: ownerWithFood('food-b', 'Riso'), dataOwner }));
        expect(result.current.searchResults).toEqual([]);

        act(() => useAppStore.setState({ userData: ownerWithFood('food-c', 'Pollo arrosto'), dataOwner }));
        expect(result.current.searchResults.map(food => food.id)).toEqual(['food-c']);

        act(() => result.current.clearSearch());
        expect(result.current.searchResults).toEqual([]);
    });
});
