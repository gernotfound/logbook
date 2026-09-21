import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NutritionMeals from '../src/components/Nutrition/NutritionMeals';
import { renderWithProviders } from './setup';

describe('NutritionMeals decomposition parity', () => {
    it('preserves date navigation, search add, meal editing, and removal callbacks', () => {
        const setSelectedDate = vi.fn();
        const handleSearch = vi.fn();
        const addFood = vi.fn();
        const removeFood = vi.fn();
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
            updateMealItem: vi.fn(),
            targetDateStr: '2026-08-16',
        };

        renderWithProviders(
            <NutritionMeals mealsHook={mockHook} selectedDate="2026-08-16" setSelectedDate={setSelectedDate} />
        );

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
});
