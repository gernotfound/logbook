import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLatestUserWeight, calculateEffectiveSetWeight, calculateSetVolume, calculateWorkoutVolume } from '../../../src/lib/calc/workout';
import { ExerciseSchema } from '../../../src/lib/schema';
import { useAppStore } from '../../../src/store/useAppStore';

describe('Workout volume components adversarial boundaries', () => {
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
                    segments: [
                        { technique: 'dropset' as const, id: 'seg-fixture-1', kg: '80', reps: '6' },
                        { technique: 'dropset' as const, id: 'seg-fixture-2', kg: '60', reps: '8' },
                        { technique: 'dropset' as const, id: 'seg-fixture-3', kg: '40,5', reps: '10' }
                    ]
                };
                // Standard ex: 100*6 (600) + 80*6 (480) + 60*8 (480) + 40.5*10 (405) = 1965
                expect(calculateSetVolume(setWithDropsets, null, 80)).toBe(1965);

                // Bodyweight ex with dropsets (e.g. +20kg pullup dropset to +10kg to bodyweight 0kg)
                const bwDropsets = {
                    kg: '20',
                    reps: '5', // (20 + 80) * 5 = 500
                    segments: [
                        { technique: 'dropset' as const, id: 'seg-fixture-4', kg: '10', reps: '5' }, // (10 + 80) * 5 = 450
                        { technique: 'dropset' as const, id: 'seg-fixture-5', kg: '0', reps: '5' }   // (0 + 80) * 5 = 400
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

                // Persistence fallback for invalid types
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
});
