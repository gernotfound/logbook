import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NutritionMeals from '../../src/components/Nutrition/NutritionMeals';
import NutritionView from '../../src/components/Nutrition/NutritionView';
import { useAppStore } from '../../src/store/useAppStore';
import { useDialogStore } from '../../src/store/useDialogStore';
import type { NutritionSubTab } from '../../src/types';
import { Logic } from '../../src/lib/logic';
import { invalidateSession } from '../../src/lib/sync/session';
import { emptyUserData, renderWithProviders } from '../setup';

describe('NutritionMeals navigation, day type and archive editing', () => {
    it('does not apply a confirmed day-type change after its Auth session was replaced', async () => {
        const showConfirm = vi.mocked(useDialogStore.getState().showConfirm);
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        let resolveConfirmation!: (choice: boolean) => void;
        showConfirm.mockReset().mockImplementationOnce(() => new Promise(resolve => {
            resolveConfirmation = resolve;
        }));
        const setDayType = vi.fn().mockResolvedValue(undefined);
        const mockHook = {
            targetDateStr: '2026-10-20',
            todayNutrition: { date: '2026-10-20', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] },
            dailyTarget: { kcal: 0, carbs: 0, pro: 0, fat: 0 },
            isDayOn: true, setDayType,
            searchQuery: '', handleSearch: vi.fn(), searchResults: [], clearSearch: vi.fn(),
            showCustomModal: false, setShowCustomModal: vi.fn(), editingFoodId: null,
            cancelCustomFood: vi.fn(), cfData: {}, setCfData: vi.fn(), saveCustomFood: vi.fn(),
            meals: [], addFood: vi.fn(), removeFood: vi.fn().mockResolvedValue(true),
            updateMealItem: vi.fn().mockResolvedValue(true),
        } as unknown as React.ComponentProps<typeof NutritionMeals>['mealsHook'];
        try {
            render(<NutritionMeals mealsHook={mockHook} />);
            fireEvent.click(screen.getByRole('button', { name: 'OFF' }));
            expect(showConfirm).toHaveBeenCalledOnce();
            // The original account can disappear and return with the same UID.
            act(() => { invalidateSession(); invalidateSession(); });
            await act(async () => { resolveConfirmation(true); });
            expect(setDayType).not.toHaveBeenCalled();
        } finally {
            showConfirm.mockReset().mockResolvedValue(true);
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

    it('preserves date navigation, search add, meal editing, and removal callbacks', () => {
        const setSelectedDate = vi.fn();
        const handleSearch = vi.fn();
        const addFood = vi.fn();
        const removeFood = vi.fn().mockResolvedValue(true);
        const food = {
            id: 'rice',
            name: 'Riso basmati',
            kcal: 350,
            baseQty: 100,
            unit: 'g',
            pro: 7,
            carbs: 78,
            fat: 1,
        };
        const meal = {
            id: 'm1',
            name: 'Avena',
            quantity: 80,
            baseQty: 100,
            unit: 'g',
            kcal: 300,
            pro: 10,
            carbs: 50,
            fat: 5,
            meal: 'Colazione',
        };
        const mockHook: any = {
            todayNutrition: { date: '2026-08-16', kcal: 1800, pro: 140, carbs: 200, fat: 50, meals: [meal] },
            dailyTarget: { kcal: 2400, pro: 160, carbs: 280, fat: 65 },
            isDayOn: true,
            setDayType: vi.fn(),
            searchQuery: 'ris',
            handleSearch,
            searchResults: [food],
            clearSearch: vi.fn(),
            showCustomModal: false,
            setShowCustomModal: vi.fn(),
            editingFoodId: null,
            cancelCustomFood: vi.fn(),
            cfData: { name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' },
            setCfData: vi.fn(),
            saveCustomFood: vi.fn(),
            meals: [meal],
            addFood,
            removeFood,
            updateMealItem: vi.fn().mockResolvedValue(true),
            targetDateStr: '2026-08-16',
        };

        const weightLookup = vi.spyOn(Logic, 'getLatestUserWeight');
        renderWithProviders(
            <NutritionMeals mealsHook={mockHook} selectedDate="2026-08-16" setSelectedDate={setSelectedDate} />
        );
        // The supplied parent hook owns nutrition data: do not mount an unused second hook.
        expect(weightLookup).not.toHaveBeenCalled();
        weightLookup.mockRestore();

        fireEvent.click(screen.getByRole('button', { name: 'Prec. Giorno precedente' }));
        expect(setSelectedDate).toHaveBeenCalledWith('2026-08-15');

        fireEvent.change(screen.getByPlaceholderText(/Cerca alimento/i), { target: { value: 'pollo' } });
        expect(handleSearch).toHaveBeenCalledWith('pollo');

        fireEvent.click(screen.getByTitle('Aggiungi a Colazione'));
        expect(addFood).toHaveBeenCalledWith(food, 'Colazione');

        fireEvent.click(screen.getByRole('button', { name: 'Modifica porzione di Avena' }));
        expect(screen.getByRole('heading', { level: 2, name: /Modifica porzione/i })).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
        expect(removeFood).toHaveBeenCalledWith('m1');
    });

    it('returns to the actual local today using the production nutrition date navigator', () => {
        vi.useFakeTimers();
        vi.stubEnv('TZ', 'Europe/Rome');
        vi.setSystemTime(new Date(2026, 9, 20, 14, 0, 0));
        try {
            function Harness() {
                const [date, setDate] = useState('2026-10-18');
                const hook: any = {
                    todayNutrition: { date, kcal: 0, pro: 0, carbs: 0, fat: 0, meals: [] },
                    dailyTarget: { kcal: 0, pro: 0, carbs: 0, fat: 0 },
                    isDayOn: undefined, setDayType: vi.fn(), searchQuery: '', handleSearch: vi.fn(),
                    searchResults: [], clearSearch: vi.fn(), showCustomModal: false, setShowCustomModal: vi.fn(),
                    editingFoodId: null, cancelCustomFood: vi.fn(), cfData: {}, setCfData: vi.fn(),
                    saveCustomFood: vi.fn(), meals: [], addFood: vi.fn(), removeFood: vi.fn().mockResolvedValue(true),
                    updateMealItem: vi.fn().mockResolvedValue(true), targetDateStr: date,
                };
                return <>
                    <output data-testid="chosen-day">{date}</output>
                    <NutritionMeals mealsHook={hook} selectedDate={date} setSelectedDate={setDate} />
                </>;
            }
            renderWithProviders(<Harness />);
            fireEvent.click(screen.getByTitle('Torna a oggi'));
            expect(screen.getByTestId('chosen-day').textContent).toBe('2026-10-20');
            fireEvent.click(screen.getByRole('button', { name: 'Prec. Giorno precedente' }));
            expect(screen.getByTestId('chosen-day').textContent).toBe('2026-10-19');
            fireEvent.click(screen.getByTitle('Torna a oggi'));
            expect(screen.getByTestId('chosen-day').textContent).toBe('2026-10-20');
        } finally {
            vi.useRealTimers();
            vi.unstubAllEnvs();
        }
    });

    it('keeps custom-food editing on the meals tab until a durable save succeeds', async () => {
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        const dispatch = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 'failed', error: new Error('write rejected') })
            .mockResolvedValueOnce({ ok: true, status: 'synced' });
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        function Harness() {
            const [subTab, setSubTab] = useState<NutritionSubTab>('archive');
            return <>
                <output data-testid="nutrition-tab">{subTab}</output>
                <NutritionView subTab={subTab} setSubTab={setSubTab} />
            </>;
        }
        try {
            renderWithProviders(<Harness />, {
                userData: { ...emptyUserData, nutrition: {}, customFoods: [{
                    id: 'meal-edit-food', name: 'Pollo test', brand: 'Produttore',
                    unit: 'g', baseQty: 100, kcal: 200, carbs: 10, pro: 40, fat: 1,
                    isCustom: true,
                }] },
            });
            fireEvent.click(await screen.findByRole('button', { name: 'Opzioni' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica' }));
            expect(screen.getByTestId('nutrition-tab').textContent).toBe('meals');
            expect(screen.getByRole('heading', { name: 'Modifica alimento' })).toBeDefined();
            fireEvent.click(screen.getByRole('button', { name: 'Salva modifiche' }));
            await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
            expect(screen.getByTestId('nutrition-tab').textContent).toBe('meals');
            expect(screen.getByRole('heading', { name: 'Modifica alimento' })).toBeDefined();
            // The shared UI harness supplies an already-resolved dialog stub;
            // assert the actual alert callback and wait for the form to unlock.
            expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith("Errore durante il salvataggio dell'alimento.");
            await waitFor(() => expect((screen.getByRole('button', { name: 'Salva modifiche' }) as HTMLButtonElement).disabled).toBe(false));
            fireEvent.click(screen.getByRole('button', { name: 'Salva modifiche' }));
            await waitFor(() => expect(screen.getByTestId('nutrition-tab').textContent).toBe('archive'));
            expect(dispatch).toHaveBeenCalledTimes(2);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

});
