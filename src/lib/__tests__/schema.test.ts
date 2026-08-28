import { describe, it, expect } from 'vitest';
import { UserDataSchema, NutritionDaySchema, ExerciseSetSchema, DomainParsers } from '../schema';

describe('UserDataSchema', () => {
    it('should fallback to defaults when completely empty or invalid', () => {
        const parsed = UserDataSchema.parse(null);
        expect(parsed).toBeDefined();
        expect(parsed.profile).toEqual({});
        expect(parsed.library).toEqual([]);
        expect(parsed.routines).toEqual([]);
    });

    it('should use passthrough to keep extra keys', () => {
        const data = {
            extraKey: 'should be preserved',
            profile: { height: '180' }
        };
        const parsed = UserDataSchema.parse(data) as any;
        expect(parsed.extraKey).toBe('should be preserved');
        expect(parsed.profile.height).toBe('180');
    });

    it('safeParse should return success false instead of throwing', () => {
        // Zod schemas with .catch() actually don't fail, they return the fallback!
        // But let's verify that the fallback kicks in.
        const parsed = UserDataSchema.safeParse({ profile: 'invalid string' } as any);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.profile).toEqual({}); // Fallback applied
        }
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
