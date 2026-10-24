import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NutritionMeals from '../src/components/Nutrition/NutritionMeals';
import { NutritionMealSection } from '../src/components/Nutrition/meals/NutritionMealSection';
import type { LoggedMealItem } from '../src/types';
import { Logic } from '../src/lib/logic';
import { renderWithProviders } from './setup';

describe('NutritionMeals decomposition parity', () => {
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

        fireEvent.click(screen.getByRole('button', { name: 'Giorno precedente' }));
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
            fireEvent.click(screen.getByRole('button', { name: 'Giorno precedente' }));
            expect(screen.getByTestId('chosen-day').textContent).toBe('2026-10-19');
            fireEvent.click(screen.getByTitle('Torna a oggi'));
            expect(screen.getByTestId('chosen-day').textContent).toBe('2026-10-20');
        } finally {
            vi.useRealTimers();
            vi.unstubAllEnvs();
        }
    });

    it('targets the correct meal by ID when timestamps collide or are absent', async () => {
        const first: LoggedMealItem = { id: 'meal-a', name: 'Avena', meal: 'Colazione', quantity: 100, baseQty: 100, kcal: 100, carbs: 10, pro: 5, fat: 4, time: 123 };
        const second: LoggedMealItem = { ...first, id: 'meal-b', name: 'Riso', time: 123 };
        const third: LoggedMealItem = { ...first, id: 'meal-c', name: 'Pasta', time: undefined };
        const fourth: LoggedMealItem = { ...first, id: 'meal-d', name: 'Orzo', time: undefined };
        const onRemove = vi.fn().mockResolvedValue(true);
        const onUpdate = vi.fn().mockResolvedValue(true);
        function Harness() {
            const [editing, setEditing] = useState<LoggedMealItem | null>(null);
            return <NutritionMealSection mealType="Colazione" mealItems={[first, second, third, fourth]}
                editingMealItem={editing} onEditingMealItemChange={setEditing}
                onUpdateMealItem={onUpdate} onRemoveFood={onRemove} />;
        }
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Modifica porzione di Riso' }));
        expect(screen.getAllByRole('heading', { name: 'Modifica porzione' })).toHaveLength(1);
        expect(screen.getByText('Riso')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
        await waitFor(() => expect(onRemove).toHaveBeenCalledWith('meal-b'));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Modifica porzione' })).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Modifica porzione di Orzo' }));
        expect(screen.getAllByRole('heading', { name: 'Modifica porzione' })).toHaveLength(1);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });
        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'meal-d', quantity: 50 })));
        expect(onRemove).not.toHaveBeenCalledWith('meal-a');
        expect(onRemove).not.toHaveBeenCalledWith('meal-c');
    });

    it('keeps an unsaved quantity editable until the asynchronous device commit succeeds', async () => {
        const meal: LoggedMealItem = { id: 'meal-1', name: 'Avena', meal: 'Colazione', quantity: 100, baseQty: 100, kcal: 100, carbs: 10, pro: 5, fat: 4 };
        let settleFirst!: (saved: boolean) => void;
        const onUpdate = vi.fn()
            .mockImplementationOnce(() => new Promise<boolean>(resolve => { settleFirst = resolve; }))
            .mockResolvedValueOnce(true);
        function Harness() {
            const [editing, setEditing] = useState<LoggedMealItem | null>(meal);
            return <NutritionMealSection mealType="Colazione" mealItems={[meal]}
                editingMealItem={editing} onEditingMealItemChange={setEditing}
                onUpdateMealItem={onUpdate} onRemoveFood={vi.fn().mockResolvedValue(true)} />;
        }
        render(<Harness />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '75' } });
        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('heading', { name: 'Modifica porzione' })).toBeDefined();
        await act(async () => settleFirst(false));
        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('75');
        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Modifica porzione' })).toBeNull());
        expect(onUpdate).toHaveBeenCalledTimes(2);
        expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'meal-1', quantity: 75 }));
    });

    it('shows quick-add entries with ID-based edit and deletion instead of hiding their calories', async () => {
        const quick: LoggedMealItem = {
            id: 'quick-1', name: 'Pasto veloce', meal: 'quick', quantity: 1,
            baseQty: 1, unit: 'porzione', kcal: 410, carbs: 40, pro: 30, fat: 14,
        };
        const onRemove = vi.fn().mockResolvedValue(true);
        const hook: any = {
            targetDateStr: '2026-09-14',
            todayNutrition: { date: '2026-09-14', kcal: 410, carbs: 40, pro: 30, fat: 14, meals: [quick] },
            dailyTarget: { kcal: 2100, carbs: 200, pro: 150, fat: 60 },
            isDayOn: undefined, setDayType: vi.fn(), searchQuery: '', handleSearch: vi.fn(),
            searchResults: [], clearSearch: vi.fn(), showCustomModal: false,
            setShowCustomModal: vi.fn(), editingFoodId: null, cancelCustomFood: vi.fn(),
            cfData: {}, setCfData: vi.fn(), saveCustomFood: vi.fn(),
            meals: [quick], addFood: vi.fn(), removeFood: onRemove,
            updateMealItem: vi.fn().mockResolvedValue(true),
        };
        renderWithProviders(<NutritionMeals mealsHook={hook} selectedDate="2026-09-14" />);
        expect(screen.getByRole('heading', { name: 'Aggiunte rapide' })).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Modifica porzione di Pasto veloce' }));
        expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('quick');
        fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
        await waitFor(() => expect(onRemove).toHaveBeenCalledWith('quick-1'));
    });

    it('blocks negative portions and locks edits while the previous commit remains unsettled', async () => {
        const meal: LoggedMealItem = { id: 'safe-portion', name: 'Latte', meal: 'Colazione',
            quantity: 100, baseQty: 100, kcal: 90, carbs: 5, pro: 5, fat: 5 };
        let release!: (saved: boolean) => void;
        const onSave = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
        function Harness() {
            const [editing, setEditing] = useState<LoggedMealItem | null>(meal);
            return <NutritionMealSection mealType="Colazione" mealItems={[meal]}
                editingMealItem={editing} onEditingMealItemChange={setEditing}
                onUpdateMealItem={onSave} onRemoveFood={vi.fn().mockResolvedValue(true)} />;
        }
        render(<Harness />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '-5' } });
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByRole('button', { name: 'Salva' }).hasAttribute('disabled')).toBe(true);
        expect(onSave).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: '60' } });
        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        expect(screen.getByRole('button', { name: 'Chiudi modifica porzione' }).hasAttribute('disabled')).toBe(true);
        expect(input.disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Rimuovi' }).hasAttribute('disabled')).toBe(true);
        await act(async () => release(false));
        expect(input.disabled).toBe(false);
        expect(input.value).toBe('60');
        expect(onSave).toHaveBeenCalledTimes(1);
    });

});
