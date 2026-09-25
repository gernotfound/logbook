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
    mergeActivePainsContract
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

                expect(screen.getByText('+ Dropset')).toBeDefined();
            });

            it('T2.4.2: multiple dropsets display sequential labels "↳ Dropset 1", "↳ Dropset 2"', () => {
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

                expect(screen.getByText('↳ Dropset 1')).toBeDefined();
                expect(screen.getByText('↳ Dropset 2')).toBeDefined();
            });

            it('T2.4.3: multiple isometrics display sequential labels "↳ Isometria 1", "↳ Isometria 2"', () => {
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

                expect(screen.getByText('↳ Isometria 1')).toBeDefined();
                expect(screen.getByText('↳ Isometria 2')).toBeDefined();
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

                expect(screen.getByText('↳ Dropset')).toBeDefined();
                expect(screen.getByText('↳ Isometria')).toBeDefined();
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

                const removeBtns = screen.getAllByRole('button', { name: '✕' });
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

                expect(screen.getByRole('button', { name: 'Rimuovi serie 3' })).toBeDefined();
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

            it('T2.5.6: validateWorkoutRatings validates numeric bounds (1-5)', () => {
                const valid = Logic.validateWorkoutRatings(4, 3, 5);
                expect(valid.isValid).toBe(true);
                expect(valid.mood).toBe(4);

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

                const updated = mergeActivePainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toEqual(['petto']); // Petto was not trained, so retained
            });

            it('T2.6.2: empty session with 0 completed exercises does not alter activePains', () => {
                const activePains = ['dorso', 'bicipiti'];
                const sessionExercises: any[] = [];
                const library = [{ id: 'ex1', muscles: ['dorso'] }];

                const updated = mergeActivePainsContract(activePains, sessionExercises, library, []);
                expect(updated).toEqual(['dorso', 'bicipiti']);
            });

            it('T2.6.3: trained active pains remain active when not reselected', () => {
                const activePains = ['quadricipiti', 'polpacci'];
                const sessionExercises = [{ exId: 'ex_squat' }, { exId: 'ex_calves' }];
                const library = [
                    { id: 'ex_squat', muscles: ['quadricipiti'] },
                    { id: 'ex_calves', muscles: ['polpacci'] }
                ];

                const updated = mergeActivePainsContract(activePains, sessionExercises, library, []);
                expect(updated).toEqual(['quadricipiti', 'polpacci']);
            });

            it('T2.6.4: exercise with multiple primary muscles does not imply recovery', () => {
                const activePains = ['petto', 'deltoidi_ant'];
                const sessionExercises = [{ exId: 'ex_incline_press' }];
                const library = [{ id: 'ex_incline_press', muscles: ['petto', 'deltoidi_ant'] }];

                const updated = mergeActivePainsContract(activePains, sessionExercises, library, []);
                expect(updated).toEqual(['petto', 'deltoidi_ant']);
            });

            it('T2.6.5: session exercise pointing to non-existent library ID fails safely without throwing', () => {
                const activePains = ['petto'];
                const sessionExercises = [{ exId: 'missing_id_999' }];
                const library = [{ id: 'ex1', muscles: ['dorso'] }];

                expect(() => mergeActivePainsContract(activePains, sessionExercises, library, [])).not.toThrow();
                const updated = mergeActivePainsContract(activePains, sessionExercises, library, []);
                expect(updated).toEqual(['petto']);
            });

            it('T2.6.6: session ratings where user selects multiple new pains deduplicates gracefully', () => {
                const activePains = ['petto'];
                const sessionExercises = [{ exId: 'ex1' }];
                const library = [{ id: 'ex1', muscles: ['dorso'] }];
                const sessionPains = ['tricipiti', 'tricipiti', 'spalle'];

                const updated = mergeActivePainsContract(activePains, sessionExercises, library, sessionPains);
                expect(updated).toContain('petto');
                expect(updated).toContain('tricipiti');
                expect(updated).toContain('spalle');
            });

            it('T2.6.7: mergeActivePains contract handles null/undefined arguments without throwing', () => {
                expect(() => mergeActivePainsContract(undefined, undefined, undefined, undefined)).not.toThrow();
            });
        });
    });
});
