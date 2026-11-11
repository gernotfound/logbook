import { describe, it, expect } from 'vitest';
import { searchMuscles, mergeActivePains } from '../../../src/lib/calc/workout';

describe('Muscle search and pain invariants', () => {
    describe('R5 & R6 Stress: Search Benchmarks & Pain Persistence State Invariants', () => {

        it('searchMuscles accepts the 23 declared adversarial queries does not crash or throw', () => {
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

        it('mergeActivePains State Invariants across 200 deterministic workout transitions', () => {
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

                const healedPains = mergeActivePains(initialPains, sessionPains);

                // INVARIANT 1: Result is always a string array
                expect(Array.isArray(healedPains)).toBe(true);

                // INVARIANT 2: Existing active pains are never removed implicitly.
                for (const p of initialPains) {
                    expect(healedPains).toContain(p);
                }

                // INVARIANT 3: A reported session pain is appended and deduplicated.
                for (const sp of sessionPains) {
                    expect(healedPains).toContain(sp);
                    expect(healedPains.filter(p => p === sp)).toHaveLength(1);
                }
            }
        });
    });
});
