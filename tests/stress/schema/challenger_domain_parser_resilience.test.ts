import { describe, it, expect } from 'vitest';
import { DomainParsers } from '../../../src/lib/schema';

describe('Domain parser adversarial inputs', () => {
    describe('Scope 5: Domain Segmented Zod Parsers', () => {
        it('exports DomainParsers for fine-grained validation and rejects corrupted sub-trees gracefully', () => {
            expect(DomainParsers).toBeDefined();
            expect(typeof DomainParsers.parseProfile).toBe('function');
            expect(typeof DomainParsers.parseHistory).toBe('function');
            expect(typeof DomainParsers.parseNutrition).toBe('function');
            expect(typeof DomainParsers.parseLibrary).toBe('function');
            expect(typeof DomainParsers.parseCustomFoods).toBe('function');
            expect(typeof DomainParsers.parseRoutines).toBe('function');
            expect(typeof DomainParsers.parseTrainingCycles).toBe('function');
            expect(typeof DomainParsers.parseSupplements).toBe('function');
            expect(typeof DomainParsers.parseNutritionPlanning).toBe('function');

            // Defensive test: corrupted input to parseProfile recovers gracefully
            const profile = DomainParsers.parseProfile({ height: 180, invalidProp: 'ok' });
            expect(profile.height).toBe('180');

            // Defensive test: corrupted nutrition day
            const nutrition = DomainParsers.parseNutrition({
                '2026-08-16': {
                    date: '2026-08-16',
                    kcal: '2200', // string parsed to number
                    carbs: '250',
                    pro: 'NaN',  // NaN recovers to default
                    fat: 70
                }
            });
            expect(nutrition['2026-08-16'].kcal).toBe(2200);
            expect(nutrition['2026-08-16'].pro).toBe(0);
        });
    });
});
