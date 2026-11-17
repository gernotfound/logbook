import React, { useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../../src/store/useAppStore';
import CustomFoodForm from '../../src/components/Nutrition/CustomFoodForm';

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

    describe('CustomFoodForm Real-Time Automatic Calorie Calculation (R2)', () => {
        // Test wrapper component mimicking real consumer behavior
        function FoodFormWrapper({ initial = {} }: { initial?: any }) {
            const [cfData, setCfData] = useState<any>({
                name: 'Test Alimento',
                brand: '',
                unit: 'g',
                kcal: '',
                carbs: '',
                pro: '',
                fat: '',
                ...initial
            });
            const [showModal, setShowModal] = useState(true);

            return (
                <CustomFoodForm 
                    cfData={cfData}
                    setCfData={setCfData}
                    saveCustomFood={vi.fn()}
                    showCustomModal={showModal}
                    setShowCustomModal={setShowModal}
                />
            );
        }

        it('R2 Acceptance Criterion: typing 10g Carbo, 10g Pro, 10g Grassi automatically sets kcal to 170', () => {
            render(<FoodFormWrapper />);

            const carbsInput = screen.getByLabelText(/Carbo \(g\)/i) as HTMLInputElement;
            const proInput = screen.getByLabelText(/Pro \(g\)/i) as HTMLInputElement;
            const fatInput = screen.getByLabelText(/Grassi \(g\)/i) as HTMLInputElement;
            const kcalInput = screen.getByLabelText(/Kcal/i) as HTMLInputElement;

            fireEvent.change(carbsInput, { target: { value: '10' } });
            expect(kcalInput.value).toBe('40'); // 10 * 4

            fireEvent.change(proInput, { target: { value: '10' } });
            expect(kcalInput.value).toBe('80'); // 10 * 4 + 10 * 4

            fireEvent.change(fatInput, { target: { value: '10' } });
            expect(kcalInput.value).toBe('170'); // 10 * 4 + 10 * 4 + 10 * 9 = 170

            // After auto-calculation, a label value can still be entered manually.
            fireEvent.change(kcalInput, { target: { value: '165' } });
            expect(kcalInput.value).toBe('165');
        });

        it('correctly calculates mixed decimals and rounds to nearest whole integer', () => {
            render(<FoodFormWrapper />);

            const carbsInput = screen.getByLabelText(/Carbo \(g\)/i);
            const proInput = screen.getByLabelText(/Pro \(g\)/i);
            const fatInput = screen.getByLabelText(/Grassi \(g\)/i);
            const kcalInput = screen.getByLabelText(/Kcal/i) as HTMLInputElement;

            // 33.5g C * 4 = 134, 18.2g P * 4 = 72.8, 7.8g F * 9 = 70.2 -> 134 + 72.8 + 70.2 = 277
            fireEvent.change(carbsInput, { target: { value: '33.5' } });
            fireEvent.change(proInput, { target: { value: '18.2' } });
            fireEvent.change(fatInput, { target: { value: '7.8' } });

            expect(kcalInput.value).toBe('277');
        });




    });
