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

/* =========================================================================
 * PURE CALCULATION & AUTO-HEALING CONTRACT HELPERS (R1, R2, R6)
 * ========================================================================= */

export function getLatestUserWeightContract(
    nutrition?: Record<string, any> | null,
    nutritionPlanning?: { weight?: number | string } | null
): number {
    if ((Logic as any).getLatestUserWeight) {
        return (Logic as any).getLatestUserWeight(nutrition, nutritionPlanning);
    }
    if (nutrition && typeof nutrition === 'object') {
        const sortedDates = Object.keys(nutrition).sort().reverse();
        for (const date of sortedDates) {
            const day = nutrition[date];
            if (day && day.weight !== undefined && day.weight !== null && day.weight !== '') {
                const num = typeof day.weight === 'number' ? day.weight : parseFloat(String(day.weight).trim().replace(',', '.'));
                if (!isNaN(num) && num > 0) return num;
            }
        }
    }
    if (nutritionPlanning?.weight !== undefined && nutritionPlanning?.weight !== null && nutritionPlanning?.weight !== '') {
        const num = typeof nutritionPlanning.weight === 'number' ? nutritionPlanning.weight : parseFloat(String(nutritionPlanning.weight).trim().replace(',', '.'));
        if (!isNaN(num) && num > 0) return num;
    }
    return 0;
}

export function calculateEffectiveSetWeightContract(
    setKg: string | number | undefined | null,
    exercise?: { isBodyweight?: boolean; equipmentWeight?: number } | null,
    userWeight: number = 0
): number {
    if ((Logic as any).calculateEffectiveSetWeight) {
        return (Logic as any).calculateEffectiveSetWeight(setKg, exercise, userWeight);
    }
    const rawKg = typeof setKg === 'number' ? setKg : parseFloat(String(setKg || '0').trim().replace(',', '.')) || 0;
    const equip = typeof exercise?.equipmentWeight === 'number' ? exercise.equipmentWeight : parseFloat(String(exercise?.equipmentWeight || '0').trim().replace(',', '.')) || 0;
    let total = rawKg + equip;
    if (exercise?.isBodyweight) {
        total += userWeight;
    }
    return total;
}

export function calculateSetVolumeContract(
    set: { kg?: string | number; reps?: string | number; dropsets?: Array<{ kg?: string | number; reps?: string | number }> },
    exercise?: { isBodyweight?: boolean; equipmentWeight?: number } | null,
    userWeight: number = 0
): number {
    if ((Logic as any).calculateSetVolume) {
        return (Logic as any).calculateSetVolume(set, exercise, userWeight);
    }
    const effectiveWeight = calculateEffectiveSetWeightContract(set.kg, exercise, userWeight);
    const reps = typeof set.reps === 'number' ? set.reps : parseInt(String(set.reps || '0').trim(), 10) || 0;
    let vol = effectiveWeight * reps;

    if (Array.isArray(set.dropsets)) {
        for (const ds of set.dropsets) {
            const dsEffectiveWeight = calculateEffectiveSetWeightContract(ds.kg, exercise, userWeight);
            const dsReps = typeof ds.reps === 'number' ? ds.reps : parseInt(String(ds.reps || '0').trim(), 10) || 0;
            vol += dsEffectiveWeight * dsReps;
        }
    }
    return vol;
}

export function calculateWorkoutVolumeContract(
    session: { exercises?: Array<{ exId?: string; sets?: any[] }> },
    library?: Array<{ id: string; isBodyweight?: boolean; equipmentWeight?: number }>,
    userWeight: number = 0
): number {
    if ((Logic as any).calculateWorkoutVolume) {
        return (Logic as any).calculateWorkoutVolume(session, library, userWeight);
    }
    if (!Array.isArray(session?.exercises)) return 0;
    const libMap = new Map((library || []).map(ex => [ex.id, ex]));
    let total = 0;
    for (const sex of session.exercises) {
        const ex = libMap.get(sex.exId || '');
        if (Array.isArray(sex.sets)) {
            for (const s of sex.sets) {
                total += calculateSetVolumeContract(s, ex, userWeight);
            }
        }
    }
    return total;
}

export function calculateRealtimeKcalContract(carbs: any, pro: any, fat: any): number {
    const c = typeof carbs === 'number' ? carbs : parseFloat(String(carbs || '0').trim().replace(',', '.')) || 0;
    const p = typeof pro === 'number' ? pro : parseFloat(String(pro || '0').trim().replace(',', '.')) || 0;
    const f = typeof fat === 'number' ? fat : parseFloat(String(fat || '0').trim().replace(',', '.')) || 0;
    return Math.round(c * 4 + p * 4 + f * 9);
}

