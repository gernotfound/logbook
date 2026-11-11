import { describe, it, expect } from 'vitest';
import {
    calculateSetVolumeContract,
    calculateWorkoutVolumeContract,
    mergeActivePainsContract
} from '../requirements_r1_r6_contracts';

describe('LogBook 4-Tier Automated Test Suite (Requirements R1 - R6)', () => {

    /* =========================================================================
     * TIER 3: PURE-FUNCTION COMPOSITIONS (not end-to-end persistence tests)
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
                segments: [
                    { technique: 'dropset' as const, id: 'seg-fixture-1', kg: '5', reps: '6' },
                    { technique: 'dropset' as const, id: 'seg-fixture-2', kg: '0', reps: '5' }
                ]
            };

            // Main set: (15 + 2 + 78) * 8 = 95 * 8 = 760
            // Dropset 1: (5 + 2 + 78) * 6 = 85 * 6 = 510
            // Dropset 2: (0 + 2 + 78) * 5 = 80 * 5 = 400
            // Total set volume = 760 + 510 + 400 = 1670 kg
            const vol = calculateSetVolumeContract(set, ex, userWeight);
            expect(vol).toBe(1670);
        });


        it('T3.4: Pure volume function differs for two explicitly supplied bodyweights', () => {
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


        it('T3.6: Combined equipment/bodyweight calculation and pure DOMS union', () => {
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
                                segments: [{ technique: 'dropset' as const, id: 'seg-fixture-3', kg: '0', reps: '6' }] // BW + equip = 75 + 3 = 78
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

            // Explicit persistence: active pains were 'petto', 'quadricipiti', 'polpacci'
            // User re-selected 'petto' in session pains, left 'quadricipiti' empty
            const activePains = ['petto', 'quadricipiti', 'polpacci'];
            const resolvedPains = mergeActivePainsContract(activePains, ['petto']);
            // Existing pains are preserved regardless of training involvement or re-selection.
            expect(resolvedPains).toEqual(['petto', 'quadricipiti', 'polpacci']);
        });
        it('T3.7: weighted calisthenics with multiple exercises and explicit DOMS preservation', () => {
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
            const activePainsAfter = mergeActivePainsContract(activePainsBefore, sessionPains);
            expect(activePainsAfter).toContain('spalle');
            expect(activePainsAfter).toContain('tricipiti');
        });

    });
});
