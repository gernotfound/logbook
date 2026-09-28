import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { useTrainingExercises } from '../src/hooks/useTrainingExercises';
import { getInMemoryCatalog } from '../src/lib/catalog/catalogService';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import CustomFoodForm from '../src/components/Nutrition/CustomFoodForm';
import type { Exercise } from '../src/types';
import { deviceKey } from '../src/lib/sync/deviceStorage';

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
            window.localStorage.setItem(deviceKey('draft_exercise'), JSON.stringify(draft));

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
            expect(window.localStorage.getItem(deviceKey('draft_exercise'))).toBeNull();
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


        it('handleDuplicate creates a unique personal exercise through Domain Operations', async () => {
            const original: Exercise = {
                id: 'ex-original',
                name: 'Panca inclinata',
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isDefault: true
            };

            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library: [original]
                }
            });

            const { result } = renderHook(() => useTrainingExercises());

            await act(async () => {
                await result.current.handleDuplicate(original);
            });

            const updatedLib = useAppStore.getState().userData?.library || [];
            expect(updatedLib).toHaveLength(2);
            const duplicate = updatedLib.find(ex => ex.id !== original.id);
            expect(duplicate).toBeDefined();
            expect(duplicate?.name).not.toBe(original.name);
            expect(duplicate?.isDefault).toBe(false);
        });

        it('handleDelete blocks catalog exercises and deletes personal exercises after confirmation', async () => {
            const catalogExercise: Exercise = {
                id: 'ex-catalog',
                name: 'Catalogo',
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isDefault: true
            };
            const customExercise: Exercise = {
                id: 'ex-custom',
                name: 'Personale',
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isDefault: false
            };
            const showAlert = vi.fn().mockResolvedValue(undefined);
            const showConfirm = vi.fn().mockResolvedValue(true);
            useDialogStore.setState({ showAlert, showConfirm });
            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library: [catalogExercise, customExercise]
                }
            });

            const { result } = renderHook(() => useTrainingExercises());
            const stopPropagation = vi.fn();

            let catalogDeleted = true;
            await act(async () => {
                catalogDeleted = await result.current.handleDelete(catalogExercise.id, { stopPropagation });
            });
            expect(catalogDeleted).toBe(false);
            expect(showAlert).toHaveBeenCalledWith('Gli esercizi del catalogo non possono essere eliminati.');
            expect(useAppStore.getState().userData?.library).toHaveLength(2);

            let customDeleted = false;
            await act(async () => {
                customDeleted = await result.current.handleDelete(customExercise.id, { stopPropagation });
            });
            expect(customDeleted).toBe(true);
            expect(showConfirm).toHaveBeenCalled();
            expect(useAppStore.getState().userData?.library?.map(ex => ex.id)).toEqual([catalogExercise.id]);
        });

        it('handleRestoreExercise restores the bundled catalog version after confirmation', async () => {
            const original = getInMemoryCatalog(true).exercises[0];
            expect(original).toBeDefined();

            const modified: Exercise = {
                ...(original as any),
                name: `${original.name} modificato`,
                notes: 'Override locale',
                setsCount: 3,
                sets: [],
                isDefault: true
            };
            const showConfirm = vi.fn().mockResolvedValue(true);
            useDialogStore.setState({
                showConfirm,
                showAlert: vi.fn().mockResolvedValue(undefined)
            });
            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library: [modified]
                }
            });

            const { result } = renderHook(() => useTrainingExercises());

            await act(async () => {
                await result.current.handleRestoreExercise(String(original.id));
            });

            const restored = useAppStore.getState().userData?.library?.find(ex => String(ex.id) === String(original.id));
            expect(showConfirm).toHaveBeenCalledWith(
                'Vuoi ripristinare questo esercizio ai valori originali? Le tue modifiche andranno perse.'
            );
            expect(restored?.name).toBe(original.name);
            expect(restored?.notes).toBe(original.notes);
            expect(restored?.trackingType).toBe(original.trackingType);
            expect(restored?.muscles).toEqual(original.muscles);
            expect(restored?.secondaryMuscles).toEqual(original.secondaryMuscles);
            expect(restored?.sets).toEqual([]);
        });
    });

    /* =========================================================================
     * 2. TrainingExercises Component UI Tests
     * ========================================================================= */
    describe('TrainingExercises Component UI', () => {
        it('renders isBodyweight checkbox and equipmentWeight input when trackingType is weight_reps', () => {
            renderWithProviders(<TrainingExercises />, { userData: emptyUserData });

            const createBtn = screen.getByRole('button', { name: /Crea esercizio/i });
            fireEvent.click(createBtn);

            const bwCheckbox = screen.getByLabelText(/Esercizio a corpo libero/i) as HTMLInputElement;
            expect(bwCheckbox).toBeDefined();
            expect(bwCheckbox.type).toBe('checkbox');
            expect(bwCheckbox.checked).toBe(false);

            const eqInput = screen.getByPlaceholderText('0') as HTMLInputElement;
            expect(eqInput).toBeDefined();
            expect(eqInput.type).toBe('number');
        });

        it('renders the compact proposal-5 exercise list without legacy badges', () => {
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

            expect(screen.getByRole('heading', { name: 'La tua libreria' })).toBeDefined();
            expect(screen.getByRole('button', { name: 'Apri dettaglio di Trazioni alla sbarra' })).toBeDefined();
            expect(screen.queryByText('Corpo libero')).toBeNull();
            expect(screen.queryByText('Attrezzo: 20 kg')).toBeNull();
        });

        it('opens the dedicated detail page with real exercise metadata', () => {
            const initialLibrary: Exercise[] = [
                {
                    id: 'ex-dips',
                    name: 'Dip alle parallele zavorrate',
                    setsCount: 3,
                    sets: [],
                    trackingType: 'weight_reps',
                    muscles: ['chest'],
                    secondaryMuscles: ['triceps'],
                    notes: 'Scapole stabili',
                    isDefault: false,
                    isBodyweight: true,
                    equipmentWeight: 5
                }
            ];

            const { container } = renderWithProviders(<TrainingExercises />, {
                userData: {
                    ...emptyUserData,
                    library: initialLibrary
                }
            });

            fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Dip alle parallele zavorrate' }));

            expect(screen.getByRole('region', { name: 'Dettaglio esercizio' })).toBeDefined();
            expect(screen.getByText('Peso e ripetizioni')).toBeDefined();
            expect(screen.getByText('Personale')).toBeDefined();
            expect(screen.getByText('Scapole stabili')).toBeDefined();
            expect(screen.getByRole('button', { name: 'Torna all’elenco' })).toBeDefined();
            expect(container.querySelector('.muscle-map-container')).not.toBeNull();
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
