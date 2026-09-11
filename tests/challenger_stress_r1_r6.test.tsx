import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    getLatestUserWeight,
    calculateEffectiveSetWeight,
    calculateSetVolume,
    calculateWorkoutVolume,
    searchMuscles,
    autoHealPains,
    searchExerciseLibrary
} from '../src/lib/calc/workout';
import {
    getLocalDateString,
    formatItalianDate,
    parseDateInput
} from '../src/lib/utils/date';
import {
    ExerciseSchema,
    FoodSchema
} from '../src/lib/schema';
import CustomFoodForm from '../src/components/Nutrition/CustomFoodForm';
import DataMeasurements from '../src/components/Data/DataMeasurements';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import SessionRatings from '../src/components/Training/session/SessionRatings';
import MuscleModel from '../src/components/Training/MuscleModel';
import HomeView from '../src/components/Home/HomeView';
import { useAppStore } from '../src/store/useAppStore';
import { renderWithProviders, defaultMockUserData } from './setup';

describe('EMPIRICAL CHALLENGER: Adversarial Stress Test Suite (Requirements R1 - R6)', () => {

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
     * REQUIREMENT R1: BODYWEIGHT & EQUIPMENT VOLUME MATHEMATICAL BOUNDARIES
     * ========================================================================= */
    describe('R1: Bodyweight & Equipment Volume - Adversarial Boundaries & Math Stress', () => {

        describe('1.1 getLatestUserWeight Adversarial Matrix', () => {
            it('returns fallback 80 when nutrition is null, undefined, empty object or invalid', () => {
                expect(getLatestUserWeight(null, null)).toBe(80);
                expect(getLatestUserWeight(undefined, undefined)).toBe(80);
                expect(getLatestUserWeight({}, {})).toBe(80);
                expect(getLatestUserWeight({} as any, { weight: 0 })).toBe(80);
                expect(getLatestUserWeight({} as any, { weight: -10 })).toBe(80);
                expect(getLatestUserWeight({} as any, { weight: 'NaN' })).toBe(80);
                expect(getLatestUserWeight({} as any, { weight: '' })).toBe(80);
            });

            it('correctly uses nutritionPlanning.weight when nutrition history has no valid weights', () => {
                expect(getLatestUserWeight({}, { weight: 72.5 })).toBe(72.5);
                expect(getLatestUserWeight({}, { weight: '73,4' })).toBe(73.4);
                expect(getLatestUserWeight({ '2026-08-01': { weight: 0 } }, { weight: '68.0' })).toBe(68.0);
            });

            it('extracts latest chronological date even if object keys are out of order or contain leap days', () => {
                const unorderedNutrition = {
                    '2026-08-10': { weight: 75.0 },
                    '2028-02-29': { weight: '78,5' }, // Leap day in future
                    '2026-08-01': { weight: 74.0 },
                    '2027-12-31': { weight: 77.2 }
                };
                expect(getLatestUserWeight(unorderedNutrition, { weight: 85 })).toBe(78.5);
            });

            it('skips invalid, zero, negative, and non-numeric weight entries in history to find real latest', () => {
                const corruptNutrition = {
                    '2026-08-01': { weight: 70.0 },
                    '2026-08-05': { weight: 0 },
                    '2026-08-10': { weight: -5 },
                    '2026-08-15': { weight: 'invalid_str' },
                    '2026-08-20': { weight: null }
                };
                expect(getLatestUserWeight(corruptNutrition, { weight: 90 })).toBe(70.0);
            });
        });

        describe('1.2 calculateEffectiveSetWeight Adversarial Boundaries', () => {
            it('standard exercise: ignores userWeight and equipmentWeight when not set', () => {
                expect(calculateEffectiveSetWeight('100', null, 80)).toBe(100);
                expect(calculateEffectiveSetWeight(100, {}, 80)).toBe(100);
                expect(calculateEffectiveSetWeight('  85.5  ', { isBodyweight: false }, 75)).toBe(85.5);
                expect(calculateEffectiveSetWeight('85,5', { isBodyweight: false }, 75)).toBe(85.5);
            });

            it('bodyweight exercise: sums ballast + userWeight (0 kg ballast => userWeight)', () => {
                const bwEx = { isBodyweight: true };
                expect(calculateEffectiveSetWeight('0', bwEx, 75)).toBe(75);
                expect(calculateEffectiveSetWeight(0, bwEx, 75)).toBe(75);
                expect(calculateEffectiveSetWeight('', bwEx, 75)).toBe(75);
                expect(calculateEffectiveSetWeight(null, bwEx, 75)).toBe(75);
                expect(calculateEffectiveSetWeight(undefined, bwEx, 75)).toBe(75);
                // Weighted pullup (+15kg ballast on 80kg body)
                expect(calculateEffectiveSetWeight('15', bwEx, 80)).toBe(95);
                expect(calculateEffectiveSetWeight('15,75', bwEx, 80)).toBe(95.75);
            });

            it('equipment exercise: sums plate weight + equipment base weight', () => {
                const barEx = { isBodyweight: false, equipmentWeight: 20 };
                expect(calculateEffectiveSetWeight('60', barEx, 80)).toBe(80); // 60 + 20
                expect(calculateEffectiveSetWeight('0', barEx, 80)).toBe(20);  // Empty bar
                expect(calculateEffectiveSetWeight('', barEx, 80)).toBe(20);
                // Equipment with number
                const customEquip = { isBodyweight: false, equipmentWeight: 2.5 };
                expect(calculateEffectiveSetWeight('10', customEquip, 80)).toBe(12.5);
            });

            it('combined bodyweight + equipment weight (e.g. dip station with dip belt base + bodyweight + added plates)', () => {
                const comboEx = { isBodyweight: true, equipmentWeight: 3 };
                expect(calculateEffectiveSetWeight('20', comboEx, 75)).toBe(98); // 20 + 75 + 3
                expect(calculateEffectiveSetWeight('0', comboEx, 75)).toBe(78);  // 0 + 75 + 3
            });

            it('negative numbers and extreme inputs (e.g. assisted chin-up machine ballast of -20kg)', () => {
                const assistedBw = { isBodyweight: true };
                // -20kg assistance on 75kg user = 55kg net
                expect(calculateEffectiveSetWeight('-20', assistedBw, 75)).toBe(55);
                // Massive inputs do not crash or produce NaN
                expect(calculateEffectiveSetWeight('999999', { isBodyweight: true, equipmentWeight: 50 }, 100)).toBe(1000149);
            });
        });

        describe('1.3 calculateSetVolume & calculateWorkoutVolume with Dropsets Matrix', () => {
            it('calculates volume across 0 ballast bodyweight sets: (0 + 75) * 12 = 900', () => {
                const set = { kg: '0', reps: '12' };
                const bwEx = { isBodyweight: true };
                expect(calculateSetVolume(set, bwEx, 75)).toBe(900);
            });

            it('correctly aggregates volume for sets with multiple chained dropsets and mixed types', () => {
                const setWithDropsets = {
                    kg: '100',
                    reps: '6',
                    dropsets: [
                        { kg: '80', reps: '6' },
                        { kg: '60', reps: '8' },
                        { kg: '40,5', reps: '10' }
                    ]
                };
                // Standard ex: 100*6 (600) + 80*6 (480) + 60*8 (480) + 40.5*10 (405) = 1965
                expect(calculateSetVolume(setWithDropsets, null, 80)).toBe(1965);

                // Bodyweight ex with dropsets (e.g. +20kg pullup dropset to +10kg to bodyweight 0kg)
                const bwDropsets = {
                    kg: '20',
                    reps: '5', // (20 + 80) * 5 = 500
                    dropsets: [
                        { kg: '10', reps: '5' }, // (10 + 80) * 5 = 450
                        { kg: '0', reps: '5' }   // (0 + 80) * 5 = 400
                    ]
                };
                expect(calculateSetVolume(bwDropsets, { isBodyweight: true }, 80)).toBe(1350);
            });

            it('calculateWorkoutVolume handles corrupt sessions, missing exercises, and nulls safely', () => {
                expect(calculateWorkoutVolume(null as any, [], 80)).toBe(0);
                expect(calculateWorkoutVolume({ exercises: [] }, [], 80)).toBe(0);
                expect(calculateWorkoutVolume({ exercises: [null as any, { exId: 'unknown', sets: [{ kg: '50', reps: 10 }] }] }, [], 80)).toBe(500);

                const library = [
                    { id: 'ex_bw', isBodyweight: true, equipmentWeight: 0 },
                    { id: 'ex_bar', isBodyweight: false, equipmentWeight: 20 }
                ];
                const session = {
                    exercises: [
                        { exId: 'ex_bw', sets: [{ kg: '10', reps: '10' }, { kg: '0', reps: '10' }] }, // (10+70)*10 = 800; (0+70)*10 = 700 -> 1500
                        { exId: 'ex_bar', sets: [{ kg: '60', reps: '10' }] } // (60+20)*10 = 800
                    ]
                };
                expect(calculateWorkoutVolume(session, library, 70)).toBe(2300);
            });

            it('ExerciseSchema validates isBodyweight and equipmentWeight boundaries', () => {
                const ex = {
                    id: 'ex_test_bw',
                    name: 'Dip Parallele',
                    setsCount: 3,
                    sets: [{ weight: '0', reps: '10', done: false }],
                    isBodyweight: true,
                    equipmentWeight: 0
                };
                const parsed = ExerciseSchema.parse(ex);
                expect((parsed as any).isBodyweight).toBe(true);
                expect((parsed as any).equipmentWeight).toBe(0);

                // Auto-healing fallback for invalid types
                const badEx = {
                    id: 'ex_bad',
                    name: 'Bad Ex',
                    setsCount: 3,
                    sets: [],
                    isBodyweight: 'true', // string instead of bool
                    equipmentWeight: 'invalid'
                };
                const sanitized = ExerciseSchema.parse(badEx);
                expect(sanitized.isBodyweight).toBe(true);
                expect(sanitized.equipmentWeight).toBeUndefined();
            });
        });
    });

    /* =========================================================================
     * REQUIREMENT R2: FOOD CALORIES CALCULATION & RAPID TYPING BOUNDARIES
     * ========================================================================= */
    describe('R2: Food Real-time Calories Calculation - Boundaries & UI Reactivity', () => {

        const calculateKcal = (carbs: any, pro: any, fat: any): number => {
            const c = typeof carbs === 'number' ? carbs : parseFloat(String(carbs ?? '').trim().replace(',', '.')) || 0;
            const p = typeof pro === 'number' ? pro : parseFloat(String(pro ?? '').trim().replace(',', '.')) || 0;
            const f = typeof fat === 'number' ? fat : parseFloat(String(fat ?? '').trim().replace(',', '.')) || 0;
            return Math.round(c * 4 + p * 4 + f * 9);
        };

        it('adheres precisely to the formula: 10g C, 10g P, 10g F = 170 kcal', () => {
            expect(calculateKcal(10, 10, 10)).toBe(170);
        });

        it('handles boundary zeroes, empty strings, commas, and decimals correctly', () => {
            expect(calculateKcal(0, 0, 0)).toBe(0);
            expect(calculateKcal('', '', '')).toBe(0);
            expect(calculateKcal('   ', null, undefined)).toBe(0);
            expect(calculateKcal('12,5', '20,5', '5,5')).toBe(182); // 12.5*4 (50) + 20.5*4 (82) + 5.5*9 (49.5) = 181.5 -> 182
            expect(calculateKcal('0.1', '0.2', '0.3')).toBe(4); // 0.4 + 0.8 + 2.7 = 3.9 -> 4
        });

        it('handles non-numeric strings, negative numbers, and extreme macro values', () => {
            expect(calculateKcal('abc', 'def', 'ghi')).toBe(0);
            expect(calculateKcal(-10, -5, -2)).toBe(-78);
            expect(calculateKcal(5000, 2000, 1000)).toBe(37000); // 20000 + 8000 + 9000 = 37000
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

        it('CustomFoodForm allows updating macros and triggers save', () => {
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
            expect(mockSetData).toHaveBeenCalled();
        });
    });

    /* =========================================================================
     * REQUIREMENT R3: MEASUREMENTS DATE SELECTOR & DATE ROLL-OVERS
     * ========================================================================= */
    describe('R3: Measurements Date Selector & Date Utilities Robustness', () => {

        it('getLocalDateString returns YYYY-MM-DD in local time and prevents UTC drift', () => {
            const d = new Date(2026, 7, 20, 0, 30, 0); // August 20, 2026, 00:30 local time
            const localStr = getLocalDateString(d);
            expect(localStr).toBe('2026-08-20');
        });

        it('formatItalianDate correctly formats leap years, month boundaries, and future dates', () => {
            expect(formatItalianDate('2024-02-29')).toContain('2024');
            expect(formatItalianDate('2026-12-31')).toContain('2026');
            expect(formatItalianDate('2027-01-01')).toContain('2027');
            expect(formatItalianDate('invalid-date')).toBe('');
        });

        it('parseDateInput parses Italian date strings and ISO strings robustly', () => {
            const isoParsed = parseDateInput('2026-08-20');
            expect(isoParsed).toBe('2026-08-20');

            const itParsed = parseDateInput('20/08/2026');
            expect(itParsed).toBe('2026-08-20');

            const invalidParsed = parseDateInput('invalid-date');
            expect(invalidParsed).toBeNull();
        });

        it('DataMeasurements renders date selector and measurement inputs at top', () => {
            render(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    editingDate={null}
                    measureTime="08:00"
                    setMeasureTime={vi.fn()}
                    weight="77.5"
                    setWeight={vi.fn()}
                    waist="80"
                    setWaist={vi.fn()}
                    neck="38"
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

            expect(screen.getByText('➕ Nuova misurazione')).toBeDefined();
            expect(screen.getByDisplayValue('77.5')).toBeDefined();
            expect(screen.getByDisplayValue('80')).toBeDefined();
        });
    });

    /* =========================================================================
     * REQUIREMENT R4: SESSION SET ROW SPECIAL BUTTON & VERTICAL ALIGNMENT
     * ========================================================================= */
    describe('R4: SessionSetRow Special Button & Dropset Hierarchy', () => {

        it('renders set label S1 and accessible "+" button with proper ARIA label', () => {
            render(
                <SessionSetRow
                    set={{ id: 'set_1', kg: '80', reps: '8' }}
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
            const btn = screen.getByRole('button', { name: 'Aggiungi dropset o isometria' });
            expect(btn).toBeDefined();
            expect(btn.textContent).toBe('+');
        });

        it('expands special set menu and allows adding dropset or isometry', () => {
            const mockAdd = vi.fn();
            render(
                <SessionSetRow
                    set={{ id: 'set_1', kg: '80', reps: '8' }}
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

            const dropsetOpt = screen.getByText('+ Dropset');
            fireEvent.click(dropsetOpt);
            expect(mockAdd).toHaveBeenCalledWith('dropset', 'set_1');

            const isometryOpt = screen.getByText('+ Isometria');
            fireEvent.click(isometryOpt);
            expect(mockAdd).toHaveBeenCalledWith('isometry', 'set_1');
        });

        it('renders nested dropsets and isometrics rows with proper change callbacks', () => {
            const mockUpdateSpecial = vi.fn();
            const mockRemoveSpecial = vi.fn();

            const set = {
                id: 'set_1',
                kg: '90',
                reps: '8',
                dropsets: [{ id: 'ds_1', kg: '70', reps: '8' }],
                isometrics: [{ id: 'iso_1', kg: '50', time: '20' }]
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
                    onUpdateSpecialSet={mockUpdateSpecial}
                    onRemoveSpecialSet={mockRemoveSpecial}
                />
            );

            expect(screen.getByText('↳ Dropset')).toBeDefined();
            expect(screen.getByText('↳ Isometria')).toBeDefined();

            const dsKgInput = screen.getByDisplayValue('70');
            fireEvent.change(dsKgInput, { target: { value: '75' } });
            fireEvent.blur(dsKgInput);
            expect(mockUpdateSpecial).toHaveBeenCalledWith('set_1', 'dropsets', 0, 'kg', '75');
        });
    });

    /* =========================================================================
     * REQUIREMENT R5: DOMS MUSCLE PAIN TRACKING & FUZZY SEARCH STRESS
     * ========================================================================= */
    describe('R5: DOMS Muscle Pain Tracking & Fuzzy Search Matrix', () => {

        it('searchMuscles correctly stems Italian plural/singular and matches muscles', () => {
            const pettorali = searchMuscles('pettorali');
            expect(pettorali.length).toBeGreaterThan(0);
            expect(pettorali.some(m => m.name.toLowerCase().includes('petto') || m.id.includes('chest'))).toBe(true);

            const deltoidi = searchMuscles('deltoidi');
            expect(deltoidi.length).toBeGreaterThan(0);
            expect(deltoidi.some(m => m.id.includes('delts') || m.name.toLowerCase().includes('deltoide'))).toBe(true);

            const bicipiti = searchMuscles('bicipiti');
            expect(bicipiti.length).toBeGreaterThan(0);
            expect(bicipiti.some(m => m.id.includes('biceps'))).toBe(true);

            const quadricipiti = searchMuscles('quadricipiti');
            expect(quadricipiti.length).toBeGreaterThan(0);
            expect(quadricipiti.some(m => m.id.includes('quad'))).toBe(true);
        });

        it('searchMuscles handles typos, partial strings, and case insensitivity', () => {
            const fuzzyPetto = searchMuscles('peto');
            expect(fuzzyPetto.length).toBeGreaterThan(0);

            const fuzzyBicipte = searchMuscles('bicipte');
            expect(fuzzyBicipte.length).toBeGreaterThan(0);

            const emptySearch = searchMuscles('');
            expect(emptySearch).toEqual([]);

            const whitespaceSearch = searchMuscles('   ');
            expect(whitespaceSearch).toEqual([]);
        });

        it('searchExerciseLibrary finds exercises across names, stemmed names, muscles and notes', () => {
            const library = [
                { id: 'ex_1', name: 'Panca piana bilanciere', muscles: ['chest_upper_left', 'chest_upper_right'], notes: 'Presa media' },
                { id: 'ex_2', name: 'Trazioni presa prona', muscles: ['latissimus_dorsi_left'], notes: 'Zavorra' },
                { id: 'ex_3', name: 'Squat con bilanciere', muscles: ['quadriceps_left'], notes: 'Gambe' }
            ];

            const pancaRes = searchExerciseLibrary(library, 'pettorali');
            expect(pancaRes.length).toBeGreaterThan(0);
            expect(pancaRes[0].id).toBe('ex_1');

            const trazioniRes = searchExerciseLibrary(library, 'dorsali');
            expect(trazioniRes.length).toBeGreaterThan(0);
            expect(trazioniRes[0].id).toBe('ex_2');
        });

        it('MuscleModel renders interactive mannequin and highlights DOMS active pains in danger color', () => {
            const customColors = { 'chest-upper-left': '#ff4d6d', 'chest-upper-right': '#ff4d6d' };
            const { container } = render(
                <MuscleModel
                    muscleColors={customColors}
                    interactive={true}
                    onToggleMuscle={vi.fn()}
                />
            );

            const leftChest = container.querySelector('#chest-upper-left');
            expect(leftChest).not.toBeNull();
            const style = leftChest?.getAttribute('style') || '';
            expect(style.includes('#ff4d6d') || style.includes('rgb(255, 77, 109)')).toBe(true);
        });

        it('SessionRatings renders DOMS rating and evaluation fields', () => {
            render(
                <SessionRatings
                    water="2.0"
                    setWater={vi.fn()}
                    mood="7"
                    setMood={vi.fn()}
                    pump="8"
                    setPump={vi.fn()}
                    fatigue="5"
                    setFatigue={vi.fn()}
                />
            );

            expect(screen.getByDisplayValue('2.0')).toBeDefined();
            expect(screen.getByDisplayValue('7')).toBeDefined();
            expect(screen.getByDisplayValue('8')).toBeDefined();
            expect(screen.getByDisplayValue('5')).toBeDefined();
        });

        it('HomeView displays Panoramica di oggi with activePains without crash', () => {
            const userData = {
                ...defaultMockUserData,
                activePains: ['chest', 'biceps_left']
            };
            renderWithProviders(<HomeView onNavigate={vi.fn()} />, { userData });
            expect(screen.getByText('LogBook')).toBeDefined();
        });
    });

    /* =========================================================================
     * REQUIREMENT R6: DOMS AUTO-HEALING LOGIC ADVERSARIAL STRESS
     * ========================================================================= */
    describe('R6: DOMS Auto-Healing Logic - Complex Exercise & Symmetry Scenarios', () => {

        const library = [
            { id: 'ex_bench', muscles: ['chest', 'triceps', 'shoulders_anterior'] },
            { id: 'ex_lat', muscles: ['latissimus_dorsi', 'biceps'] },
            { id: 'ex_squat', muscles: ['quadriceps', 'gluteus'] },
            { id: 'ex_unilateral_curl', muscles: ['biceps_left'] }
        ];

        it('heals single trained primary muscle if not re-selected in session pains', () => {
            const activePains = ['chest', 'quadriceps'];
            const sessionExercises = [{ exId: 'ex_bench' }];
            const sessionPains: string[] = []; // user did not report chest pain

            const result = autoHealPains(activePains, sessionExercises, library, sessionPains);
            // 'chest' was trained as primary and not re-selected -> healed!
            // 'quadriceps' was not trained -> preserved!
            expect(result).toEqual(['quadriceps']);
        });

        it('preserves trained muscle if explicitly re-selected in session pains', () => {
            const activePains = ['chest', 'quadriceps'];
            const sessionExercises = [{ exId: 'ex_bench' }];
            const sessionPains = ['chest']; // user still feels chest pain

            const result = autoHealPains(activePains, sessionExercises, library, sessionPains);
            expect(result).toContain('chest');
            expect(result).toContain('quadriceps');
        });

        it('adds newly reported session pains and merges with preserved pains', () => {
            const activePains = ['quadriceps'];
            const sessionExercises = [{ exId: 'ex_lat' }];
            const sessionPains = ['latissimus_dorsi', 'shoulders']; // new soreness

            const result = autoHealPains(activePains, sessionExercises, library, sessionPains);
            expect(result).toContain('quadriceps'); // preserved
            expect(result).toContain('latissimus_dorsi'); // new/re-selected
            expect(result).toContain('shoulders'); // new
        });

        it('resolves bilateral and unilateral symmetry: training base muscle heals lateral pain if not re-selected', () => {
            // Active pain is unilateral: chest_left
            // Exercise trains base: chest
            const activePains = ['chest_left', 'biceps'];
            const sessionExercises = [{ exId: 'ex_bench' }]; // trains chest
            const sessionPains: string[] = [];

            const result = autoHealPains(activePains, sessionExercises, library, sessionPains);
            // chest_left is healed because chest was trained and chest_left wasn't re-selected
            expect(result).toEqual(['biceps']);
        });

        it('resolves inverse symmetry: training unilateral muscle heals base pain if not re-selected', () => {
            const activePains = ['biceps'];
            const sessionExercises = [{ exId: 'ex_unilateral_curl' }]; // trains biceps_left
            const sessionPains: string[] = [];

            const result = autoHealPains(activePains, sessionExercises, library, sessionPains);
            expect(result).toEqual([]);
        });

        it('multi-muscle compound exercises auto-heal all trained primary muscles', () => {
            const activePains = ['chest', 'triceps', 'shoulders_anterior', 'calves'];
            const sessionExercises = [{ exId: 'ex_bench' }]; // trains chest, triceps, shoulders_anterior
            const sessionPains = ['triceps']; // only triceps re-selected

            const result = autoHealPains(activePains, sessionExercises, library, sessionPains);
            expect(result).toContain('triceps');
            expect(result).toContain('calves');
            expect(result).not.toContain('chest');
            expect(result).not.toContain('shoulders_anterior');
        });

        it('handles boundary conditions: empty active pains, empty library, corrupt entries', () => {
            expect(autoHealPains([], [], [], [])).toEqual([]);
            expect(autoHealPains(undefined as any, null as any, null as any, undefined as any)).toEqual([]);
            expect(autoHealPains(['chest', '', null as any], [{ exId: 'missing' }], [], [])).toEqual(['chest']);
        });
    });
});
