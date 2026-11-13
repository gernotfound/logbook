import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../../src/store/useAppStore';
import { captureSession } from '../../src/lib/sync/session';
import { FoodSchema } from '../../src/lib/schema';
import CustomFoodForm from '../../src/components/Nutrition/CustomFoodForm';
import { calculateRealtimeKcalContract } from '../domainCalculationContracts';

describe('Food real-time calories', () => {
    describe('Feature coverage', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R2: Food Real-time Calories Calculation', () => {

            it('T1.2.2: calculates pure protein source (0g C, 25g P, 0g F) to 100 kcal', () => {
                const kcal = calculateRealtimeKcalContract(0, 25, 0);
                expect(kcal).toBe(100);
            });

            it('T1.2.3: calculates pure fat source (0g C, 0g P, 14g F) to 126 kcal', () => {
                const kcal = calculateRealtimeKcalContract(0, 0, 14);
                expect(kcal).toBe(126);
            });

            it('T1.2.4: calculates pure carbohydrate source (50g C, 0g P, 0g F) to 200 kcal', () => {
                const kcal = calculateRealtimeKcalContract(50, 0, 0);
                expect(kcal).toBe(200);
            });

            it('T1.2.5: calculates mixed macros with decimals and rounds to nearest integer', () => {
                // 33.5 * 4 = 134, 18.2 * 4 = 72.8, 7.8 * 9 = 70.2 -> 134 + 72.8 + 70.2 = 277.0
                const kcal = calculateRealtimeKcalContract(33.5, 18.2, 7.8);
                expect(kcal).toBe(277);
            });

            it('T1.2.6: CustomFoodForm renders input fields for macros and kcal', () => {
                const mockSetCfData = vi.fn();
                const mockSave = vi.fn().mockResolvedValue(undefined);
                const cfData = { name: 'Riso basmati', carbs: 78, pro: 8.5, fat: 0.9, kcal: 354, unit: 'g' };

                render(
                    <CustomFoodForm 
                        cfData={cfData}
                        setCfData={mockSetCfData}
                        saveCustomFood={mockSave}
                        showCustomModal={true}
                        setShowCustomModal={vi.fn()}
                    />
                );

                expect(screen.getByPlaceholderText('es. Petto di pollo, Fiocchi di latte...')).toBeDefined();
                expect(screen.getByDisplayValue('78')).toBeDefined();
                expect(screen.getByDisplayValue('8.5')).toBeDefined();
                expect(screen.getByDisplayValue('0.9')).toBeDefined();
            });

            it('recalculates edited macros and saves only after the user submits', () => {
                const saveCustomFood = vi.fn().mockResolvedValue(undefined);
                const setCfData = vi.fn();
                render(
                    <CustomFoodForm
                        cfData={{ name: 'Pasta Integrale', carbs: 65, pro: 12, fat: 2, kcal: 326, unit: 'g' }}
                        setCfData={setCfData}
                        saveCustomFood={saveCustomFood}
                        showCustomModal={true}
                        setShowCustomModal={vi.fn()}
                    />
                );
                fireEvent.change(screen.getByDisplayValue('65'), { target: { value: '70' } });
                expect(setCfData).toHaveBeenCalledWith(expect.objectContaining({ carbs: '70', kcal: 346 }));
                expect(saveCustomFood).not.toHaveBeenCalled();
                fireEvent.click(screen.getByRole('button', { name: 'Salva alimento' }));
                expect(saveCustomFood).toHaveBeenCalledTimes(1);
            });
            it('T1.2.7: FoodSchema sanitizes and validates food macros and calorie numbers', () => {
                const food = {
                    name: 'Avena integrale',
                    carbs: 66,
                    pro: 14,
                    fat: 7,
                    kcal: 383,
                    isCustom: true
                };
                const parsed = FoodSchema.parse(food);
                expect(parsed.kcal).toBe(383);
                expect(parsed.carbs).toBe(66);
                expect(parsed.pro).toBe(14);
                expect(parsed.fat).toBe(7);
                const denseFood = FoodSchema.parse({
                    name: 'Burro di arachidi', carbs: 20, pro: 25,
                    fat: 50, kcal: 630, isCustom: true,
                });
                expect(denseFood.kcal).toBe(630);
                expect(denseFood.fat).toBe(50);
            });
        });
    });

    describe('Boundaries and corner cases', () => {
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

        describe('R2: Boundary & Corner Cases', () => {
            it('T2.2.1: empty string inputs evaluate safely to 0 kcal without NaN', () => {
                const kcal = calculateRealtimeKcalContract('', '', '');
                expect(kcal).toBe(0);
                expect(isNaN(kcal)).toBe(false);
            });

            it('T2.2.2: null and undefined inputs evaluate safely to 0 kcal', () => {
                const kcal = calculateRealtimeKcalContract(null, undefined, null);
                expect(kcal).toBe(0);
            });

            it('T2.2.3: extreme high macro values calculate correctly without overflow', () => {
                const kcal = calculateRealtimeKcalContract(500, 300, 200);
                // 500*4 + 300*4 + 200*9 = 2000 + 1200 + 1800 = 5000
                expect(kcal).toBe(5000);
            });

            it('T2.2.4: non-numeric string values (e.g. "abc") default safely to 0 kcal', () => {
                const kcal = calculateRealtimeKcalContract('abc', 'xyz', '---');
                expect(kcal).toBe(0);
            });

            it('T2.2.5: decimal inputs with comma notation calculate accurately', () => {
                const kcal = calculateRealtimeKcalContract('10,5', '20,0', '5,5');
                // 10.5*4 + 20*4 + 5.5*9 = 42 + 80 + 49.5 = 171.5 -> 172
                expect(kcal).toBe(172);
            });

            it('T2.2.6: negative macro values clamp or evaluate mathematically without crash', () => {
                const kcal = calculateRealtimeKcalContract(-10, 20, 5);
                expect(kcal).toBe(85); // -10*4 + 20*4 + 5*9
            });

            it('preserves whitespace, comma-decimal input and small fractional rounding', () => {
                expect(calculateRealtimeKcalContract('   ', null, undefined)).toBe(0);
                expect(calculateRealtimeKcalContract('12,5', '20,5', '5,5')).toBe(182);
                expect(calculateRealtimeKcalContract('0.1', '0.2', '0.3')).toBe(4);
            });

            it('preserves signed and high-but-finite macronutrient calculations', () => {
                expect(calculateRealtimeKcalContract(-10, -5, -2)).toBe(-78);
                expect(calculateRealtimeKcalContract(5000, 2000, 1000)).toBe(37000);
            });
            it('T2.2.7: fractional rounding boundary (e.g. 0.125g macros)', () => {
                const kcal = calculateRealtimeKcalContract(0.125, 0.125, 0.125);
                // 0.5 + 0.5 + 1.125 = 2.125 -> 2
                expect(kcal).toBe(2);
            });
        });
    });
});
