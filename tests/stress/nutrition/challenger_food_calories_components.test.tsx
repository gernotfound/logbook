import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FoodSchema } from '../../../src/lib/schema';
import CustomFoodForm from '../../../src/components/Nutrition/CustomFoodForm';
import { calculateCustomFoodKcal } from '../../../src/lib/nutrition/calculateCustomFoodKcal';
import { useAppStore } from '../../../src/store/useAppStore';

describe('Food calories UI stress', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

    describe('R2: Food Real-time Calories Calculation - Boundaries & UI Reactivity', () => {

        it('handles boundary zeroes, empty strings, commas, and decimals correctly', () => {
            expect(calculateCustomFoodKcal('', '', '')).toBe(0);
            expect(calculateCustomFoodKcal('   ', null, undefined)).toBe(0);
            expect(calculateCustomFoodKcal('12,5', '20,5', '5,5')).toBe(182); // 12.5*4 (50) + 20.5*4 (82) + 5.5*9 (49.5) = 181.5 -> 182
            expect(calculateCustomFoodKcal('0.1', '0.2', '0.3')).toBe(4); // 0.4 + 0.8 + 2.7 = 3.9 -> 4
        });

        it('handles non-numeric strings, negative numbers, and extreme macro values', () => {
            expect(calculateCustomFoodKcal('abc', 'def', 'ghi')).toBe(0);
            expect(calculateCustomFoodKcal(-10, -5, -2)).toBe(-78);
            expect(calculateCustomFoodKcal(5000, 2000, 1000)).toBe(37000); // 20000 + 8000 + 9000 = 37000
        });

        it('FoodSchema parses and sanitizes food items without NaN or schema failure', () => {
            const food = {
                name: 'Burro di arachidi',
                carbs: 20,
                pro: 25,
                fat: 50,
                kcal: 630,
                isCustom: true
            };
            const parsed = FoodSchema.parse(food);
            expect(parsed.kcal).toBe(630);
            expect(parsed.fat).toBe(50);
        });

        it('CustomFoodForm recomputes edited macros and invokes save only on click', () => {
            const mockSave = vi.fn().mockResolvedValue(undefined);
            const mockSetData = vi.fn();
            const initialData = { name: 'Pasta Integrale', carbs: 65, pro: 12, fat: 2, kcal: 326, unit: 'g' };

            render(
                <CustomFoodForm
                    cfData={initialData}
                    setCfData={mockSetData}
                    saveCustomFood={mockSave}
                    showCustomModal={true}
                    setShowCustomModal={vi.fn()}
                />
            );

            const carbsInput = screen.getByDisplayValue('65');
            fireEvent.change(carbsInput, { target: { value: '70' } });
            expect(mockSetData).toHaveBeenCalledWith(expect.objectContaining({ carbs: '70', kcal: 346 }));
            expect(mockSave).not.toHaveBeenCalled();
            fireEvent.click(screen.getByRole('button', { name: 'Salva alimento' }));
            expect(mockSave).toHaveBeenCalledTimes(1);
        });
    });
});
