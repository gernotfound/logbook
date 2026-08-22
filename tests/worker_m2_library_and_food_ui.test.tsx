import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { useTrainingExercises } from '../src/hooks/useTrainingExercises';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import CustomFoodForm from '../src/components/Nutrition/CustomFoodForm';
import type { Exercise } from '../src/types';

describe('Worker M2: Exercise Library UI & Food Form Real-Time Calorie Calculation', () => {

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

    /* =========================================================================
     * 1. useTrainingExercises Hook Tests
     * ========================================================================= */
    describe('useTrainingExercises Hook', () => {
        it('initializes with isBodyweight=false and equipmentWeight=""', () => {
            const { result } = renderHook(() => useTrainingExercises());
            expect(result.current.isBodyweight).toBe(false);
            expect(result.current.equipmentWeight).toBe('');
        });

        it('restores isBodyweight and equipmentWeight from localStorage draft', () => {
            const draft = {
                name: 'Trazioni zavorrate',
                notes: 'Cintura da sovraccarico',
                trackingType: 'weight_reps',
                selectedMuscles: [{ id: 'back_latissimus' }],
                secondaryMuscles: [{ id: 'arms_biceps' }],
                isBodyweight: true,
                equipmentWeight: 5
            };
            window.localStorage.setItem('draft_exercise', JSON.stringify(draft));

            const { result } = renderHook(() => useTrainingExercises());
            expect(result.current.exName).toBe('Trazioni zavorrate');
            expect(result.current.isBodyweight).toBe(true);
            expect(result.current.equipmentWeight).toBe('5');
        });

        it('handleEditClick populates isBodyweight and equipmentWeight from exercise object', () => {
            const exercise: Exercise = {
                id: 'ex-bench-barbell',
                name: 'Panca piana con bilanciere',
                setsCount: 4,
                sets: [],
                trackingType: 'weight_reps',
                isBodyweight: false,
                equipmentWeight: 20
            };

            const { result } = renderHook(() => useTrainingExercises());

            act(() => {
                result.current.handleEditClick(exercise);
            });

            expect(result.current.editingExId).toBe('ex-bench-barbell');
            expect(result.current.exName).toBe('Panca piana con bilanciere');
            expect(result.current.isBodyweight).toBe(false);
            expect(result.current.equipmentWeight).toBe('20');
        });

        it('handleCancelEdit resets isBodyweight and equipmentWeight and clears draft', () => {
            const exercise: Exercise = {
                id: 'ex-dips',
                name: 'Dip parallele',
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isBodyweight: true,
                equipmentWeight: 2.5
            };

            const { result } = renderHook(() => useTrainingExercises());

            act(() => {
                result.current.handleEditClick(exercise);
            });
            expect(result.current.isBodyweight).toBe(true);
            expect(result.current.equipmentWeight).toBe('2.5');

            act(() => {
                result.current.handleCancelEdit();
            });
            expect(result.current.editingExId).toBeNull();
            expect(result.current.isBodyweight).toBe(false);
            expect(result.current.equipmentWeight).toBe('');
            expect(window.localStorage.getItem('draft_exercise')).toBeNull();
        });

        it('handleSaveExercise creates new exercise with isBodyweight and equipmentWeight', async () => {
            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library: []
                }
            });

            const { result } = renderHook(() => useTrainingExercises());

            act(() => {
                result.current.setExName('Pull-up corpo libero');
                result.current.setIsBodyweight(true);
                result.current.setEquipmentWeight('2,5');
            });

            await act(async () => {
                await result.current.handleSaveExercise();
            });

            const updatedLib = useAppStore.getState().userData?.library || [];
            expect(updatedLib.length).toBe(1);
            expect(updatedLib[0].name).toBe('Pull-up corpo libero');
            expect(updatedLib[0].isBodyweight).toBe(true);
            expect(updatedLib[0].equipmentWeight).toBe(2.5);
        });

        it('handleSaveExercise updates existing exercise and preserves isBodyweight & equipmentWeight', async () => {
            const existingEx: Exercise = {
                id: 'ex-squat',
                name: 'Squat',
                setsCount: 4,
                sets: [],
                trackingType: 'weight_reps'
            };

            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library: [existingEx]
                }
            });

            const { result } = renderHook(() => useTrainingExercises());

            act(() => {
                result.current.handleEditClick(existingEx);
            });

            act(() => {
                result.current.setIsBodyweight(false);
                result.current.setEquipmentWeight('20');
            });

            await act(async () => {
                await result.current.handleSaveExercise();
            });

            const updatedLib = useAppStore.getState().userData?.library || [];
            expect(updatedLib.length).toBe(1);
            expect(updatedLib[0].id).toBe('ex-squat');
            expect(updatedLib[0].equipmentWeight).toBe(20);
        });
    });

    /* =========================================================================
     * 2. TrainingExercises Component UI Tests
     * ========================================================================= */
    describe('TrainingExercises Component UI', () => {
        it('renders isBodyweight checkbox and equipmentWeight input when trackingType is weight_reps', () => {
            renderWithProviders(<TrainingExercises />, { userData: emptyUserData });

            const bwCheckbox = screen.getByLabelText(/Esercizio a corpo libero/i) as HTMLInputElement;
            expect(bwCheckbox).toBeDefined();
            expect(bwCheckbox.type).toBe('checkbox');
            expect(bwCheckbox.checked).toBe(false);

            const eqInput = screen.getByPlaceholderText('0') as HTMLInputElement;
            expect(eqInput).toBeDefined();
            expect(eqInput.type).toBe('number');
        });

        it('displays badges in the exercise list for isBodyweight and equipmentWeight', () => {
            const initialLibrary: Exercise[] = [
                {
                    id: 'ex-1',
                    name: 'Trazioni alla sbarra',
                    setsCount: 4,
                    sets: [],
                    trackingType: 'weight_reps',
                    isBodyweight: true
                },
                {
                    id: 'ex-2',
                    name: 'Panca piana bilanciere',
                    setsCount: 4,
                    sets: [],
                    trackingType: 'weight_reps',
                    equipmentWeight: 20
                }
            ];

            renderWithProviders(<TrainingExercises />, {
                userData: {
                    ...emptyUserData,
                    library: initialLibrary
                }
            });

            expect(screen.getByText('Corpo libero')).toBeDefined();
            expect(screen.getByText('Attrezzo: 20 kg')).toBeDefined();
        });

        it('shows expanded exercise details for bodyweight and equipment weight', () => {
            const initialLibrary: Exercise[] = [
                {
                    id: 'ex-dips',
                    name: 'Dip alle parallele zavorrate',
                    setsCount: 3,
                    sets: [],
                    trackingType: 'weight_reps',
                    isBodyweight: true,
                    equipmentWeight: 5
                }
            ];

            renderWithProviders(<TrainingExercises />, {
                userData: {
                    ...emptyUserData,
                    library: initialLibrary
                }
            });

            const exerciseItem = screen.getByText('Dip alle parallele zavorrate');
            fireEvent.click(exerciseItem);

            expect(screen.getByText(/Sì \(peso corporeo incluso nel volume\)/i)).toBeDefined();
            expect(screen.getByText('5 kg')).toBeDefined();
        });
    });

    /* =========================================================================
     * 3. CustomFoodForm Real-Time Calorie Calculation Tests (Requirement R2)
     * ========================================================================= */
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

        it('supports decimal inputs (e.g. "10.5")', () => {
            render(<FoodFormWrapper />);

            const carbsInput = screen.getByLabelText(/Carbo \(g\)/i);
            const proInput = screen.getByLabelText(/Pro \(g\)/i);
            const fatInput = screen.getByLabelText(/Grassi \(g\)/i);
            const kcalInput = screen.getByLabelText(/Kcal/i) as HTMLInputElement;

            // 10.5g C * 4 = 42, 5.5g P * 4 = 22, 2.0g F * 9 = 18 -> 42 + 22 + 18 = 82
            fireEvent.change(carbsInput, { target: { value: '10.5' } });
            fireEvent.change(proInput, { target: { value: '5.5' } });
            fireEvent.change(fatInput, { target: { value: '2.0' } });

            expect(kcalInput.value).toBe('82');
        });

        it('allows user to manually override kcal directly after macro entry', () => {
            render(<FoodFormWrapper />);

            const carbsInput = screen.getByLabelText(/Carbo \(g\)/i);
            const proInput = screen.getByLabelText(/Pro \(g\)/i);
            const fatInput = screen.getByLabelText(/Grassi \(g\)/i);
            const kcalInput = screen.getByLabelText(/Kcal/i) as HTMLInputElement;

            fireEvent.change(carbsInput, { target: { value: '10' } });
            fireEvent.change(proInput, { target: { value: '10' } });
            fireEvent.change(fatInput, { target: { value: '10' } });
            expect(kcalInput.value).toBe('170');

            // Manual adjustment (e.g. net carbs adjustment or official label discrepancy)
            fireEvent.change(kcalInput, { target: { value: '165' } });
            expect(kcalInput.value).toBe('165');
        });

        it('clears kcal when all macro inputs are emptied', () => {
            render(<FoodFormWrapper />);

            const carbsInput = screen.getByLabelText(/Carbo \(g\)/i);
            const kcalInput = screen.getByLabelText(/Kcal/i) as HTMLInputElement;

            fireEvent.change(carbsInput, { target: { value: '20' } });
            expect(kcalInput.value).toBe('80');

            fireEvent.change(carbsInput, { target: { value: '' } });
            expect(kcalInput.value).toBe('');
        });
    });
});
