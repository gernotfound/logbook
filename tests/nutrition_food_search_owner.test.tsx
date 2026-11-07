import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNutritionMeals } from '../src/hooks/useNutritionMeals';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { UserDataSchema } from '../src/lib/schema';
import { captureSession, invalidateSession } from '../src/lib/sync/session';
import { auth } from '../src/lib/firebase';

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

    it('drops the previous owners search hits during an authenticated owner transition', () => {
        const writableAuth = auth as unknown as { currentUser: typeof auth.currentUser };
        const previousUser = writableAuth.currentUser;
        try {
            writableAuth.currentUser = { ...previousUser!, uid: 'nutrition-search-a' };
            invalidateSession();
            useAppStore.setState({
                userData: ownerWithFood('private-a', 'Pollo privato A'),
                dataOwner: captureSession().owner,
            });
            const { result } = renderHook(() => useNutritionMeals('2026-10-15'));
            act(() => result.current.handleSearch('pollo'));
            expect(result.current.searchResults.map(food => food.id)).toEqual(['private-a']);

            // Auth changes before hydration; the old owner snapshot is unavailable.
            act(() => {
                writableAuth.currentUser = { ...previousUser!, uid: 'nutrition-search-b' };
                invalidateSession();
                useAppStore.setState({ userData: null, dataOwner: null });
            });
            expect(captureSession().owner).toBe('user:nutrition-search-b');
            expect(result.current.searchResults).toEqual([]);

            act(() => useAppStore.setState({
                userData: ownerWithFood('private-b', 'Pollo privato B'),
                dataOwner: captureSession().owner,
            }));
            expect(result.current.searchResults.map(food => food.id)).toEqual(['private-b']);
        } finally {
            writableAuth.currentUser = previousUser;
            invalidateSession();
        }
    });

    it('retains a newer owner query when an old meal-add completion arrives after A→B→A', async () => {
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        const owner = captureSession().owner;
        let complete!: (result: { ok: true; status: 'synced' }) => void;
        const pending = new Promise<{ ok: true; status: 'synced' }>(resolve => { complete = resolve; });
        useAppStore.setState({
            userData: ownerWithFood('food-old', 'Pollo'),
            dataOwner: owner,
            dispatchDomainOperation: vi.fn(() => pending) as typeof previousDispatch,
        });
        try {
            const { result } = renderHook(() => useNutritionMeals('2026-10-15'));
            act(() => result.current.handleSearch('pollo'));
            let saving!: Promise<void>;
            act(() => { saving = result.current.addFood(ownerWithFood('food-old', 'Pollo').customFoods[0], 'Pranzo'); });
            expect(useAppStore.getState().dispatchDomainOperation).toHaveBeenCalledOnce();
            act(() => {
                invalidateSession();
                invalidateSession();
                result.current.handleSearch('riso');
            });
            await act(async () => { complete({ ok: true, status: 'synced' }); await saving; });
            expect(result.current.searchQuery).toBe('riso');
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });

    it.each(['day-type', 'quick-add', 'clear-day', 'meal-add'] as const)(
        'does not show obsolete %s error after an Auth epoch replacement', async operation => {
            const previousDispatch = useAppStore.getState().dispatchDomainOperation;
            const previousAlert = useDialogStore.getState().showAlert;
            let rejectSave!: (reason: Error) => void;
            const pending = new Promise<never>((_, reject) => { rejectSave = reject; });
            const alert = vi.fn(async () => undefined);
            useAppStore.setState({
                userData: ownerWithFood('old-food', 'Pollo'),
                dataOwner: captureSession().owner,
                dispatchDomainOperation: vi.fn(() => pending) as typeof previousDispatch,
            });
            useDialogStore.setState({ showAlert: alert });
            try {
                const { result } = renderHook(() => useNutritionMeals('2026-10-15'));
                let saving!: Promise<unknown>;
                act(() => {
                    saving = operation === 'day-type' ? result.current.setDayType(true)
                        : operation === 'quick-add' ? result.current.handleQuickAdd({ name: 'Riso', kcal: 200, carbs: 40, pro: 5, fat: 2 })
                        : operation === 'clear-day' ? result.current.clearDay()
                        : result.current.addFood(ownerWithFood('old-food', 'Pollo').customFoods[0], 'Pranzo');
                });
                expect(useAppStore.getState().dispatchDomainOperation).toHaveBeenCalledOnce();
                act(() => { invalidateSession(); invalidateSession(); });
                await act(async () => { rejectSave(new Error('old account write rejected')); await saving; });
                expect(alert).not.toHaveBeenCalled();
            } finally {
                useAppStore.setState({ dispatchDomainOperation: previousDispatch });
                useDialogStore.setState({ showAlert: previousAlert });
            }
        },
    );

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
