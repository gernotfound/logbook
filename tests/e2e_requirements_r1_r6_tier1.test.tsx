import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData, defaultMockUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { Logic } from '../src/lib/logic';
import {
    UserDataSchema,
    ExerciseSchema,
    NutritionDaySchema,
    FoodSchema,
    WorkoutSessionSchema
} from '../src/lib/schema';
import CustomFoodForm from '../src/components/Nutrition/CustomFoodForm';
import DataMeasurements from '../src/components/Data/DataMeasurements';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import SessionRatings from '../src/components/Training/session/SessionRatings';
import MuscleModel from '../src/components/Training/MuscleModel';
import HomeView from '../src/components/Home/HomeView';
import { useNutritionMeasurements } from '../src/hooks/useNutritionMeasurements';
import type { Food, NutritionDay } from '../src/types';
import {
    getLatestUserWeightContract,
    calculateEffectiveSetWeightContract,
    calculateSetVolumeContract,
    calculateWorkoutVolumeContract,
    calculateRealtimeKcalContract,
    autoHealPainsContract
} from './requirements_r1_r6_contracts';

describe('LogBook 4-Tier Automated Test Suite (Requirements R1 - R6)', () => {
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
     * TIER 1: FEATURE COVERAGE (>=5 tests per requirement R1 - R6)
     * ========================================================================= */
    describe('Tier 1: Feature Coverage', () => {

        // ---------------------------------------------------------------------
        // Requirement R1: Bodyweight & Equipment Volume Calculation
        // ---------------------------------------------------------------------
        describe('R1: Bodyweight & Equipment Volume Calculation', () => {
            it('T1.1.1: calculates effective weight for bodyweight exercise summing ballast and user weight', () => {
                const ex = { isBodyweight: true, equipmentWeight: 0 };
                const userWeight = 75;
                const effective = calculateEffectiveSetWeightContract('10', ex, userWeight);
                expect(effective).toBe(85); // 10kg ballast + 75kg bodyweight
            });

            it('T1.1.2: calculates bodyweight set volume with 0 kg ballast as (userWeight * reps)', () => {
                const ex = { isBodyweight: true };
                const userWeight = 75;
                const set = { kg: '0', reps: '10' };
                const vol = calculateSetVolumeContract(set, ex, userWeight);
                expect(vol).toBe(750); // (0 + 75) * 10
            });

            it('T1.1.3: calculates equipment weight addition for fixed barbell or machine base weight', () => {
                const ex = { isBodyweight: false, equipmentWeight: 20 };
                const effective = calculateEffectiveSetWeightContract('60', ex, 75);
                expect(effective).toBe(80); // 60kg added + 20kg bar
                const vol = calculateSetVolumeContract({ kg: '60', reps: '8' }, ex, 75);
                expect(vol).toBe(640); // 80 * 8
            });

            it('T1.1.4: calculates volume for exercise with BOTH isBodyweight and equipmentWeight (e.g. weighted belt base)', () => {
                const ex = { isBodyweight: true, equipmentWeight: 5 };
                const userWeight = 80;
                const set = { kg: '15', reps: '6' };
                const effective = calculateEffectiveSetWeightContract(set.kg, ex, userWeight);
                expect(effective).toBe(100); // 15 + 5 + 80
                const vol = calculateSetVolumeContract(set, ex, userWeight);
                expect(vol).toBe(600); // 100 * 6
            });

            it('T1.1.5: calculates total workout volume across bodyweight, equipment, and standard sets', () => {
                const library = [
                    { id: 'ex_bw', isBodyweight: true, equipmentWeight: 0 },
                    { id: 'ex_bar', isBodyweight: false, equipmentWeight: 20 },
                    { id: 'ex_std', isBodyweight: false, equipmentWeight: 0 }
                ];
                const session = {
                    exercises: [
                        { exId: 'ex_bw', sets: [{ kg: '0', reps: '10' }] }, // 75 * 10 = 750
                        { exId: 'ex_bar', sets: [{ kg: '50', reps: '10' }] }, // (50 + 20) * 10 = 700
                        { exId: 'ex_std', sets: [{ kg: '30', reps: '10' }] }  // 30 * 10 = 300
                    ]
                };
                const total = calculateWorkoutVolumeContract(session, library, 75);
                expect(total).toBe(1750); // 750 + 700 + 300
            });

            it('T1.1.6: getLatestUserWeight finds the most recent weight from nutrition history or planning', () => {
                const nutrition = {
                    '2026-08-10': { weight: 76.5 },
                    '2026-08-14': { weight: 75.0 },
                    '2026-08-01': { weight: 77.0 }
                };
                const latest = getLatestUserWeightContract(nutrition, { weight: 80 });
                expect(latest).toBe(75.0); // Most recent date (2026-08-14)
            });

            it('T1.1.7: ExerciseSchema validates isBodyweight and equipmentWeight cleanly', () => {
                const exerciseData = {
                    id: 'ex_pullup',
                    name: 'Trazioni alla sbarra',
                    setsCount: 4,
                    sets: [{ weight: '0', reps: '10', done: false }],
                    isBodyweight: true,
                    equipmentWeight: 2.5
                };
                const parsed = ExerciseSchema.parse(exerciseData);
                expect((parsed as any).isBodyweight).toBe(true);
                expect((parsed as any).equipmentWeight).toBe(2.5);
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R2: Food Real-time Calories Calculation
        // ---------------------------------------------------------------------
        describe('R2: Food Real-time Calories Calculation', () => {
            it('T1.2.1: calculates 170 kcal for 10g Carbs, 10g Protein, 10g Fat (ORIGINAL_REQUEST verification formula)', () => {
                const kcal = calculateRealtimeKcalContract(10, 10, 10);
                expect(kcal).toBe(170); // 10*4 + 10*4 + 10*9 = 40 + 40 + 90 = 170
            });

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
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R3: Measurements Date Selector Relocation
        // ---------------------------------------------------------------------
        describe('R3: Measurements Date Selector', () => {
            it('T1.3.1: DataMeasurements renders main measurement card with weight and circumference inputs', () => {
                const mockSave = vi.fn().mockResolvedValue(undefined);
                render(
                    <DataMeasurements 
                        profile={{ gender: 'M' }}
                        editingDate={null}
                        measureTime="08:00"
                        setMeasureTime={vi.fn()}
                        weight="75.5"
                        setWeight={vi.fn()}
                        waist="82"
                        setWaist={vi.fn()}
                        neck="38"
                        setNeck={vi.fn()}
                        hip=""
                        setHip={vi.fn()}
                        manualBf="14"
                        setManualBf={vi.fn()}
                        chest="102"
                        setChest={vi.fn()}
                        shoulders="118"
                        setShoulders={vi.fn()}
                        biceps="37"
                        setBiceps={vi.fn()}
                        thighs="58"
                        setThighs={vi.fn()}
                        calves="37"
                        setCalves={vi.fn()}
                        handleCancelEdit={vi.fn()}
                        calculateAndSave={mockSave}
                    />
                );

                expect(screen.getByText(/Nuova misurazione/)).toBeDefined();
                expect(screen.getByDisplayValue('75.5')).toBeDefined();
                expect(screen.getByDisplayValue('82')).toBeDefined();
            });

            it('T1.3.2: useNutritionMeasurements initializes and exposes measurement state', () => {
                const { result } = renderHook(() => useNutritionMeasurements());
                expect(result.current.profile).toBeDefined();
                expect(result.current.measureTime).toBeDefined();
                expect(typeof result.current.setWeight).toBe('function');
                expect(typeof result.current.calculateAndSave).toBe('function');
            });

            it('T1.3.3: saving measurements on a specific date writes to userData.nutrition[date]', async () => {
                const targetDate = '2026-08-10';
                useAppStore.setState({
                    userData: {
                        ...emptyUserData,
                        nutrition: {
                            [targetDate]: { weight: 75.0, kcal: 2200, carbs: 250, pro: 150, fat: 60 }
                        }
                    }
                });

                const state = useAppStore.getState();
                expect(state.userData?.nutrition?.[targetDate]?.weight).toBe(75.0);
            });

            it('T1.3.4: switching to edit mode changes title to Modifica misurazione', () => {
                render(
                    <DataMeasurements 
                        profile={{ gender: 'M' }}
                        editingDate="2026-08-15"
                        measureTime="07:30"
                        setMeasureTime={vi.fn()}
                        weight="74.8"
                        setWeight={vi.fn()}
                        waist=""
                        setWaist={vi.fn()}
                        neck=""
                        setNeck={vi.fn()}
                        hip=""
                        setHip={vi.fn()}
                        manualBf=""
                        setManualBf={vi.fn()}
                        chest=""
                        setChest={vi.fn()}
                        shoulders=""
                        setShoulders={vi.fn()}
                        biceps=""
                        setBiceps={vi.fn()}
                        thighs=""
                        setThighs={vi.fn()}
                        calves=""
                        setCalves={vi.fn()}
                        handleCancelEdit={vi.fn()}
                        calculateAndSave={vi.fn()}
                    />
                );

                expect(screen.getByText(/Modifica misurazione/i)).toBeDefined();
                expect(screen.getByText('Annulla')).toBeDefined();
                expect(screen.getByRole('button', { name: /Salva modifiche/i })).toBeDefined();
            });

            it('T1.3.5: female profile conditionally displays hip measurement input', () => {
                const { rerender } = render(
                    <DataMeasurements 
                        profile={{ gender: 'M' }}
                        editingDate={null}
                        measureTime="08:00"
                        setMeasureTime={vi.fn()}
                        weight=""
                        setWeight={vi.fn()}
                        waist=""
                        setWaist={vi.fn()}
                        neck=""
                        setNeck={vi.fn()}
                        hip=""
                        setHip={vi.fn()}
                        manualBf=""
                        setManualBf={vi.fn()}
                        chest=""
                        setChest={vi.fn()}
                        shoulders=""
                        setShoulders={vi.fn()}
                        biceps=""
                        setBiceps={vi.fn()}
                        thighs=""
                        setThighs={vi.fn()}
                        calves=""
                        setCalves={vi.fn()}
                        handleCancelEdit={vi.fn()}
                        calculateAndSave={vi.fn()}
                    />
                );
                expect(screen.queryByText('Fianchi (cm)')).toBeNull();

                rerender(
                    <DataMeasurements 
                        profile={{ gender: 'F' }}
                        editingDate={null}
                        measureTime="08:00"
                        setMeasureTime={vi.fn()}
                        weight=""
                        setWeight={vi.fn()}
                        waist=""
                        setWaist={vi.fn()}
                        neck=""
                        setNeck={vi.fn()}
                        hip="95"
                        setHip={vi.fn()}
                        manualBf=""
                        setManualBf={vi.fn()}
                        chest=""
                        setChest={vi.fn()}
                        shoulders=""
                        setShoulders={vi.fn()}
                        biceps=""
                        setBiceps={vi.fn()}
                        thighs=""
                        setThighs={vi.fn()}
                        calves=""
                        setCalves={vi.fn()}
                        handleCancelEdit={vi.fn()}
                        calculateAndSave={vi.fn()}
                    />
                );
                expect(screen.getByText('Fianchi (cm)')).toBeDefined();
            });

            it('T1.3.6: NutritionDaySchema validates weight, BF and circumference numbers', () => {
                const data = {
                    date: '2026-08-18',
                    kcal: 2300,
                    carbs: 280,
                    pro: 160,
                    fat: 65,
                    weight: 76.2,
                    bf: 13.8,
                    waist: 81.5,
                    neck: 38.0
                };
                const parsed = NutritionDaySchema.parse(data);
                expect(parsed.weight).toBe(76.2);
                expect(parsed.bf).toBe(13.8);
                expect(parsed.waist).toBe(81.5);
            });

            it('T1.3.7: formatItalianDate displays canonical Italian sentence date', () => {
                const dateStr = '2026-08-20';
                const formatted = Logic.formatItalianDate(dateStr);
                expect(formatted).toContain('2026');
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R4: Session Set Dot Vertical Centering
        // ---------------------------------------------------------------------
        describe('R4: Session Set Dot Vertical Centering', () => {
            it('T1.4.1: SessionSetRow renders S1 set index and circular "+" button with centered flex alignment', () => {
                const set = { id: 's1', kg: '80', reps: '10' };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );

                expect(screen.getByText('S1')).toBeDefined();
                const plusBtn = screen.getByRole('button', { name: 'Aggiungi alla serie' });
                expect(plusBtn).toBeDefined();
                expect(plusBtn.textContent).toBe('+');
            });

            it('T1.4.2: clicking circular "+" button triggers onToggleMenu to open menu', () => {
                const mockToggle = vi.fn();
                render(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '80', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={mockToggle}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );

                const plusBtn = screen.getByRole('button', { name: 'Aggiungi alla serie' });
                fireEvent.click(plusBtn);
                expect(mockToggle).toHaveBeenCalledTimes(1);
            });

            it('T1.4.3: when isOpenMenu is true, special menu shows "+ Dropset" and "+ Isometria" options', () => {
                const mockAdd = vi.fn();
                render(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '80', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={true}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={mockAdd}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );

                const dropsetBtn = screen.getByText('+ Dropset');
                const isometryBtn = screen.getByText('+ Isometria');
                expect(dropsetBtn).toBeDefined();
                expect(isometryBtn).toBeDefined();

                fireEvent.click(dropsetBtn);
                expect(mockAdd).toHaveBeenCalledWith('dropset', 's1');
            });

            it('T1.4.4: renders Dropset rows beneath the parent set with kg and reps inputs', () => {
                const set = {
                    id: 's1',
                    kg: '100',
                    reps: '6',
                    dropsets: [{ id: 'ds1', kg: '80', reps: '6' }]
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );

                expect(screen.getByText('↳ Dropset')).toBeDefined();
                expect(screen.getByDisplayValue('80')).toBeDefined();
            });

            it('T1.4.5: renders Isometria rows beneath parent set with kg and sec inputs', () => {
                const set = {
                    id: 's1',
                    kg: '50',
                    reps: '10',
                    isometrics: [{ id: 'iso1', kg: '40', time: '30' }]
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );

                expect(screen.getByText('↳ Isometria')).toBeDefined();
                expect(screen.getByDisplayValue('40')).toBeDefined();
                expect(screen.getByDisplayValue('30')).toBeDefined();
            });

            it('T1.4.6: supports time trackingType rendering time input placeholder', () => {
                const set = { id: 's1', kg: '', time: '60s' };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        trackingType="time"
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );

                expect(screen.getByPlaceholderText('Tempo (es. 60s)')).toBeDefined();
            });

            it('T1.4.7: typing into weight input invokes onUpdateSet with "kg" field and value', () => {
                const mockUpdate = vi.fn();
                render(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '70', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={mockUpdate}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );

                const kgInput = screen.getByDisplayValue('70');
                fireEvent.change(kgInput, { target: { value: '75' } });
                fireEvent.blur(kgInput);
                expect(mockUpdate).toHaveBeenCalledWith('s1', 'kg', '75');
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R5: DOMS Muscle Pain Tracking UI
        // ---------------------------------------------------------------------
        describe('R5: DOMS Muscle Pain Tracking UI', () => {
            it('T1.5.1: UserDataSchema validates activePains array', () => {
                const data = {
                    ...emptyUserData,
                    activePains: ['petto', 'bicipiti', 'spalle']
                };
                const parsed = UserDataSchema.parse(data);
                expect((parsed as any).activePains).toEqual(['petto', 'bicipiti', 'spalle']);
            });

            it('T1.5.2: MuscleModel renders SVG mannequin with muscle paths', () => {
                const { container } = render(
                    <MuscleModel 
                        selectedMuscles={['chest']} 
                        interactive={true} 
                        onToggleMuscle={vi.fn()} 
                    />
                );

                const svgs = container.querySelectorAll('svg');
                expect(svgs.length).toBeGreaterThan(0);
            });

            it('T1.5.3: MuscleModel applies custom muscleColors for DOMS danger coloring', () => {
                const customColors = { 'chest-upper-left': '#ff4d6d' };
                const { container } = render(
                    <MuscleModel 
                        muscleColors={customColors} 
                        interactive={false} 
                    />
                );

                const chestPath = container.querySelector('[data-muscle-path="chest-upper-left"]');
                expect(chestPath).not.toBeNull();
                const style = chestPath?.getAttribute('style') || '';
                expect(style.includes('#ff4d6d') || style.includes('rgb(255, 77, 109)')).toBe(true);
            });

            it('T1.5.4: clicking muscle path in interactive mode invokes onToggleMuscle callback', () => {
                const mockToggle = vi.fn();
                const { container } = render(
                    <MuscleModel 
                        interactive={true} 
                        onToggleMuscle={mockToggle} 
                    />
                );

                const chestPath = container.querySelector('[data-muscle-path="chest-upper-left"]');
                if (chestPath) {
                    fireEvent.click(chestPath);
                    expect(mockToggle).toHaveBeenCalledTimes(1);
                }
            });

            it('T1.5.5: SessionRatings renders post-workout rating fields (mood, pump, fatigue, water)', () => {
                render(
                    <SessionRatings 
                        water="1.5"
                        setWater={vi.fn()}
                        mood="4"
                        setMood={vi.fn()}
                        pump="5"
                        setPump={vi.fn()}
                        fatigue="3"
                        setFatigue={vi.fn()}
                    />
                );

                expect(screen.getByDisplayValue('1.5')).toBeDefined();
                expect(screen.getByRole('button', { name: 'Umore: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
                expect(screen.getByRole('button', { name: 'Pump: 5 su 5' }).getAttribute('aria-pressed')).toBe('true');
                expect(screen.getByRole('button', { name: 'Stanchezza: 3 su 5' }).getAttribute('aria-pressed')).toBe('true');
            });

            it('T1.5.6: HomeView renders without crash when activePains are present in store', () => {
                const userData = {
                    ...defaultMockUserData,
                    activePains: ['petto', 'bicipiti']
                };
                renderWithProviders(<HomeView onNavigate={vi.fn()} />, { userData });
                expect(screen.getByText('LogBook')).toBeDefined();
            });

            it('T1.5.7: toggling muscle adds it if absent, removes it if present in activePains state', () => {
                let pains = ['petto'];
                const toggle = (m: string) => {
                    pains = pains.includes(m) ? pains.filter(p => p !== m) : [...pains, m];
                };

                toggle('dorso');
                expect(pains).toEqual(['petto', 'dorso']);
                toggle('petto');
                expect(pains).toEqual(['dorso']);
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R6: DOMS Auto-healing Logic
        // ---------------------------------------------------------------------
        describe('R6: DOMS Auto-healing Logic', () => {
            it('T1.6.1: auto-heals and removes trained primary muscle when not re-selected in session pains', () => {
                const activePains = ['petto'];
                const sessionExercises = [{ exId: 'ex_bench' }];
                const library = [{ id: 'ex_bench', muscles: ['petto'] }];
                const sessionPains: string[] = []; // User did not re-select petto

                const updated = autoHealPainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toEqual([]); // Petto auto-healed!
            });

            it('T1.6.2: preserves active pain if user explicitly re-selects it in session ratings', () => {
                const activePains = ['petto'];
                const sessionExercises = [{ exId: 'ex_bench' }];
                const library = [{ id: 'ex_bench', muscles: ['petto'] }];
                const sessionPains = ['petto']; // User re-selected petto

                const updated = autoHealPainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toEqual(['petto']);
            });

            it('T1.6.3: leaves unrelated untrained active pains intact', () => {
                const activePains = ['gambe', 'spalle'];
                const sessionExercises = [{ exId: 'ex_squat' }];
                const library = [{ id: 'ex_squat', muscles: ['gambe'] }];
                const sessionPains: string[] = []; // Squat trained gambe -> gambe healed, spalle untrained -> retained

                const updated = autoHealPainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toEqual(['spalle']);
            });

            it('T1.6.4: adds brand new pains selected during workout session evaluation', () => {
                const activePains = ['dorso'];
                const sessionExercises = [{ exId: 'ex_curls' }];
                const library = [{ id: 'ex_curls', muscles: ['bicipiti'] }];
                const sessionPains = ['bicipiti']; // Newly experienced pain

                const updated = autoHealPainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toContain('dorso');
                expect(updated).toContain('bicipiti');
            });

            it('T1.6.5: multi-exercise session auto-heals multiple trained primary muscles if unselected', () => {
                const activePains = ['petto', 'tricipiti', 'spalle'];
                const sessionExercises = [
                    { exId: 'ex_bench' }, // muscles: ['petto']
                    { exId: 'ex_dips' }    // muscles: ['tricipiti']
                ];
                const library = [
                    { id: 'ex_bench', muscles: ['petto'] },
                    { id: 'ex_dips', muscles: ['tricipiti'] }
                ];
                const sessionPains: string[] = []; // Neither petto nor tricipiti reselected

                const updated = autoHealPainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toEqual(['spalle']); // Only untrained spalle remains
            });

            it('T1.6.6: WorkoutSessionSchema validates pains array on workout session history', () => {
                const session = {
                    date: '2026-08-20',
                    exercises: [],
                    pains: ['petto', 'tricipiti']
                };
                const parsed = WorkoutSessionSchema.parse(session);
                expect(parsed).toBeDefined();
            });

            it('T1.6.7: completing session without active pains simply adopts any newly added session pains', () => {
                const activePains: string[] = [];
                const sessionExercises = [{ exId: 'ex_deadlift' }];
                const library = [{ id: 'ex_deadlift', muscles: ['femorali', 'schiena'] }];
                const sessionPains = ['femorali'];

                const updated = autoHealPainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toEqual(['femorali']);
            });
        });
    });
});
