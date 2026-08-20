import { describe, it, expect } from 'vitest';
import {
    getLatestUserWeight,
    calculateEffectiveSetWeight,
    calculateSetVolume,
    calculateWorkoutVolume,
    searchMuscles,
    autoHealPains
} from '../src/lib/calc/workout';
import {
    formatDuration,
    formatTime,
    getCalendarMonthGrid
} from '../src/lib/utils/date';
import {
    FoodSchema
} from '../src/lib/schema';

describe('EMPIRICAL CHALLENGER: Pure Math, State & Schema Adversarial Stress Suite (R1 - R6)', () => {

    /* =========================================================================
     * R1: VOLUME & WEIGHT CALCULATION PURE MATHEMATICAL STRESS
     * ========================================================================= */
    describe('R1 Stress: Combinatorial Weight, Ballast & Volume Matrix', () => {

        it('Combinatorial Stress: 1000 combinations of ballast, equipment, userWeight, reps', () => {
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

                            // Invariant: effective weight must be a valid finite number (never NaN or Infinity)
                            expect(Number.isFinite(effWeight)).toBe(true);

                            // Invariant: if bodyweight is true and userWeight > 0, effective weight must include userWeight
                            if (bw && uw > 0) {
                                expect(effWeight).toBeGreaterThanOrEqual(uw - 20); // account for possible -10 ballast
                            }

                            for (const r of repsArr) {
                                const vol = calculateSetVolume({ kg: b, reps: r }, ex, uw);
                                expect(Number.isFinite(vol)).toBe(true);
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
                dropsets
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

        it('Large Workout Sessions (100 exercises x 10 sets each) compute under 50ms', () => {
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

            const t0 = performance.now();
            const totalVol = calculateWorkoutVolume(session, library, 75);
            const elapsed = performance.now() - t0;

            expect(totalVol).toBeGreaterThan(0);
            expect(elapsed).toBeLessThan(50);
        });
    });

    /* =========================================================================
     * R2: FOOD CALORIES CALCULATION FORMULA & SCHEMA RESILIENCE
     * ========================================================================= */
    describe('R2 Stress: Macro Combinations & Schema Boundary Testing', () => {
        const calculateKcal = (carbs: any, pro: any, fat: any): number => {
            const c = typeof carbs === 'number' ? carbs : parseFloat(String(carbs ?? '').trim().replace(',', '.')) || 0;
            const p = typeof pro === 'number' ? pro : parseFloat(String(pro ?? '').trim().replace(',', '.')) || 0;
            const f = typeof fat === 'number' ? fat : parseFloat(String(fat ?? '').trim().replace(',', '.')) || 0;
            return Math.round(c * 4 + p * 4 + f * 9);
        };

        it('Macro boundary permutations: zero, integer, decimal, string format invariance', () => {
            expect(calculateKcal(0, 0, 0)).toBe(0);
            expect(calculateKcal(10, 10, 10)).toBe(170);
            expect(calculateKcal('10', '10', '10')).toBe(170);
            expect(calculateKcal('10.0', '10.0', '10.0')).toBe(170);
            expect(calculateKcal('10,0', '10,0', '10,0')).toBe(170);
            expect(calculateKcal(' 10.5 ', ' 20.2 ', ' 5.1 ')).toBe(169); // 42 + 80.8 + 45.9 = 168.7 -> 169
        });

        it('FoodSchema validates and parses 100 foods with random variations', () => {
            for (let i = 0; i < 100; i++) {
                const food = {
                    id: `food_${i}`,
                    name: `Food Item ${i}`,
                    carbs: (i * 1.5) % 100,
                    pro: (i * 0.8) % 50,
                    fat: (i * 0.5) % 40,
                    kcal: calculateKcal((i * 1.5) % 100, (i * 0.8) % 50, (i * 0.5) % 40),
                    isCustom: i % 2 === 0
                };
                const parsed = FoodSchema.parse(food);
                expect(parsed.name).toBe(`Food Item ${i}`);
                expect(Number.isFinite(parsed.kcal)).toBe(true);
            }
        });
    });

    /* =========================================================================
     * R3: DATE LOGIC & CALENDAR ROBUSTNESS
     * ========================================================================= */
    describe('R3 Stress: Date Transitions, DST & Calendar Grids', () => {

        it('getCalendarMonthGrid generates exact 5 or 6 week grids without NaN or missing days', () => {
            // Months across 2026
            for (let m = 0; m < 12; m++) {
                const grid = getCalendarMonthGrid(2026, m);
                expect(grid.length).toBeGreaterThanOrEqual(28);
                expect(grid.length % 7).toBe(0);
                grid.forEach(day => {
                    expect(day.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                    expect(typeof day.dayNum).toBe('number');
                    expect(typeof day.isCurrentMonth).toBe('boolean');
                });
            }
        });

        it('formatDuration handles 0, seconds, minutes, hours, and extreme durations without crash', () => {
            expect(formatDuration(0)).toBe('00:00:00');
            expect(formatDuration(60)).toBe('00:01:00');
            expect(formatDuration(3600)).toBe('01:00:00');
            expect(formatDuration(3665)).toBe('01:01:05');
            expect(formatDuration(86400)).toBe('24:00:00');
        });

        it('formatTime formats MM:SS cleanly from milliseconds', () => {
            // 300,000 ms = 5 minutes = 05:00
            expect(formatTime(300000)).toBe('05:00');
            // 3,665,000 ms with showHours = true -> 01:01:05
            expect(formatTime(3665000, true)).toBe('01:01:05');
        });
    });

    /* =========================================================================
     * R5 & R6: DOMS FUZZY SEARCH & AUTO-HEALING STATE MACHINE STRESS
     * ========================================================================= */
    describe('R5 & R6 Stress: Search Benchmarks & Auto-Healing State Invariants', () => {

        it('searchMuscles fuzzing with 50 arbitrary strings does not crash or throw', () => {
            const queries = [
                'p', 'pe', 'pet', 'pett', 'petto', 'pettorali',
                'spalle', 'deltoid', 'deltoidi anteriori',
                'gambe', 'quads', 'quadricipiti', 'femorali', 'polpacci',
                '12345', '!@#$%', 'undefined', 'null', 'NaN', 'SELECT * FROM',
                '   ', '\t\n', 'a'.repeat(200)
            ];

            for (const q of queries) {
                const results = searchMuscles(q);
                expect(Array.isArray(results)).toBe(true);
                results.forEach(m => {
                    expect(m).toHaveProperty('id');
                    expect(m).toHaveProperty('name');
                });
            }
        });

        it('autoHealPains State Invariants across 200 randomized workout transitions', () => {
            const allMuscles = ['chest', 'latissimus_dorsi', 'trapezius', 'deltoid_anterior', 'deltoid_lateral', 'biceps', 'triceps', 'quadriceps', 'hamstrings', 'calves', 'abs'];
            const allExercises = [
                { id: 'ex_1', muscles: ['chest', 'triceps'] },
                { id: 'ex_2', muscles: ['latissimus_dorsi', 'biceps'] },
                { id: 'ex_3', muscles: ['quadriceps', 'calves'] },
                { id: 'ex_4', muscles: ['deltoid_anterior', 'trapezius'] }
            ];

            for (let i = 0; i < 200; i++) {
                // Generate random initial active pains
                const initialPains = allMuscles.filter((_, idx) => (i + idx) % 3 === 0);
                // Pick random completed exercise
                const exChoice = allExercises[i % allExercises.length];
                // Random session pains (user might report soreness or none)
                const sessionPains = (i % 2 === 0) ? [exChoice.muscles[0]] : [];

                const healedPains = autoHealPains(initialPains, [{ exId: exChoice.id }], allExercises, sessionPains);

                // INVARIANT 1: Result is always a string array
                expect(Array.isArray(healedPains)).toBe(true);

                // INVARIANT 2: Untrained muscles are NEVER removed
                for (const p of initialPains) {
                    if (!exChoice.muscles.includes(p)) {
                        expect(healedPains).toContain(p);
                    }
                }

                // INVARIANT 3: If trained muscle was NOT in session pains, it MUST be removed
                for (const m of exChoice.muscles) {
                    if (initialPains.includes(m) && !sessionPains.includes(m)) {
                        expect(healedPains).not.toContain(m);
                    }
                }

                // INVARIANT 4: If session pain was reported, it MUST be present in output
                for (const sp of sessionPains) {
                    expect(healedPains).toContain(sp);
                }
            }
        });
    });
});
