import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NutritionMeals from '../../src/components/Nutrition/NutritionMeals';
import { NutritionMealSection } from '../../src/components/Nutrition/meals/NutritionMealSection';
import type { LoggedMealItem } from '../../src/types';
import { renderWithProviders } from '../setup';

describe('Nutrition meal editor identity and pending mutations', () => {
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

    it('retains the portion draft when an optimistic category move is rolled back', async () => {
        const original: LoggedMealItem = {
            id: 'moving-meal', name: 'Latte', meal: 'Colazione',
            quantity: 100, baseQty: 100, kcal: 80, pro: 4, carbs: 4, fat: 5,
        };
        let settle!: (saved: boolean) => void;
        const saveSpy = vi.fn();
        function Harness() {
            const [meals, setMeals] = useState<LoggedMealItem[]>([original]);
            const onSave = (changes: Pick<LoggedMealItem, 'id' | 'quantity' | 'meal'>) => {
                saveSpy(changes);
                setMeals([{ ...original, ...changes }]);
                return new Promise<boolean>(resolve => {
                    settle = saved => {
                        if (!saved) setMeals([original]);
                        resolve(saved);
                    };
                });
            };
            const hook: any = {
                targetDateStr: '2026-09-14',
                todayNutrition: { date: '2026-09-14', kcal: 80, pro: 4, carbs: 4, fat: 5, meals },
                dailyTarget: { kcal: 2200, pro: 100, carbs: 200, fat: 50 },
                isDayOn: undefined, setDayType: vi.fn(), searchQuery: '', handleSearch: vi.fn(),
                searchResults: [], clearSearch: vi.fn(), showCustomModal: false,
                setShowCustomModal: vi.fn(), editingFoodId: null, cancelCustomFood: vi.fn(),
                cfData: {}, setCfData: vi.fn(), saveCustomFood: vi.fn(),
                meals, addFood: vi.fn(), removeFood: vi.fn().mockResolvedValue(true),
                updateMealItem: onSave,
            };
            return <NutritionMeals mealsHook={hook} selectedDate="2026-09-14" />;
        }
        renderWithProviders(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Modifica porzione di Latte' }));
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '70' } });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Pranzo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        expect(saveSpy).toHaveBeenCalledWith({ id: 'moving-meal', quantity: 70, meal: 'Pranzo' });
        expect(screen.getByRole('heading', { name: 'Modifica porzione' })).toBeDefined();
        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('70');
        expect(screen.queryByRole('button', { name: 'Modifica porzione di Latte' })).toBeNull();
        await act(async () => settle(false));
        expect(screen.getByRole('heading', { name: 'Modifica porzione' })).toBeDefined();
        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('70');
    });

});
