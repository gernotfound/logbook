import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { auth } from '../../src/lib/firebase';
import { DB } from '../../src/lib/db';
import { Logic } from '../../src/lib/logic';
import { UserDataSchema } from '../../src/lib/schema';
import { calculateLoggedMealTotals } from '../../src/lib/nutrition/calculateLoggedMealTotals';
import { useNutritionMeals } from '../../src/hooks/useNutritionMeals';
import { useDialogStore } from '../../src/store/useDialogStore';
import { useAppStore } from '../../src/store/useAppStore';
import type { UserData } from '../../src/types';

const DATE = '2026-09-14';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

function fixture(): UserData {
    return parse({
        profile: { name: 'Nutrition hardening' },
        nutrition: {},
        customFoods: [
            { id: 'food-chicken', name: 'Petto di Pollo', brand: 'Fixture', category: 'Carne', baseQty: 100, unit: 'g', kcal: 200, carbs: 40, pro: 10, fat: 2, isCustom: true },
            { id: 'food-rice', name: 'Riso Basmati', brand: 'Fixture', category: 'Cereali', baseQty: 100, unit: 'g', kcal: 350, carbs: 77, pro: 8, fat: 1, isCustom: true },
        ],
    });
}

async function runMutation(action: () => Promise<unknown>) {
    let operation!: Promise<unknown>;
    act(() => {
        operation = action();
    });
    await act(async () => {
        await useAppStore.getState().flushPendingSyncs();
        await operation;
    });
}

beforeEach(() => {
    useAppStore.getState().resetStore();
    vi.clearAllMocks();
    (auth as any).currentUser = { uid: 'nutrition-hardening-user' };
    vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
    useAppStore.setState({
        userData: fixture(),
        localWorkout: null,
        syncing: false,
        saveError: null,
        syncHealth: 'synced',
        compatibilityStatus: 'ok',
        compatibilityError: null,
    });
});

describe('M5 nutrition guest flow through useNutritionMeals', () => {
    it('routes food search through Logic.searchFoods and exposes production results', () => {
        const searchSpy = vi.spyOn(Logic, 'searchFoods');
        const { result } = renderHook(() => useNutritionMeals(DATE));

        act(() => {
            result.current.handleSearch('pollo');
        });

        expect(searchSpy).toHaveBeenCalledWith(useAppStore.getState().userData?.customFoods, 'pollo');
        expect(result.current.searchQuery).toBe('pollo');
        expect(result.current.searchResults.map(food => food.id)).toContain('food-chicken');
        expect(result.current.searchResults.map(food => food.id)).not.toContain('food-rice');
    });

    it('adds, rescales and removes a meal through the real store mutation path', async () => {
        const { result } = renderHook(() => useNutritionMeals(DATE));
        const chicken = useAppStore.getState().userData?.customFoods?.find(food => food.id === 'food-chicken');
        expect(chicken).toBeDefined();

        await runMutation(() => result.current.addFood(chicken!, 'pranzo'));

        let day = useAppStore.getState().userData?.nutrition?.[DATE];
        expect(day?.meals).toHaveLength(1);
        expect(day?.kcal).toBe(200);
        expect(day?.carbs).toBe(40);
        expect(day?.pro).toBe(10);
        expect(day?.fat).toBe(2);
        expect(day?.isDayOn).toBeUndefined();
        expect({ kcal: day?.kcal, carbs: day?.carbs, pro: day?.pro, fat: day?.fat }).toEqual(calculateLoggedMealTotals(day?.meals ?? []));

        const added = day!.meals![0] as any;
        await runMutation(() => result.current.updateMealItem({ ...added, quantity: 50 }));

        day = useAppStore.getState().userData?.nutrition?.[DATE];
        expect(day?.kcal).toBe(100);
        expect(day?.carbs).toBe(20);
        expect(day?.pro).toBe(5);
        expect(day?.fat).toBe(1);
        expect({ kcal: day?.kcal, carbs: day?.carbs, pro: day?.pro, fat: day?.fat }).toEqual(calculateLoggedMealTotals(day?.meals ?? []));

        const updated = day!.meals![0] as any;
        await runMutation(() => result.current.removeFood(updated.itemId || updated.time || updated.id));

        day = useAppStore.getState().userData?.nutrition?.[DATE];
        expect(day?.meals).toEqual([]);
        expect({ kcal: day?.kcal, carbs: day?.carbs, pro: day?.pro, fat: day?.fat }).toEqual({ kcal: 0, carbs: 0, pro: 0, fat: 0 });
        expect(calculateLoggedMealTotals(day?.meals ?? [])).toEqual({ kcal: 0, carbs: 0, pro: 0, fat: 0 });
        expect(DB.saveUserData).toHaveBeenCalledTimes(3);
    });

    it('keeps an unspecified day type missing until the user explicitly selects ON or OFF', async () => {
        const { result } = renderHook(() => useNutritionMeals(DATE));
        expect(result.current.isDayOn).toBeUndefined();

        await runMutation(() => result.current.setDayType(false));

        let day = useAppStore.getState().userData?.nutrition?.[DATE];
        expect(day?.isDayOn).toBe(false);

        await runMutation(() => result.current.setDayType(undefined));
        day = useAppStore.getState().userData?.nutrition?.[DATE];
        expect(day?.isDayOn).toBeUndefined();
    });

    it('persists quick-add nutrition with per-serving semantics', async () => {
        const { result } = renderHook(() => useNutritionMeals(DATE));

        await runMutation(() => result.current.handleQuickAdd({
            name: 'Pasto rapido',
            kcal: 420,
            carbs: 55,
            pro: 30,
            fat: 9,
        }));

        const day = useAppStore.getState().userData?.nutrition?.[DATE];
        expect(day?.meals).toHaveLength(1);
        expect(day?.meals?.[0]).toMatchObject({ meal: 'quick', quantity: 1, baseQty: 1, unit: 'porzione' });
        expect({ kcal: day?.kcal, carbs: day?.carbs, pro: day?.pro, fat: day?.fat }).toEqual({ kcal: 420, carbs: 55, pro: 30, fat: 9 });
        expect({ kcal: day?.kcal, carbs: day?.carbs, pro: day?.pro, fat: day?.fat }).toEqual(calculateLoggedMealTotals(day?.meals ?? []));
    });

    it('reports persistence failure through the dialog boundary instead of resolving it as a silent success', async () => {
        vi.mocked(DB.saveUserData).mockRejectedValueOnce(new Error('persist failure'));
        const showAlert = vi.mocked(useDialogStore.getState().showAlert);
        const { result } = renderHook(() => useNutritionMeals(DATE));

        await runMutation(() => result.current.handleQuickAdd({
            name: 'Failure fixture',
            kcal: 100,
            carbs: 10,
            pro: 5,
            fat: 3,
        }));

        expect(showAlert).toHaveBeenCalledWith("Errore durante il salvataggio dell'alimento.");
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(useAppStore.getState().saveError).toBe('persist failure');
    });
});
