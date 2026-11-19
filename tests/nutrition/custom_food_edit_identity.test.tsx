import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import NutritionMeals from '../../src/components/Nutrition/NutritionMeals';
import { useNutritionMeals } from '../../src/hooks/useNutritionMeals';
import { emptyUserData, renderWithProviders } from '../setup';

describe('custom food editing identity', () => {
    it('recognizes numeric ID zero as an existing food and displays the edit form', () => {
        const food = {
            id: 0, name: 'Riso', unit: 'g', baseQty: 100,
            kcal: 350, carbs: 78, pro: 7, fat: 1,
        };
        function Harness() {
            const meals = useNutritionMeals('2026-10-20');
            return (
                <>
                    <button type="button" onClick={() => meals.startEditCustomFood(food)}>Apri alimento zero</button>
                    <NutritionMeals mealsHook={meals} selectedDate="2026-10-20" />
                </>
            );
        }
        renderWithProviders(<Harness />, {
            userData: { ...emptyUserData, nutrition: {}, customFoods: [food] },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Apri alimento zero' }));
        expect(screen.getByRole('heading', { name: 'Modifica alimento' })).toBeDefined();
        expect((screen.getByLabelText('Nome alimento *') as HTMLInputElement).value).toBe('Riso');
        expect(screen.getByRole('button', { name: 'Chiudi' })).toBeDefined();
    });
});
