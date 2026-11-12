import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { ExerciseSchema } from '../../../src/lib/schema';
import { getLatestUserWeightContract, calculateEffectiveSetWeightContract, calculateSetVolumeContract, calculateWorkoutVolumeContract } from '../../domainCalculationContracts';

describe('Bodyweight and equipment volume', () => {
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
    });
});
