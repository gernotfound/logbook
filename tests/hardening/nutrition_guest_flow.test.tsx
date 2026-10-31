import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import { act, renderHook } from '@testing-library/react';
import { auth } from '../../src/lib/firebase';
import { DB } from '../../src/lib/db';
import { Logic } from '../../src/lib/logic';
import { UserDataSchema } from '../../src/lib/schema';
import { calculateLoggedMealTotals } from '../../src/lib/nutrition/calculateLoggedMealTotals';
import { activateGuestSession, captureSession, GUEST_SESSION_KEY, invalidateSession } from '../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
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

beforeEach(async () => {
    useAppStore.getState().resetStore();
    vi.clearAllMocks();
    (auth as any).currentUser = { uid: 'nutrition-hardening-user' };
    vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
    useAppStore.setState({
        userData: fixture(),
        dataOwner: 'user:nutrition-hardening-user',
        localWorkout: null,
        syncing: false,
        saveError: null,
        syncHealth: 'synced',
        compatibilityStatus: 'ok',
        compatibilityError: null,
    });
    const owner = 'user:nutrition-hardening-user';
    await prepareUnlockedTestArchive(owner);
    await initializeLocal(owner, useAppStore.getState().userData!);
});
afterEach(() => lockAllVaults());

describe('M5 nutrition account flow through useNutritionMeals', () => {
    it('writes current nutrition only to the active guest archive, not the previous account owner', async () => {
        const previousUser = (auth as any).currentUser;
        const guestSessionId = 'chat14-nutrition-guest';
        try {
            (auth as any).currentUser = null;
            localStorage.setItem('logbook_is_guest', 'true');
            localStorage.setItem(GUEST_SESSION_KEY, guestSessionId);
            activateGuestSession(guestSessionId);
            const guestData = fixture();
            const previousArchiveBytes = await get('logbook:v2:user:nutrition-hardening-user');
            expect(previousArchiveBytes).toMatch(/^tlb-sealed:v1:/);
            await prepareUnlockedTestArchive('guest');
            await initializeLocal('guest', guestData);
            useAppStore.setState({ userData: guestData, dataOwner: 'guest' });
            expect(captureSession().owner).toBe('guest');

            const { result } = renderHook(() => useNutritionMeals(DATE));
            await runMutation(() => result.current.handleQuickAdd({
                name: 'Guest rice', kcal: 200, carbs: 40, pro: 10, fat: 2,
            }));
            const guestArchive = await readLocal('guest');
            expect(guestArchive?.data.nutrition?.[DATE]?.meals?.[0]?.name).toBe('Guest rice');
            // The guest session cannot unlock the former account. Compare
            // authenticated storage bytes instead of reading without authorization.
            expect(await get('logbook:v2:user:nutrition-hardening-user')).toBe(previousArchiveBytes);
        } finally {
            (auth as any).currentUser = previousUser;
            localStorage.removeItem('logbook_is_guest');
            localStorage.removeItem(GUEST_SESSION_KEY);
            invalidateSession();
        }
    });

    it('keeps meal identities distinct across same-timestamp edits, deletes and durable readback', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        await initializeLocal(owner, useAppStore.getState().userData!);
        const a = { id: 'meal-a', meal: 'pranzo', name: 'Avena', quantity: 100, baseQty: 100, kcal: 100, carbs: 10, pro: 5, fat: 4, time: 123 };
        const b = { ...a, id: 'meal-b', name: 'Riso' };
        await runMutation(() => useAppStore.getState().dispatchDomainOperation([
            { type: 'nutrition-meal.upsert', date: DATE, meal: a },
            { type: 'nutrition-meal.upsert', date: DATE, meal: b },
        ]));
        const { result } = renderHook(() => useNutritionMeals(DATE));
        let changed = false;
        await runMutation(async () => {
            changed = await result.current.updateMealItem({ ...b, quantity: 50 });
        });
        expect(changed).toBe(true);
        const edited = useAppStore.getState().userData?.nutrition?.[DATE]?.meals ?? [];
        expect(edited.find(meal => meal.id === 'meal-a')?.quantity).toBe(100);
        expect(edited.find(meal => meal.id === 'meal-b')?.quantity).toBe(50);
        await runMutation(() => result.current.removeFood('meal-b'));
        const after = useAppStore.getState().userData?.nutrition?.[DATE]?.meals ?? [];
        expect(after.map(meal => meal.id)).toEqual(['meal-a']);
        const disk = await readLocal(owner);
        expect(disk?.data.nutrition?.[DATE]?.meals?.map(meal => meal.id)).toEqual(['meal-a']);
    });

    it('returns the same ranked production results using the prepared search index', () => {
        const { result } = renderHook(() => useNutritionMeals(DATE));

        act(() => {
            result.current.handleSearch('pollo');
        });

        expect(result.current.searchResults).toEqual(
            Logic.searchFoods(useAppStore.getState().userData?.customFoods ?? [], 'pollo').slice(0, 15)
        );
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
        await runMutation(() => result.current.removeFood(updated.id));

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

    it('does not report success when the dispatcher returns a failed result without throwing', async () => {
        const showAlert = vi.mocked(useDialogStore.getState().showAlert);
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        const dispatchDomainOperation = vi.fn().mockResolvedValue({ ok: false, status: 'failed', error: new Error('Aggiornamento richiesto') });
        useAppStore.setState({ dispatchDomainOperation });
        try {
            const { result } = renderHook(() => useNutritionMeals(DATE));
            await act(async () => {
                await result.current.handleQuickAdd({ name: 'Rejected', kcal: 50, carbs: 5, pro: 5, fat: 1 });
            });
            expect(showAlert).toHaveBeenCalledWith("Errore durante il salvataggio dell'alimento.");
            expect(dispatchDomainOperation).toHaveBeenCalledTimes(1);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
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
    it('reflects a newer durable day-type value after an earlier user selection', async () => {
        const { result } = renderHook(() => useNutritionMeals(DATE));
        await runMutation(() => result.current.setDayType(false));
        expect(result.current.isDayOn).toBe(false);
        const current = useAppStore.getState().userData!;
        const day = current.nutrition?.[DATE]!;
        act(() => useAppStore.setState({
            userData: { ...current, nutrition: { ...current.nutrition,
                [DATE]: { ...day, isDayOn: true },
            } },
        }));
        expect(result.current.isDayOn).toBe(true);
        const replaced = useAppStore.getState().userData!;
        act(() => useAppStore.setState({
            userData: { ...replaced, nutrition: { ...replaced.nutrition,
                [DATE]: { ...replaced.nutrition![DATE], isDayOn: undefined },
            } },
        }));
        expect(result.current.isDayOn).toBeUndefined();
    });

    it('keeps the custom-food edit draft after both validation and durable dispatch failure', async () => {
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        const dispatch = vi.fn().mockResolvedValueOnce({
            ok: false, status: 'failed', error: new Error('IDB write rejected'),
        }).mockResolvedValueOnce({ ok: true, status: 'synced' });
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        try {
            const { result } = renderHook(() => useNutritionMeals(DATE));
            act(() => {
                result.current.setEditingFoodId('food-chicken');
                result.current.setShowCustomModal(true);
                result.current.setCfData({
                    name: 'Petto di pollo modificato', brand: 'Fixture', unit: 'g', pieceWeight: '',
                    kcal: '107', carbs: '10', pro: '10', fat: '3',
                });
            });
            let saved = false;
            await act(async () => { saved = await result.current.saveCustomFood(); });
            expect(saved).toBe(false);
            expect(result.current.showCustomModal).toBe(true);
            expect(result.current.editingFoodId).toBe('food-chicken');
            expect(result.current.cfData.name).toBe('Petto di pollo modificato');
            expect(dispatch).toHaveBeenCalledTimes(1);
            await act(async () => { saved = await result.current.saveCustomFood(); });
            expect(saved).toBe(true);
            expect(result.current.showCustomModal).toBe(false);
            expect(dispatch).toHaveBeenCalledTimes(2);
            expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
                type: 'food.upsert', food: expect.objectContaining({ id: 'food-chicken' }),
            }));
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

    it('preserves freshly updated nutrients when a stale meal editor changes only portion and group', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        await initializeLocal(owner, useAppStore.getState().userData!);
        const original = {
            id: 'shared-meal', name: 'Riso originale', meal: 'Colazione',
            quantity: 100, baseQty: 100, unit: 'g', kcal: 100, carbs: 10, pro: 5, fat: 2,
        };
        await runMutation(() => useAppStore.getState().dispatchDomainOperation({
            type: 'nutrition-meal.upsert', date: DATE, meal: original,
        }));
        const { result } = renderHook(() => useNutritionMeals(DATE));
        await runMutation(() => useAppStore.getState().dispatchDomainOperation({
            type: 'nutrition-meal.upsert', date: DATE,
            meal: { ...original, name: 'Riso aggiornato', kcal: 300, pro: 14 },
        }));
        let acknowledged = false;
        await runMutation(async () => {
            acknowledged = await result.current.updateMealItem({
                id: original.id, quantity: 60, meal: 'Pranzo',
            });
        });
        expect(acknowledged).toBe(true);
        const meal = useAppStore.getState().userData?.nutrition?.[DATE]?.meals?.[0];
        expect(meal).toMatchObject({
            id: original.id, name: 'Riso aggiornato', kcal: 300, pro: 14,
            quantity: 60, meal: 'Pranzo',
        });
        const disk = await readLocal(owner);
        expect(disk?.data.nutrition?.[DATE]?.meals?.[0]).toMatchObject({
            name: 'Riso aggiornato', kcal: 300, pro: 14, quantity: 60, meal: 'Pranzo',
        });
    });

});
