import { describe, it, expect } from 'vitest';
import { UserDataSchema, NutritionDaySchema, DomainParsers } from '../schema';

describe('UserDataSchema', () => {
    it('excludes the retired stored calorie total from active and pending plans without losing current targets', () => {
        const plan = { weight: 80, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 },
            normocalorica: { kcal: 2500 }, totalKcal: 99999, futureField: 'preserved' };
        const before = structuredClone(plan);
        const parsed = UserDataSchema.parse({ nutritionPlanning: plan, pendingConflicts: { nutritionPlanning: plan } });
        for (const result of [parsed.nutritionPlanning, parsed.pendingConflicts?.nutritionPlanning]) {
            expect(result).not.toHaveProperty('totalKcal');
            expect(result).toMatchObject({ weight: 80, avgMacros: plan.avgMacros,
                normocalorica: { kcal: 2500 }, futureField: 'preserved' });
        }
        expect(plan).toEqual(before);
    });

    it('does not promote the pre-launch endTime alias in history or the active workout', () => {
        const workout = { id: 'current-workout', exercises: [],
            globalStartTime: 1000, globalEndTime: 2000, endTime: 500,
            futureField: 'preserved',
        };
        const before = structuredClone(workout);
        const parsed = UserDataSchema.parse({ history: [workout], activeWorkout: workout });
        for (const result of [parsed.history[0], parsed.activeWorkout,
            DomainParsers.parseWorkoutSession(workout)]) {
            expect(result).not.toHaveProperty('endTime');
            expect(result).toMatchObject({ globalStartTime: 1000, globalEndTime: 2000, futureField: 'preserved' });
        }
        expect(workout).toEqual(before);
    });

    it('should fallback to defaults when completely empty or invalid', () => {
        const parsed = UserDataSchema.parse(null);
        expect(parsed).toBeDefined();
        expect(parsed.profile).toEqual({});
        expect(parsed.library).toEqual([]);
        expect(parsed.routines).toEqual([]);
    });

    it('should strip unknown top-level keys', () => {
        const data = {
            extraKey: 'should be preserved',
            profile: { height: '180' }
        };
        const parsed = UserDataSchema.parse(data) as any;
        expect(parsed.extraKey).toBeUndefined();
        expect(parsed.profile.height).toBe('180');
    });

    it('safeParse applies the fallback for an invalid profile without throwing', () => {
        const parsed = UserDataSchema.safeParse({ profile: 'invalid string' } as any);
        expect(parsed).toMatchObject({ success: true, data: { profile: {} } });
    });
});

describe('NutritionDaySchema (Type coercion & Dates)', () => {
    it('should coerce strings to numbers where appropriate', () => {
        const data = {
            date: '2025-01-01',
            kcal: '2500', // string instead of number
            carbs: 300,
            pro: 150,
            fat: '70'
        };
        const parsed = NutritionDaySchema.parse(data);
        expect(parsed.kcal).toBe(2500);
        expect(parsed.fat).toBe(70);
    });

    it('should handle undefined or null in optional arrays without crashing', () => {
        const data = {
            date: '2025-01-01',
            meals: null
        };
        const parsed = NutritionDaySchema.parse(data);
        expect(parsed.meals).toEqual([]);
    });
});

describe('DomainParsers', () => {
    it('parseHistory should return empty array if given non-array', () => {
        const history = DomainParsers.parseHistory('invalid');
        expect(history).toEqual([]);
    });

    it('parseLibrary should filter out items without IDs', () => {
        const data = [{ id: '1', name: 'Valid' }, { name: 'Invalid' }];
        const library = DomainParsers.parseLibrary(data);
        expect(library).toHaveLength(1);
        expect(library[0].id).toBe('1');
    });
});
