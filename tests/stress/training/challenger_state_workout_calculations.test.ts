import { describe, expect, it } from 'vitest';
import { calculateEffectiveSetWeight, calculateWorkoutVolume, getLatestUserWeight, mergeActivePains, searchMuscles, getMuscleName } from '../../../src/lib/calc/workout';
import type { Exercise, WorkoutSession } from '../../../src/types';

describe('3. Pure Calculation & DOMS Persistence Logic Stress (R1, R5, R6)', () => {
    it('3.1 calculateEffectiveSetWeight properly handles bodyweight, equipment, ballasts, and string commas', () => {
        const userWeight = 75;

        // 1. Standard non-bodyweight exercise
        expect(calculateEffectiveSetWeight('60', { isBodyweight: false }, userWeight)).toBe(60);

        // 2. Pure bodyweight (0 kg inserted -> effective weight = user weight)
        expect(calculateEffectiveSetWeight('0', { isBodyweight: true }, userWeight)).toBe(75);
        expect(calculateEffectiveSetWeight('', { isBodyweight: true }, userWeight)).toBe(75);

        // 3. Bodyweight + ballast
        expect(calculateEffectiveSetWeight('15', { isBodyweight: true }, userWeight)).toBe(90);
        expect(calculateEffectiveSetWeight('12,5', { isBodyweight: true }, userWeight)).toBe(87.5);

        // 4. Equipment base weight (e.g. 20kg bar or 15kg machine)
        expect(calculateEffectiveSetWeight('30', { equipmentWeight: 15 }, userWeight)).toBe(45);
        expect(calculateEffectiveSetWeight('0', { equipmentWeight: 20.5 }, userWeight)).toBe(20.5);

        // 5. Bodyweight + Equipment + Ballast
        expect(calculateEffectiveSetWeight('10', { isBodyweight: true, equipmentWeight: 5 }, userWeight)).toBe(90);

        // 6. Adversarial / Edge inputs
        expect(calculateEffectiveSetWeight(null, null, userWeight)).toBe(0);
        expect(calculateEffectiveSetWeight('invalid', { isBodyweight: true }, 0)).toBe(0);
        expect(calculateEffectiveSetWeight('-10', { isBodyweight: true }, userWeight)).toBe(65);
    });

    it('3.2 calculateWorkoutVolume correctly computes total volume for mixed regular, bodyweight, and equipment sets', () => {
        const userWeight = 80;
        const library: Exercise[] = [
            { id: 'lib_bench', name: 'Bench', setsCount: 3, sets: [] },
            { id: 'lib_dips', name: 'Dips', setsCount: 3, isBodyweight: true, equipmentWeight: 0, sets: [] },
            { id: 'lib_legpress', name: 'Leg Press', setsCount: 3, equipmentWeight: 45, sets: [] }
        ];

        const session: Partial<WorkoutSession> = {
            exercises: [
                {
                    exId: 'lib_bench', sessionNote: '',
                    sets: [
                        { id: 's1', kg: '100', reps: '10' }, // 100 * 10 = 1000
                        { id: 's2', kg: '100', reps: '8', segments: [{ technique: 'dropset' as const, id: 's3', kg: '80', reps: '5' }] } // 100*8 + 80*5 = 800 + 400 = 1200
                    ]
                },
                {
                    exId: 'lib_dips', sessionNote: '',
                    sets: [
                        { id: 's4', kg: '0', reps: '10' }, // (0 + 80) * 10 = 800
                        { id: 's5', kg: '20', reps: '5' }   // (20 + 80) * 5 = 500
                    ]
                },
                {
                    exId: 'lib_legpress', sessionNote: '',
                    sets: [
                        { id: 's6', kg: '100', reps: '10' } // (100 + 45) * 10 = 1450
                    ]
                }
            ]
        };

        const totalVol = calculateWorkoutVolume(session as any, library, userWeight);
        // Expected: 1000 + 1200 + 800 + 500 + 1450 = 4950
        expect(totalVol).toBe(4950);
    });

    it('3.3 getLatestUserWeight correctly prioritizes latest nutrition day weight -> planning weight -> 80 default', () => {
        // Case 1: Nutrition day with weight
        const nutrition = {
            '2026-08-01': { weight: 72 },
            '2026-08-15': { weight: 74.5 },
            '2026-08-10': { weight: 73 }
        };
        const planning = { weight: 78 };
        expect(getLatestUserWeight(nutrition, planning)).toBe(74.5);

        // Case 2: No valid nutrition weight, planning weight present
        expect(getLatestUserWeight({ '2026-08-01': { weight: '' } }, { weight: '82.5' })).toBe(82.5);

        // Case 3: Both empty -> 80 default
        expect(getLatestUserWeight(null, null)).toBe(80);
        expect(getLatestUserWeight({}, {})).toBe(80);
    });

    it('3.4 mergeActivePains: preserves active pains regardless of muscle laterality or grouping', () => {
        // Scenario A: The base muscle identifier does not implicitly resolve unilateral soreness.
        const activeA = ['chest_left', 'back_lats'];
        const resA = mergeActivePains(activeA, []);
        expect(resA).toEqual(['chest_left', 'back_lats']);

        // Scenario B: A base pain is not cleared automatically.
        const activeB = ['shoulders', 'biceps'];
        const resB = mergeActivePains(activeB, []);
        expect(resB).toEqual(['shoulders', 'biceps']);

        // Scenario C: Existing pains require explicit removal.
        const activeC = ['triceps'];
        const resC = mergeActivePains(activeC, []);
        expect(resC).toEqual(['triceps']);

        // Scenario D: re-reporting an active pain is deduplicated.
        const activeD = ['chest'];
        const resD = mergeActivePains(activeD, ['chest']);
        expect(resD).toEqual(['chest']);

        // Scenario E: existing pains stay and new session pains are appended.
        const activeE = ['legs'];
        const resE = mergeActivePains(activeE, ['abs']);
        expect(resE).toContain('legs');
        expect(resE).toContain('abs');
    });

    it('3.5 searchMuscles and getMuscleName handle lateral and accented muscle searches', () => {
        const results1 = searchMuscles('petto');
        expect(results1.length).toBeGreaterThan(0);
        expect(results1.some(m => m.id.includes('chest') || m.name.toLowerCase().includes('petto'))).toBe(true);

        const results2 = searchMuscles('quad');
        expect(results2.some(m => m.id === 'quads')).toBe(true);

        expect(getMuscleName('chest')).toBe('Petto');
        expect(getMuscleName('')).toBe('');
    });
});