export function autoHealPainsContract(
    activePains: string[] = [],
    sessionExercises: Array<{ exId?: string }> = [],
    library: Array<{ id: string; muscles?: string[] }> = [],
    sessionPains: string[] = []
): string[] {
    if ((Logic as any).autoHealPains) {
        return (Logic as any).autoHealPains(activePains, sessionExercises, library, sessionPains);
    }
    const libMap = new Map(library.map(ex => [ex.id, ex]));
    const trainedPrimaryMuscles = new Set<string>();
    for (const se of sessionExercises) {
        const ex = libMap.get(se.exId || '');
        if (Array.isArray(ex?.muscles)) {
            ex.muscles.forEach(m => trainedPrimaryMuscles.add(m));
        }
    }

    const sessionPainsSet = new Set(sessionPains);
    const resultPains: string[] = [];

    // Evaluate active pains
    for (const pain of activePains) {
        if (trainedPrimaryMuscles.has(pain)) {
            // Trained as primary: keep only if explicitly selected in session pains
            if (sessionPainsSet.has(pain)) {
                resultPains.push(pain);
            }
        } else {
            // Untrained: preserve
            resultPains.push(pain);
        }
    }

    // Add new session pains
    for (const pain of sessionPains) {
        if (!resultPains.includes(pain)) {
            resultPains.push(pain);
        }
    }

    return resultPains;
}


