import { describe, it, expect } from 'vitest';
import { calculateSetVolume } from '../../../src/lib/calc/workout';
import type { Exercise } from '../../../src/types';

describe('Analytics stress: dropset mechanical invariants', () => {
    describe('4. Dropset Volume Calculation & Mechanical Invariants', () => {
        it('satisfies Volume Invariant: SetVolume = MainSetVolume + sum(DropsetVolumes)', () => {
            const mainKg = 100;
            const mainReps = 8;
            const drop1Kg = 80;
            const drop1Reps = 8;
            const drop2Kg = 60;
            const drop2Reps = 10;
            const drop3Kg = 40;
            const drop3Reps = 12;

            const set = {
                kg: mainKg,
                reps: mainReps,
                segments: [
                    { technique: 'dropset' as const, id: 'seg-fixture-1', kg: drop1Kg, reps: drop1Reps },
                    { technique: 'dropset' as const, id: 'seg-fixture-2', kg: drop2Kg, reps: drop2Reps },
                    { technique: 'dropset' as const, id: 'seg-fixture-3', kg: drop3Kg, reps: drop3Reps }
                ]
            };

            const expectedMain = mainKg * mainReps;
            const expectedDrop1 = drop1Kg * drop1Reps;
            const expectedDrop2 = drop2Kg * drop2Reps;
            const expectedDrop3 = drop3Kg * drop3Reps;
            const expectedTotal = expectedMain + expectedDrop1 + expectedDrop2 + expectedDrop3;

            const actualTotal = calculateSetVolume(set, null, 80);
            expect(actualTotal).toBe(expectedTotal);
            expect(actualTotal).toBe(2520);
        });

        it('calculates dropsets on Bodyweight exercises factoring user weight in each drop stage', () => {
            const userWeight = 75;
            const bwEx: Exercise = {
                id: 'ex_pullup',
                name: 'Trazioni',
                isBodyweight: true,
                trackingType: 'weight_reps',
                setsCount: 1,
                sets: []
            };

            const set = {
                kg: '20',
                reps: '6',
                segments: [
                    { technique: 'dropset' as const, id: 'seg-fixture-4', kg: '10', reps: '6' },
                    { technique: 'dropset' as const, id: 'seg-fixture-5', kg: '0', reps: '6' }
                ]
            };

            const total = calculateSetVolume(set, bwEx, userWeight);
            expect(total).toBe(570 + 510 + 450);
        });

        it('calculates dropsets on Equipment Tare exercises factoring equipment tare in each drop stage', () => {
            const eqEx: Exercise = {
                id: 'ex_squat',
                name: 'Squat',
                equipmentWeight: 20,
                trackingType: 'weight_reps',
                setsCount: 1,
                sets: []
            };

            const set = {
                kg: '100',
                reps: '5',
                segments: [{ technique: 'dropset' as const, id: 'seg-fixture-6', kg: '60', reps: '8' }]
            };

            const total = calculateSetVolume(set, eqEx, 80);
            expect(total).toBe(600 + 640);
        });

        it('combines Bodyweight AND Equipment Tare on dropsets safely', () => {
            const comboEx: Exercise = {
                id: 'ex_dip',
                name: 'Dip',
                isBodyweight: true,
                equipmentWeight: 5,
                trackingType: 'weight_reps',
                setsCount: 1,
                sets: []
            };
            const userWeight = 80;

            const set = {
                kg: '15',
                reps: '10',
                segments: [{ technique: 'dropset' as const, id: 'seg-fixture-7', kg: '0', reps: '10' }]
            };

            const total = calculateSetVolume(set, comboEx, userWeight);
            expect(total).toBe(1850);
        });

        it('defends against malformed dropset objects with string decimals and missing fields', () => {
            const setWithFormats = {
                kg: '100',
                reps: '10',
                segments: [
                    { technique: 'dropset' as const, id: 'seg-fixture-8', kg: '50,5', reps: '8' },
                    { technique: 'dropset' as const, id: 'seg-fixture-9', kg: 'invalid', reps: 'invalid' },
                    { technique: 'dropset' as const, id: 'seg-fixture-10', kg: '', reps: '' }
                ]
            };

            const total = calculateSetVolume(setWithFormats, null, 80);
            expect(total).toBe(1404);
            expect(Number.isNaN(total)).toBe(false);
        });
    });
});
