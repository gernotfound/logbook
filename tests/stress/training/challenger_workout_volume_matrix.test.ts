import { describe, it, expect } from 'vitest';
import { calculateEffectiveSetWeight, calculateSetVolume, calculateWorkoutVolume } from '../../../src/lib/calc/workout';

describe('Workout volume adversarial matrix', () => {
    describe('R1 Stress: Combinatorial Weight, Ballast & Volume Matrix', () => {

        it('Combinatorial Stress: 3,150 weight/equipment combinations with five rep inputs', () => {
            const ballasts = ['0', '5', '12.5', '15,75', '-10', '100', ''];
            const equipWeights = [0, 5, 20, 2.5, 10.5, undefined];
            const isBodyweightFlags = [true, false, undefined];
            const userWeights = [50, 75, 82.3, 100, 120];
            const repsArr = ['0', '5', '10', '12', 20];

            for (const b of ballasts) {
                for (const eq of equipWeights) {
                    for (const bw of isBodyweightFlags) {
                        for (const uw of userWeights) {
                            const ex = { isBodyweight: bw, equipmentWeight: eq };
                            const effWeight = calculateEffectiveSetWeight(b, ex, uw);
                            const parsedBallast = Number(b.trim().replace(',', '.')) || 0;
                            const expectedWeight = parsedBallast + (bw ? uw : 0) + (eq ?? 0);
                            expect(effWeight).toBeCloseTo(expectedWeight, 8);

                            // Invariant: effective weight must be a valid finite number (never NaN or Infinity)
                            expect(Number.isFinite(effWeight)).toBe(true);

                            // Invariant: if bodyweight is true and userWeight > 0, effective weight must include userWeight
                            if (bw && uw > 0) {
                                expect(effWeight).toBeGreaterThanOrEqual(uw - 20); // account for possible -10 ballast
                            }

                            for (const r of repsArr) {
                                const vol = calculateSetVolume({ kg: b, reps: r }, ex, uw);
                                expect(Number.isFinite(vol)).toBe(true);
                                expect(vol).toBeCloseTo(expectedWeight * Number(r), 8);
                            }
                        }
                    }
                }
            }
        });

        it('Deep Chained Dropsets: 20 sequential dropsets accumulate volume with mathematical exactness', () => {
            const dropsets = Array.from({ length: 20 }, (_, idx) => ({
                kg: `${100 - idx * 4}`, // 100, 96, 92, ..., 24
                reps: `${5 + (idx % 3)}`
            }));

            const set = {
                kg: '100',
                reps: '5',
                segments: dropsets.map((drop, index) => ({ ...drop, id: `drop-${index}`, technique: 'dropset' as const }))
            };

            const vol = calculateSetVolume(set, null, 80);
            expect(vol).toBeGreaterThan(0);
            expect(Number.isFinite(vol)).toBe(true);

            // Manual invariant check: standard set (100*5 = 500) + sum(dropsets)
            let manualExpected = 500;
            for (const ds of dropsets) {
                manualExpected += parseFloat(ds.kg) * parseInt(ds.reps, 10);
            }
            expect(vol).toBe(manualExpected);
        });

        it('Large Workout Sessions (100 exercises x 10 sets each) compute finite volume', () => {
            const library = Array.from({ length: 100 }, (_, idx) => ({
                id: `ex_${idx}`,
                isBodyweight: idx % 3 === 0,
                equipmentWeight: idx % 4 === 0 ? 20 : 0
            }));

            const session = {
                exercises: library.map(libEx => ({
                    exId: libEx.id,
                    sets: Array.from({ length: 10 }, () => ({
                        kg: '50',
                        reps: '10'
                    }))
                }))
            };

            const totalVol = calculateWorkoutVolume(session, library, 75);
            expect(totalVol).toBeGreaterThan(0);
            expect(Number.isFinite(totalVol)).toBe(true);
            const expectedTotal = library.reduce((sum, ex) => sum + 100 * (50 + (ex.isBodyweight ? 75 : 0) + ex.equipmentWeight), 0);
            expect(totalVol).toBe(expectedTotal);
        });
    });
});