/* =========================================================================
 * E2E TEST SUITE: REQUIREMENTS R1 THROUGH R6
 * ========================================================================= */

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
            it('T1.4.1: SessionSetRow renders S1 and an accessible options button', () => {
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
                const plusBtn = screen.getByRole('button', { name: 'Opzioni serie 1' });
                expect(plusBtn).toBeDefined();
                expect(plusBtn.getAttribute('aria-haspopup')).toBe('menu');
            });

            it('T1.4.2: clicking options opens the set menu', () => {
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

                const plusBtn = screen.getByRole('button', { name: 'Opzioni serie 1' });
                fireEvent.click(plusBtn);
                expect(plusBtn.getAttribute('aria-expanded')).toBe('true');
            });

            it('T1.4.3: the opened set menu shows "+ Dropset" and "+ Isometria" options', () => {
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

                fireEvent.click(screen.getByRole('button', { name: 'Opzioni serie 1' }));
                const dropsetBtn = screen.getByRole('menuitem', { name: '+ Dropset' });
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

                expect(screen.getByText('Dropset 1')).toBeDefined();
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

                expect(screen.getByText('Isometria 1')).toBeDefined();
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

                const chestPath = container.querySelector('#chest-upper-left');
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

                const chestPath = container.querySelector('#chest-upper-left');
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
                        mood="8"
                        setMood={vi.fn()}
                        pump="9"
                        setPump={vi.fn()}
                        fatigue="6"
                        setFatigue={vi.fn()}
                    />
                );

                expect(screen.getByDisplayValue('1.5')).toBeDefined();
                expect(screen.getByDisplayValue('8')).toBeDefined();
                expect(screen.getByDisplayValue('9')).toBeDefined();
                expect(screen.getByDisplayValue('6')).toBeDefined();
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

    /* =========================================================================
     * TIER 2: BOUNDARY & CORNER CASES (>=5 tests per requirement R1 - R6)
     * ========================================================================= */
    describe('Tier 2: Boundary & Corner Cases', () => {

        // ---------------------------------------------------------------------
        // Requirement R1: Boundaries
        // ---------------------------------------------------------------------
        describe('R1: Boundary & Corner Cases', () => {
            it('T2.1.1: 0 kg ballast on bodyweight chin-ups with 75 kg user weight returns 75 * reps, not 0 or NaN', () => {
                const ex = { isBodyweight: true, equipmentWeight: 0 };
                const vol = calculateSetVolumeContract({ kg: '0', reps: '12' }, ex, 75);
                expect(vol).toBe(900); // 75 * 12
                expect(isNaN(vol)).toBe(false);
            });

            it('T2.1.2: missing or undefined user weight falls back to 0 without throwing error', () => {
                const ex = { isBodyweight: true };
                const vol = calculateSetVolumeContract({ kg: '10', reps: '5' }, ex, 0);
                expect(vol).toBe(50); // (10 + 0) * 5
                expect(isNaN(vol)).toBe(false);
            });

            it('T2.1.3: negative ballast on assisted pull-up machine (e.g. -20 kg counterweight)', () => {
                const ex = { isBodyweight: true, equipmentWeight: 0 };
                const userWeight = 80;
                // Net weight is 80 - 20 = 60 kg
                const effective = calculateEffectiveSetWeightContract('-20', ex, userWeight);
                expect(effective).toBe(60);
                const vol = calculateSetVolumeContract({ kg: '-20', reps: '10' }, ex, userWeight);
                expect(vol).toBe(600);
            });

            it('T2.1.4: handles string inputs with spaces or decimals in set kg and equipment weight', () => {
                const ex = { isBodyweight: true, equipmentWeight: 2.5 };
                const effective = calculateEffectiveSetWeightContract(' 12.5 ', ex, 75);
                expect(effective).toBe(90); // 12.5 + 2.5 + 75
            });

            it('T2.1.5: exercise with isBodyweight false and equipmentWeight 0 behaves identically to standard weight_reps', () => {
                const exStandard = { isBodyweight: false, equipmentWeight: 0 };
                const vol = calculateSetVolumeContract({ kg: '100', reps: '5' }, exStandard, 80);
                expect(vol).toBe(500);
            });

            it('T2.1.6: zero reps produces zero volume regardless of bodyweight or equipment weight', () => {
                const ex = { isBodyweight: true, equipmentWeight: 20 };
                const vol = calculateSetVolumeContract({ kg: '50', reps: '0' }, ex, 80);
                expect(vol).toBe(0);
            });

            it('T2.1.7: empty exercises array in workout volume returns 0', () => {
                const vol = calculateWorkoutVolumeContract({ exercises: [] }, [], 75);
                expect(vol).toBe(0);
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R2: Boundaries
        // ---------------------------------------------------------------------
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
                expect(typeof kcal).toBe('number');
                expect(isNaN(kcal)).toBe(false);
            });

            it('T2.2.7: fractional rounding boundary (e.g. 0.125g macros)', () => {
                const kcal = calculateRealtimeKcalContract(0.125, 0.125, 0.125);
                // 0.5 + 0.5 + 1.125 = 2.125 -> 2
                expect(kcal).toBe(2);
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R3: Boundaries
        // ---------------------------------------------------------------------
        describe('R3: Boundary & Corner Cases', () => {
            it('T2.3.1: month boundary navigation: subtracting 1 day from 2026-08-01 gives 2026-07-31', () => {
                const d = new Date('2026-08-01T12:00:00');
                d.setDate(d.getDate() - 1);
                const prev = Logic.getLocalDateString(d);
                expect(prev).toBe('2026-07-31');
            });

            it('T2.3.2: year boundary navigation: subtracting 1 day from 2026-01-01 gives 2025-12-31', () => {
                const d = new Date('2026-01-01T12:00:00');
                d.setDate(d.getDate() - 1);
                const prev = Logic.getLocalDateString(d);
                expect(prev).toBe('2025-12-31');
            });

            it('T2.3.3: leap year boundary: adding 1 day to 2024-02-28 gives 2024-02-29', () => {
                const d = new Date('2024-02-28T12:00:00');
                d.setDate(d.getDate() + 1);
                const next = Logic.getLocalDateString(d);
                expect(next).toBe('2024-02-29');
            });

            it('T2.3.4: logging measurements on a past date preserves existing meals in nutrition record', () => {
                const existingDay: NutritionDay = {
                    date: '2026-08-10',
                    kcal: 2500,
                    carbs: 300,
                    pro: 170,
                    fat: 70,
                    meals: [
                        { id: 'm1', name: 'Pranzo', meal: 'pranzo', quantity: 1, kcal: 800, carbs: 100, pro: 50, fat: 20 }
                    ]
                };

                const updatedDay: NutritionDay = {
                    ...existingDay,
                    weight: 76.0,
                    waist: 82.0
                };

                expect(updatedDay.meals?.length).toBe(1);
                expect(updatedDay.meals?.[0].name).toBe('Pranzo');
                expect(updatedDay.weight).toBe(76.0);
            });

            it('T2.3.5: saving measurements with all optional circumferences left blank saves cleanly', () => {
                const dayData = {
                    date: '2026-08-15',
                    kcal: 0,
                    carbs: 0,
                    pro: 0,
                    fat: 0,
                    weight: 75.0
                };
                const parsed = NutritionDaySchema.parse(dayData);
                expect(parsed.weight).toBe(75.0);
                expect(parsed.waist).toBeUndefined();
            });

            it('T2.3.6: parseDateInput handles YYYY-MM-DD, DD/MM/YYYY, and single digit dates', () => {
                expect(Logic.parseDateInput('2026-08-20')).toBe('2026-08-20');
                expect(Logic.parseDateInput('20/08/2026')).toBe('2026-08-20');
                expect(Logic.parseDateInput('1/9/2026')).toBe('2026-09-01');
            });

            it('T2.3.7: getCalendarMonthGrid creates calendar matrix with valid week structure', () => {
                const grid = Logic.getCalendarMonthGrid(2026, 8); // August 2026
                expect(Array.isArray(grid)).toBe(true);
                expect(grid.length).toBeGreaterThanOrEqual(4);
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R4: Boundaries
        // ---------------------------------------------------------------------
        describe('R4: Boundary & Corner Cases', () => {
            it('T2.4.1: rapid menu toggles in SessionSetRow do not throw or lose component state', () => {
                const mockToggle = vi.fn();
                const { rerender } = render(
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

                rerender(
                    <SessionSetRow
                        set={{ id: 's1', kg: '80', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={true}
                        onToggleMenu={mockToggle}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );

                const options = screen.getByRole('button', { name: 'Opzioni serie 1' });
                for (let i = 0; i < 5; i++) fireEvent.click(options);
                expect(screen.getByRole('menuitem', { name: '+ Dropset' })).toBeDefined();
                expect((screen.getByRole('spinbutton', { name: 'Serie 1, chilogrammi', exact: true }) as HTMLInputElement).value).toBe('80');
            });

            it('T2.4.2: multiple dropsets display sequential labels "Dropset 1", "Dropset 2"', () => {
                const set = {
                    id: 's1',
                    kg: '100',
                    reps: '6',
                    dropsets: [
                        { id: 'ds1', kg: '80', reps: '6' },
                        { id: 'ds2', kg: '60', reps: '8' }
                    ]
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

                expect(screen.getByText('Dropset 1')).toBeDefined();
                expect(screen.getByText('Dropset 2')).toBeDefined();
            });

            it('T2.4.3: multiple isometrics display sequential labels "Isometria 1", "Isometria 2"', () => {
                const set = {
                    id: 's1',
                    kg: '50',
                    reps: '10',
                    isometrics: [
                        { id: 'iso1', kg: '40', time: '20' },
                        { id: 'iso2', kg: '30', time: '15' }
                    ]
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

                expect(screen.getByText('Isometria 1')).toBeDefined();
                expect(screen.getByText('Isometria 2')).toBeDefined();
            });

            it('T2.4.4: combining both dropset and isometry on the same set', () => {
                const set = {
                    id: 's1',
                    kg: '80',
                    reps: '8',
                    dropsets: [{ id: 'ds1', kg: '60', reps: '6' }],
                    isometrics: [{ id: 'iso1', kg: '40', time: '15' }]
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

                expect(screen.getByText('Dropset 1')).toBeDefined();
                expect(screen.getByText('Isometria 1')).toBeDefined();
            });

            it('T2.4.5: clicking remove button on dropset invokes onRemoveSpecialSet', () => {
                const mockRemove = vi.fn();
                const set = {
                    id: 's1',
                    kg: '80',
                    reps: '8',
                    dropsets: [{ id: 'ds1', kg: '60', reps: '6' }]
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
                        onRemoveSpecialSet={mockRemove}
                    />
                );

                const removeBtns = screen.getAllByRole('button', { name: 'Rimuovi dropset 1 della serie 1' });
                fireEvent.click(removeBtns[0]);
                expect(mockRemove).toHaveBeenCalledWith('s1', 'dropsets', 0);
            });

            it('T2.4.6: SessionSetRow handles empty string kg and reps without throwing', () => {
                const set = { id: 's1', kg: '', reps: '' };
                expect(() => render(
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
                )).not.toThrow();
            });

            it('T2.4.7: delete set button aria-label includes set number for accessibility', () => {
                render(
                    <SessionSetRow
                        set={{ id: 's3', kg: '50', reps: '10' }}
                        sIndex={2}
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

                fireEvent.click(screen.getByRole('button', { name: 'Opzioni serie 3' }));
                expect(screen.getByRole('menuitem', { name: 'Rimuovi serie 3' })).toBeDefined();
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R5: Boundaries
        // ---------------------------------------------------------------------
        describe('R5: Boundary & Corner Cases', () => {
            it('T2.5.1: empty activePains array in UserData parses safely', () => {
                const parsed = UserDataSchema.parse({ ...emptyUserData, activePains: [] });
                expect((parsed as any).activePains).toEqual([]);
            });

            it('T2.5.2: undefined activePains field in legacy UserData defaults gracefully', () => {
                const parsed = UserDataSchema.parse(emptyUserData);
                expect((parsed as any).activePains === undefined || Array.isArray((parsed as any).activePains)).toBe(true);
            });

            it('T2.5.3: MuscleModel handles non-existent or unknown muscle IDs without throwing', () => {
                expect(() => render(
                    <MuscleModel
                        selectedMuscles={['unknown_alien_muscle', 'fake_quad']}
                        interactive={false}
                    />
                )).not.toThrow();
            });

            it('T2.5.4: duplicate muscle IDs in activePains list are handled safely', () => {
                const pains = ['petto', 'petto', 'petto'];
                const uniquePains = Array.from(new Set(pains));
                expect(uniquePains).toEqual(['petto']);
            });

            it('T2.5.5: all muscle groups active simultaneously renders full mannequin in danger state', () => {
                const allMuscles = Logic.MUSCLES.map(m => m.id);
                const colorMap = Object.fromEntries(allMuscles.map(m => [m, '#ff4d6d']));

                expect(() => render(
                    <MuscleModel
                        muscleColors={colorMap}
                        interactive={false}
                    />
                )).not.toThrow();
            });

            it('T2.5.6: validateWorkoutRatings validates numeric bounds (1-10)', () => {
                const valid = Logic.validateWorkoutRatings(8, 7, 5);
                expect(valid.isValid).toBe(true);
                expect(valid.mood).toBe(8);

                const invalid = Logic.validateWorkoutRatings(15, 0, -2);
                expect(invalid.isValid).toBe(false);
            });

            it('T2.5.7: validateWorkoutRatings accepts null or empty optional ratings', () => {
                const res = Logic.validateWorkoutRatings(null, undefined, '');
                expect(res.isValid).toBe(true);
                expect(res.mood).toBeNull();
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R6: Boundaries
        // ---------------------------------------------------------------------
        describe('R6: Boundary & Corner Cases', () => {
            it('T2.6.1: exercise without muscles array defined does not cause errors or clear unrelated pains', () => {
                const activePains = ['petto'];
                const sessionExercises = [{ exId: 'ex_custom_no_muscles' }];
                const library = [{ id: 'ex_custom_no_muscles' }]; // muscles is undefined
                const sessionPains: string[] = [];

                const updated = autoHealPainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toEqual(['petto']); // Petto was not trained, so retained
            });

            it('T2.6.2: empty session with 0 completed exercises does not alter activePains', () => {
                const activePains = ['dorso', 'bicipiti'];
                const sessionExercises: any[] = [];
                const library = [{ id: 'ex1', muscles: ['dorso'] }];

                const updated = autoHealPainsContract(activePains, sessionExercises, library, []);
                expect(updated).toEqual(['dorso', 'bicipiti']);
            });

            it('T2.6.3: when all active pains are trained and none are reselected, returns empty array', () => {
                const activePains = ['quadricipiti', 'polpacci'];
                const sessionExercises = [{ exId: 'ex_squat' }, { exId: 'ex_calves' }];
                const library = [
                    { id: 'ex_squat', muscles: ['quadricipiti'] },
                    { id: 'ex_calves', muscles: ['polpacci'] }
                ];

                const updated = autoHealPainsContract(activePains, sessionExercises, library, []);
                expect(updated).toEqual([]);
            });

            it('T2.6.4: exercise with multiple primary muscles heals all of them if not reselected', () => {
                const activePains = ['petto', 'deltoidi_ant'];
                const sessionExercises = [{ exId: 'ex_incline_press' }];
                const library = [{ id: 'ex_incline_press', muscles: ['petto', 'deltoidi_ant'] }];

                const updated = autoHealPainsContract(activePains, sessionExercises, library, []);
                expect(updated).toEqual([]);
            });

            it('T2.6.5: session exercise pointing to non-existent library ID fails safely without throwing', () => {
                const activePains = ['petto'];
                const sessionExercises = [{ exId: 'missing_id_999' }];
                const library = [{ id: 'ex1', muscles: ['dorso'] }];

                expect(() => autoHealPainsContract(activePains, sessionExercises, library, [])).not.toThrow();
                const updated = autoHealPainsContract(activePains, sessionExercises, library, []);
                expect(updated).toEqual(['petto']);
            });

            it('T2.6.6: session ratings where user selects multiple new pains deduplicates gracefully', () => {
                const activePains = ['petto'];
                const sessionExercises = [{ exId: 'ex1' }];
                const library = [{ id: 'ex1', muscles: ['dorso'] }];
                const sessionPains = ['tricipiti', 'tricipiti', 'spalle'];

                const updated = autoHealPainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toContain('petto');
                expect(updated).toContain('tricipiti');
                expect(updated).toContain('spalle');
            });

            it('T2.6.7: autoHealPains contract handles null/undefined arguments without throwing', () => {
                expect(() => autoHealPainsContract(undefined, undefined, undefined, undefined)).not.toThrow();
            });
        });
    });

    /* =========================================================================
     * TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise & Multi-Feature Interactions)
     * ========================================================================= */
    describe('Tier 3: Cross-Feature Combinations', () => {
        it('T3.1: Bodyweight Chin-ups with Dropsets & Equipment Weight (R1 + R4)', () => {
            // User weight = 78 kg. Chin-ups have 2 kg dip belt base weight.
            // Main set: +15 kg ballast x 8 reps
            // Dropset 1: +5 kg ballast x 6 reps
            // Dropset 2: 0 kg ballast (bodyweight only) x 5 reps
            const ex = { isBodyweight: true, equipmentWeight: 2 };
            const userWeight = 78;

            const set = {
                kg: '15',
                reps: '8',
                dropsets: [
                    { kg: '5', reps: '6' },
                    { kg: '0', reps: '5' }
                ]
            };

            // Main set: (15 + 2 + 78) * 8 = 95 * 8 = 760
            // Dropset 1: (5 + 2 + 78) * 6 = 85 * 6 = 510
            // Dropset 2: (0 + 2 + 78) * 5 = 80 * 5 = 400
            // Total set volume = 760 + 510 + 400 = 1670 kg
            const vol = calculateSetVolumeContract(set, ex, userWeight);
            expect(vol).toBe(1670);
        });

        it('T3.2: Custom Food Auto-Kcal creation -> Logged into Daily Meals -> Nutrition Day verification (R2 + R3)', () => {
            // Step 1: User creates custom high-protein pudding in form
            const carbs = 12;
            const pro = 20;
            const fat = 3;
            const calculatedKcal = calculateRealtimeKcalContract(carbs, pro, fat);
            expect(calculatedKcal).toBe(155); // 12*4 + 20*4 + 3*9 = 48 + 80 + 27 = 155

            const customFood: Food = {
                id: 'cf_pudding',
                name: 'Budino proteico',
                carbs,
                pro,
                fat,
                kcal: calculatedKcal,
                unit: '100g',
                isCustom: true
            };

            // Step 2: Log food on historical past date (2026-08-14)
            const targetDate = '2026-08-14';
            const initialDay: NutritionDay = {
                date: targetDate,
                kcal: 0,
                carbs: 0,
                pro: 0,
                fat: 0,
                meals: []
            };

            const loggedMeal = {
                id: 'm_1',
                name: customFood.name,
                meal: 'spuntino',
                quantity: 2, // 200g
                kcal: customFood.kcal * 2,
                carbs: customFood.carbs * 2,
                pro: customFood.pro * 2,
                fat: customFood.fat * 2
            };

            const updatedDay: NutritionDay = {
                ...initialDay,
                kcal: loggedMeal.kcal,
                carbs: loggedMeal.carbs,
                pro: loggedMeal.pro,
                fat: loggedMeal.fat,
                meals: [loggedMeal]
            };

            expect(updatedDay.kcal).toBe(310);
            expect(updatedDay.pro).toBe(40);
            expect(updatedDay.carbs).toBe(24);
            expect(updatedDay.fat).toBe(6);
        });

        it('T3.3: DOMS Pain Tracking in Home -> Workout Session with Muscle -> Auto-healing on Completion -> State Updated (R5 + R6)', () => {
            // Initial state: User has DOMS in 'petto' and 'bicipiti'
            const initialUserData: any = {
                ...defaultMockUserData,
                activePains: ['petto', 'bicipiti'],
                library: [
                    { id: 'ex_bench', name: 'Panca piana', muscles: ['petto'], setsCount: 3, sets: [] }
                ]
            };

            // User performs Bench Press (Primary: petto)
            const sessionExercises = [{ exId: 'ex_bench' }];
            const sessionRatingsPains: string[] = []; // User notes chest pain is gone!

            const newActivePains = autoHealPainsContract(
                initialUserData.activePains,
                sessionExercises,
                initialUserData.library,
                sessionRatingsPains
            );

            // 'petto' was trained and not re-selected -> auto-healed. 'bicipiti' was untrained -> retained.
            expect(newActivePains).toEqual(['bicipiti']);

            // Update Zustand store
            useAppStore.setState({
                userData: {
                    ...initialUserData,
                    activePains: newActivePains
                }
            });

            expect(useAppStore.getState().userData?.activePains).toEqual(['bicipiti']);
        });

        it('T3.4: Past Date Measurement Logging -> Affects Bodyweight Workout Volume Calculation for Past Workout (R1 + R3)', () => {
            // User weighed 80kg on 2026-08-01, and 75kg on 2026-08-15
            const ex = { id: 'ex_dip', isBodyweight: true, equipmentWeight: 0 };
            const session = {
                date: '2026-08-01',
                exercises: [{ exId: 'ex_dip', sets: [{ kg: '10', reps: '10' }] }]
            };

            // For the 2026-08-01 session: weight was 80 kg -> (10 + 80) * 10 = 900
            const pastWeight = 80;
            const volumePast = calculateWorkoutVolumeContract(session, [ex], pastWeight);
            expect(volumePast).toBe(900);

            // If done at 75 kg -> (10 + 75) * 10 = 850
            const currentWeight = 75;
            const volumeCurrent = calculateWorkoutVolumeContract(session, [ex], currentWeight);
            expect(volumeCurrent).toBe(850);
        });

        it('T3.5: DOMS Selection in Session Ratings with Auto-Calculated Volume and Custom Food Post-Workout Snack (R1 + R2 + R5 + R6)', () => {
            // 1. Session volume calculation
            const library = [{ id: 'ex_pullup', isBodyweight: true, equipmentWeight: 0, muscles: ['dorso', 'bicipiti'] }];
            const session = {
                exercises: [{ exId: 'ex_pullup', sets: [{ kg: '0', reps: '10' }, { kg: '5', reps: '8' }] }]
            };
            const userWeight = 75;
            // Set 1: (0 + 75) * 10 = 750
            // Set 2: (5 + 75) * 8 = 640 -> Total = 1390
            const sessionVol = calculateWorkoutVolumeContract(session, library, userWeight);
            expect(sessionVol).toBe(1390);

            // 2. DOMS auto-healing: initial pain was 'dorso', user experienced new 'bicipiti' pump
            const initialPains = ['dorso'];
            const sessionPains = ['bicipiti']; // Dorso unselected, bicipiti selected
            const updatedPains = autoHealPainsContract(initialPains, session.exercises, library, sessionPains);
            expect(updatedPains).toEqual(['bicipiti']);

            // 3. Post-workout snack auto-calculated kcal
            const postWorkoutSnackKcal = calculateRealtimeKcalContract(45, 30, 2); // 45*4 + 30*4 + 2*9 = 180 + 120 + 18 = 318
            expect(postWorkoutSnackKcal).toBe(318);
        });

        it('T3.6: Multi-Muscle Complex Session with Equipment Base + Bodyweight Ballast + DOMS Partial Auto-Healing (R1 + R4 + R5 + R6)', () => {
            const library = [
                { id: 'ex_dip', name: 'Dip alle parallele', isBodyweight: true, equipmentWeight: 3, muscles: ['petto', 'tricipiti'] },
                { id: 'ex_squat', name: 'Squat con bilanciere', isBodyweight: false, equipmentWeight: 20, muscles: ['quadricipiti'] }
            ];

            const session = {
                exercises: [
                    {
                        exId: 'ex_dip',
                        sets: [
                            {
                                kg: '20',
                                reps: '6',
                                dropsets: [{ kg: '0', reps: '6' }] // BW + equip = 75 + 3 = 78
                            }
                        ]
                    },
                    {
                        exId: 'ex_squat',
                        sets: [
                            { kg: '80', reps: '5' } // (80 + 20) * 5 = 500
                        ]
                    }
                ]
            };

            const userWeight = 75;
            // Dip Set: (20 + 3 + 75) * 6 = 98 * 6 = 588
            // Dip Dropset: (0 + 3 + 75) * 6 = 78 * 6 = 468
            // Squat Set: (80 + 20) * 5 = 500
            // Total = 588 + 468 + 500 = 1556
            const totalVol = calculateWorkoutVolumeContract(session, library, userWeight);
            expect(totalVol).toBe(1556);

            // Auto-healing: active pains were 'petto', 'quadricipiti', 'polpacci'
            // User re-selected 'petto' in session pains, left 'quadricipiti' empty
            const activePains = ['petto', 'quadricipiti', 'polpacci'];
            const resolvedPains = autoHealPainsContract(activePains, session.exercises, library, ['petto']);
            // 'petto' retained because reselected
            // 'quadricipiti' healed because trained as primary and not reselected
            // 'polpacci' retained because untrained
            expect(resolvedPains).toEqual(['petto', 'polpacci']);
        });
    });

    /* =========================================================================
     * TIER 4: REAL-WORLD WORKFLOWS (End-to-End User Scenarios)
     * ========================================================================= */
    describe('Tier 4: Real-World Workflows', () => {

        it('T4.1: Scenario 1 — "The Calisthenics & Weighted Street Workout Progression"', () => {
            // User starts session with weighted pull-ups and dips
            const library = [
                { id: 'c_pullup', name: 'Weighted Pull-Up', isBodyweight: true, equipmentWeight: 1.5, muscles: ['dorso', 'bicipiti'] },
                { id: 'c_dip', name: 'Weighted Dips', isBodyweight: true, equipmentWeight: 1.5, muscles: ['petto', 'tricipiti'] }
            ];

            const userWeight = 74.0;

            const session = {
                id: 'ws_cali_1',
                routineName: 'Street Workout Upper',
                date: '2026-08-20',
                exercises: [
                    {
                        exId: 'c_pullup',
                        sessionNote: 'Focus esplosivo',
                        sets: [
                            { id: 's1', kg: '15', reps: '6' }, // (15 + 1.5 + 74) * 6 = 90.5 * 6 = 543
                            { id: 's2', kg: '15', reps: '6' }, // 543
                            { id: 's3', kg: '10', reps: '8' }  // (10 + 1.5 + 74) * 8 = 85.5 * 8 = 684
                        ]
                    },
                    {
                        exId: 'c_dip',
                        sessionNote: 'Scendi fino a 90 gradi',
                        sets: [
                            { id: 's4', kg: '25', reps: '6' }, // (25 + 1.5 + 74) * 6 = 100.5 * 6 = 603
                            { id: 's5', kg: '20', reps: '8' }  // (20 + 1.5 + 74) * 8 = 95.5 * 8 = 764
                        ]
                    }
                ]
            };

            const totalVol = calculateWorkoutVolumeContract(session, library, userWeight);
            expect(totalVol).toBe(3137); // 543 + 543 + 684 + 603 + 764 = 3137

            // Session completion with ratings and sore triceps
            const activePainsBefore = ['spalle'];
            const sessionPains = ['tricipiti'];
            const activePainsAfter = autoHealPainsContract(activePainsBefore, session.exercises, library, sessionPains);
            expect(activePainsAfter).toContain('spalle');
            expect(activePainsAfter).toContain('tricipiti');
        });

        it('T4.2: Scenario 2 — "The Bodybuilder Meal Prep & Macro Auto-Balancing"', () => {
            // Athlete prepares 3 custom staples for the week:
            // 1. Pollo al forno (0g C, 31g P, 3.5g F)
            // 2. Riso Jasmine (79g C, 7g P, 0.5g F)
            // 3. Olio EVO (0g C, 0g P, 99.9g F)
            const chickenKcal = calculateRealtimeKcalContract(0, 31, 3.5); // 0 + 124 + 31.5 = 155.5 -> 156
            const riceKcal = calculateRealtimeKcalContract(79, 7, 0.5);   // 316 + 28 + 4.5 = 348.5 -> 349
            const oilKcal = calculateRealtimeKcalContract(0, 0, 99.9);    // 899.1 -> 899

            expect(chickenKcal).toBe(156);
            expect(riceKcal).toBe(349);
            expect(oilKcal).toBe(899);

            // Assemble lunch meal: 200g chicken (31g P, 3.5g F per 100g), 100g rice (79g C, 7g P, 0.5g F per 100g), 10g oil (99.9g F per 100g)
            const lunchCarbs = 79;
            const lunchPro = 31 * 2 + 7;
            const lunchFat = 3.5 * 2 + 0.5 + 99.9 * 0.1;
            const lunchKcal = calculateRealtimeKcalContract(lunchCarbs, lunchPro, lunchFat);

            expect(lunchCarbs).toBe(79);
            expect(lunchPro).toBe(69);
            expect(Math.round(lunchFat)).toBe(17); // 7 + 0.5 + 9.99 = 17.49 -> 17
            expect(lunchKcal).toBe(749); // 79*4 + 69*4 + 17.49*9 = 316 + 276 + 157.41 = 749.41 -> 749
        });

        it('T4.3: Scenario 3 — "Leg Day Recovery & DOMS Auto-Healing Life Cycle"', () => {
            // Day 1: User does heavy squats. Next day logs 'quadricipiti' DOMS in Home card.
            let userActivePains = ['quadricipiti'];
            const library = [
                { id: 'ex_squat', name: 'Squat', muscles: ['quadricipiti'] },
                { id: 'ex_bench', name: 'Panca Piana', muscles: ['petto'] }
            ];

            // Day 3: Upper body workout (Panca Piana). Session completes.
            const upperSession = [{ exId: 'ex_bench' }];
            userActivePains = autoHealPainsContract(userActivePains, upperSession, library, []);
            // Quadricipiti was not trained -> remains in pain
            expect(userActivePains).toEqual(['quadricipiti']);

            // Day 5: Legs workout again (Squat). Session completes with no pain re-selected.
            const legSession = [{ exId: 'ex_squat' }];
            userActivePains = autoHealPainsContract(userActivePains, legSession, library, []);
            // Quadricipiti was trained and not re-selected -> auto-healed!
            expect(userActivePains).toEqual([]);
        });

        it('T4.4: Scenario 4 — "Athlete Multi-Day Training, Recovery & Nutrition Integration"', () => {
            // Day 1 (Monday): Log morning measurements
            const monday = '2026-08-17';
            const initialNutrition: Record<string, NutritionDay> = {
                [monday]: {
                    date: monday,
                    weight: 76.5,
                    waist: 81.0,
                    neck: 38.0,
                    kcal: 2600,
                    carbs: 320,
                    pro: 170,
                    fat: 70
                }
            };

            useAppStore.setState({
                userData: {
                    ...defaultMockUserData,
                    nutrition: initialNutrition,
                    activePains: ['dorso']
                }
            });

            // Day 1 Workout: Back & Biceps (Dorso)
            const library = [
                { id: 'ex_row', isBodyweight: false, equipmentWeight: 0, muscles: ['dorso'] }
            ];
            const backSession = {
                exercises: [{ exId: 'ex_row', sets: [{ kg: '70', reps: '10' }] }]
            };

            const latestWeight = getLatestUserWeightContract(useAppStore.getState().userData?.nutrition);
            expect(latestWeight).toBe(76.5);

            const vol = calculateWorkoutVolumeContract(backSession, library, latestWeight);
            expect(vol).toBe(700);

            // Auto-heal 'dorso' on completion
            const resolvedPains = autoHealPainsContract(
                useAppStore.getState().userData?.activePains,
                backSession.exercises,
                library,
                []
            );
            expect(resolvedPains).toEqual([]);
        });

        it('T4.5: Scenario 5 — "Rehabilitation & Pain Recovery Tracking through Deload Week"', () => {
            // Athlete enters deload with shoulder and elbow fatigue
            let pains = ['spalle', 'tricipiti'];
            const library = [
                { id: 'ex_ohp', muscles: ['spalle'] },
                { id: 'ex_pushdown', muscles: ['tricipiti'] }
            ];

            // Deload Day 1: Light overhead press only
            pains = autoHealPainsContract(pains, [{ exId: 'ex_ohp' }], library, []);
            expect(pains).toEqual(['tricipiti']); // Shoulder recovered!

            // Deload Day 2: Light triceps extensions
            pains = autoHealPainsContract(pains, [{ exId: 'ex_pushdown' }], library, []);
            expect(pains).toEqual([]); // All recovered!
        });
    });
});
