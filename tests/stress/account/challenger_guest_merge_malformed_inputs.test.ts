import { describe, it, expect } from 'vitest';
import { mergeUserData, mergeArrayById, mergeNutrition, mergeProfile } from '../../../src/lib/merge';
import type { UserData } from '../../../src/types';

describe('Empirical Challenger: Deterministic Guest Merge (R5) Stress & Adversarial Suite', () => {

    describe('3. Edge Cases, Missing Fields, Null/Undefined, and Malformed Payload Resistance', () => {
        it('quarantines invalid identities and rejects non-array collections', () => {
            const cloudWithNulls = [
                null,
                { id: '1', name: 'Item 1' },
                undefined,
                { id: '', name: 'No ID Item' },
                { id: '2', name: 'Item 2' }
            ] as any;

            const guestWithNulls = [
                undefined,
                { id: '2', name: 'Item 2 Guest' },
                null,
                { id: '3', name: 'Item 3 Guest' }
            ] as any;

            const merged = mergeArrayById(cloudWithNulls as Array<{ id: string; name: string }>, guestWithNulls as Array<{ id: string; name: string }>);
            expect(merged).toEqual([
                { id: '1', name: 'Item 1' },
                { id: '2', name: 'Item 2 Guest' },
                { id: '3', name: 'Item 3 Guest' },
            ]);
            expect(mergeArrayById([{ id: 'valid', name: 'Valid' }], {} as any))
                .toEqual([{ id: 'valid', name: 'Valid' }]);
        });

        it('safely handles meal items with zero baseQty, negative baseQty, or string quantities during nutrition merge', () => {
            const cloudDay = {
                date: '2026-08-16',
                kcal: 0,
                carbs: 0,
                pro: 0,
                fat: 0,
                meals: [
                    { id: 'm1', name: 'Zero Base Food', quantity: 100, baseQty: 0, kcal: 100, carbs: 10, pro: 10, fat: 0 },
                    { id: 'm2', name: 'Negative Base Food', quantity: 50, baseQty: -100, kcal: 200, carbs: 20, pro: 20, fat: 0 },
                    { id: 'm3', name: 'String Val Food', quantity: '150' as any, baseQty: '100' as any, kcal: '100' as any, carbs: '10' as any, pro: '5' as any, fat: '2' as any }
                ]
            };

            const guestDay = {
                date: '2026-08-16',
                kcal: 0,
                carbs: 0,
                pro: 0,
                fat: 0,
                meals: [
                    { id: 'm4', name: 'Guest Food', quantity: 100, baseQty: 100, kcal: 150, carbs: 15, pro: 10, fat: 5 }
                ]
            };

            // 1. Direct mergeNutrition on colliding date
            const mergedColliding = mergeNutrition({ '2026-08-16': cloudDay as any }, { '2026-08-16': guestDay as any });
            const dayColliding = mergedColliding['2026-08-16'];
            expect(dayColliding).toBeDefined();
            expect(Number.isFinite(dayColliding.kcal)).toBe(true);
            expect(Number.isFinite(dayColliding.carbs)).toBe(true);
            expect(Number.isFinite(dayColliding.pro)).toBe(true);
            expect(Number.isFinite(dayColliding.fat)).toBe(true);
            expect(dayColliding).toMatchObject({ kcal: 500, carbs: 50, pro: 37.5, fat: 8 });

            // 2. mergeUserData with one-sided date without kcal property passes schema sanitization
            const cloudWithoutKcal = {
                nutrition: {
                    '2026-08-17': {
                        date: '2026-08-17',
                        meals: [{ id: 'm_lone', name: 'Lone Meal', quantity: 100, kcal: 200, carbs: 20, pro: 10, fat: 5 }]
                    } as any
                }
            };
            const sanitizedResult = mergeUserData(cloudWithoutKcal, {});
            expect(sanitizedResult.nutrition?.['2026-08-17']).toBeDefined();
            expect(Number.isFinite(sanitizedResult.nutrition?.['2026-08-17']?.kcal)).toBe(true);
            expect(sanitizedResult.nutrition?.['2026-08-17']?.kcal).toBe(0);
        });

        it('merges profile with empty strings, nulls, and undefined without obliterating valid cloud data', () => {
            const cloudProfile = {
                dob: '1995-05-15',
                height: '182',
                gender: 'M',
                neck: '41',
                waist: '86',
                hip: '98',
                chest: '108',
                shoulders: '124',
                biceps: '39',
                thighs: '60',
                calves: '38'
            };

            const guestProfile = {
                dob: undefined,
                height: null as any,
                gender: '', // empty string should NOT overwrite 'M'
                neck: '42', // updated
                waist: '', // empty string should NOT overwrite '86'
                biceps: '40', // updated
            };

            const merged = mergeProfile(cloudProfile, guestProfile);
            expect(merged.dob).toBe('1995-05-15');
            expect(merged.height).toBe('182');
            expect(merged.gender).toBe('M');
            expect(merged.neck).toBe('42');
            expect(merged.waist).toBe('86');
            expect(merged.biceps).toBe('40');
            expect(merged.chest).toBe('108');
        });

        it('survives malformed UserData inputs and schema parsing sanitizes to valid structures', () => {
            const malformedCloud = {
                profile: { height: 180 as any },
                library: [{ id: 'ex1', name: 12345 as any, setsCount: 'three' as any }],
                routines: [{ id: 'r1', name: 'Routine 1', exercises: [{ exId: 'ex1', setsCount: -5 }] }],
                history: [{ id: 'h1', moodRating: 'invalid' as any, waterLiters: '2.5' as any }],
                nutrition: {
                    '2026-08-16': {
                        date: '2026-08-16',
                        kcal: 'not-num' as any,
                        carbs: NaN,
                        meals: [{ id: 'm1', name: 'Test', quantity: 'invalid' as any, kcal: 'abc' as any }]
                    }
                },
                customFoods: [{ name: 'Bad Food', kcal: NaN, pro: 'twenty' as any }],
                activeWorkout: { id: 'w1', moodRating: 'bad' as any },
                trainingCycles: [{ id: 'c1', name: 'Cycle', durationWeeks: 'four' as any }],
                supplements: [{ id: 's1', name: 'Supp', target: 'none' as any }]
            } as any;

            const malformedGuest = {
                profile: { waist: 82 as any },
                nutritionPlanning: {
                    weight: 'eighty' as any,
                    normocalorica: { kcal: 'two-thousand' as any }
                }
            } as any;

            // mergeUserData should run schema validation and sanitize everything cleanly without throwing
            const result = mergeUserData(malformedCloud, malformedGuest);
            expect(result).toBeDefined();
            expect(result.library).toHaveLength(1);
            expect(typeof result.library?.[0]?.name).toBe('string');
            expect(result.history).toHaveLength(1);
            expect(result.history?.[0]?.waterLiters).toBe(2.5); // string '2.5' converted to number
            expect(result.nutrition?.['2026-08-16']).toBeDefined();
            expect(Number.isFinite(result.nutrition?.['2026-08-16']?.kcal)).toBe(true);
        });

        it('resists prototype pollution and malicious property injection', () => {
            const maliciousPayload = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"injected": "yes"}}}');
            const guestData: UserData = {
                profile: maliciousPayload,
                library: [{ id: 'ex_safe', name: 'Safe Ex', setsCount: 3, sets: [] }]
            };

            const merged = mergeUserData({}, guestData);
            expect((Object.prototype as any).polluted).toBeUndefined();
            expect((Object.prototype as any).injected).toBeUndefined();
            expect(merged.library?.[0]?.id).toBe('ex_safe');
        });
    });

});
