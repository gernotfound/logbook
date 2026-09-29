import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/telemetryHub', () => ({
    telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() },
}));

import type { CachedGlobalCatalog, UserData } from '../src/types';
import {
    DomainParsers,
    LoggedMealItemSchema,
    SupplementIntakeSchema,
    UserDataSchema,
} from '../src/lib/schema';
import { createBackup, decodeImport } from '../src/lib/backup';
import { mergeNutrition } from '../src/lib/merge';
import { applyDomainOperations } from '../src/lib/sync/domainOperations';
import { applyRemoteDocuments, projectDocuments } from '../src/lib/sync/documentProjection';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'f003-test',
        updatedAt: '2026-09-29T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

const validMeal = {
    id: 'meal-ok',
    name: 'Riso',
    meal: 'pranzo',
    quantity: 100,
    kcal: 350,
    carbs: 75,
    pro: 7,
    fat: 1,
};

const validIntake = {
    id: 'intake-ok',
    supplementId: 'supp-ok',
    amount: 1,
    time: 123,
};

const malformedDay = {
    date: '2026-09-29',
    meals: [
        validMeal,
        { ...validMeal, id: '' },
        { ...validMeal, id: '   ' },
        { ...validMeal, id: 'bad/id' },
        { name: 'ghost', meal: 'cena', quantity: 1, kcal: 1, carbs: 0, pro: 0, fat: 0 },
    ],
    supplementsIntake: [
        validIntake,
        { ...validIntake, id: '' },
        { ...validIntake, id: 'bad/id' },
        { ...validIntake, id: 'intake-without-supplement', supplementId: '' },
    ],
};

describe('F-003 nutrition identity integrity', () => {
    it('rejects invalid business identities at the nested entity schema boundary', () => {
        expect(() => LoggedMealItemSchema.parse({ ...validMeal, id: '' })).toThrow();
        expect(() => LoggedMealItemSchema.parse({ ...validMeal, id: 'bad/id' })).toThrow();
        expect(() => SupplementIntakeSchema.parse({ ...validIntake, id: '' })).toThrow();
        expect(() => SupplementIntakeSchema.parse({ ...validIntake, supplementId: '' })).toThrow();
        expect(LoggedMealItemSchema.parse({ ...validMeal, id: 42 }).id).toBe('42');
        expect(SupplementIntakeSchema.parse({ ...validIntake, id: 7, supplementId: 9 })).toMatchObject({ id: '7', supplementId: '9' });
    });

    it('quarantines malformed nested records while preserving valid siblings during hydration parsing', () => {
        const nutrition = DomainParsers.parseNutrition({ '2026-09-29': malformedDay });

        expect(nutrition['2026-09-29'].meals?.map(item => item.id)).toEqual(['meal-ok']);
        expect(nutrition['2026-09-29'].supplementsIntake?.map(item => item.id)).toEqual(['intake-ok']);

        const parsed = UserDataSchema.parse({ nutrition: { '2026-09-29': malformedDay } }) as unknown as UserData;
        expect(parsed.nutrition?.['2026-09-29'].meals?.map(item => item.id)).toEqual(['meal-ok']);
        expect(parsed.nutrition?.['2026-09-29'].supplementsIntake?.map(item => item.id)).toEqual(['intake-ok']);
    });

    it('does not re-project or re-sync quarantined ghost records', () => {
        const base = UserDataSchema.parse({}) as unknown as UserData;
        const remoteDocuments = new Map<string, Record<string, unknown>>([
            ['nutrition_months/2026-09', { '2026-09-29': malformedDay }],
        ]);

        const hydrated = applyRemoteDocuments(base, remoteDocuments, catalog);
        const day = hydrated.nutrition?.['2026-09-29'];
        expect(day?.meals?.map(item => item.id)).toEqual(['meal-ok']);
        expect(day?.supplementsIntake?.map(item => item.id)).toEqual(['intake-ok']);

        const projected = projectDocuments(hydrated, catalog);
        const projectedDay = projected.get('nutrition_months/2026-09')?.['2026-09-29'] as any;
        expect(projectedDay.meals.map(item => item.id)).toEqual(['meal-ok']);
        expect(projectedDay.supplementsIntake.map(item => item.id)).toEqual(['intake-ok']);
    });

    it('keeps normal ID-based delete and upsert usable after malformed hydration', () => {
        const hydrated = UserDataSchema.parse({
            nutrition: { '2026-09-29': malformedDay },
        }) as unknown as UserData;

        const withoutMeal = applyDomainOperations(hydrated, {
            type: 'nutrition-meal.delete',
            date: '2026-09-29',
            mealId: 'meal-ok',
        });
        expect(withoutMeal.nutrition?.['2026-09-29'].meals).toEqual([]);

        const withNewMeal = applyDomainOperations(withoutMeal, {
            type: 'nutrition-meal.upsert',
            date: '2026-09-29',
            meal: { ...validMeal, id: 'meal-new' },
        });
        expect(withNewMeal.nutrition?.['2026-09-29'].meals?.map(item => item.id)).toEqual(['meal-new']);

        const withoutIntake = applyDomainOperations(withNewMeal, {
            type: 'supplement-intake.delete',
            date: '2026-09-29',
            intakeId: 'intake-ok',
        });
        expect(withoutIntake.nutrition?.['2026-09-29'].supplementsIntake).toEqual([]);

        const withNewIntake = applyDomainOperations(withoutIntake, {
            type: 'supplement-intake.upsert',
            date: '2026-09-29',
            intake: { ...validIntake, id: 'intake-new' },
        });
        expect(withNewIntake.nutrition?.['2026-09-29'].supplementsIntake?.map(item => item.id)).toEqual(['intake-new']);
    });

    it('drops invalid identities during nutrition merge instead of inventing synthetic IDs', () => {
        const merged = mergeNutrition(
            { '2026-09-29': malformedDay as any },
            {
                '2026-09-29': {
                    date: '2026-09-29',
                    meals: [
                        { ...validMeal, id: 'meal-guest' },
                        { ...validMeal, id: '' },
                    ],
                    supplementsIntake: [
                        { ...validIntake, id: 'intake-guest' },
                        { ...validIntake, id: '' },
                    ],
                } as any,
            },
        );

        expect(merged['2026-09-29'].meals?.map(item => item.id)).toEqual(['meal-ok', 'meal-guest']);
        expect(merged['2026-09-29'].meals?.some(item => item.id.startsWith('meal_'))).toBe(false);
        expect(merged['2026-09-29'].supplementsIntake?.map(item => item.id)).toEqual(['intake-ok', 'intake-guest']);
    });

    it('continues to reject malformed nested identities at the backup/import boundary', () => {
        const backup = createBackup(UserDataSchema.parse({}) as unknown as UserData, 'guest') as any;
        backup.userData = {
            nutrition: {
                '2026-09-29': {
                    date: '2026-09-29',
                    meals: [{ ...validMeal, id: '' }],
                },
            },
        };

        expect(() => decodeImport(backup, 'guest')).toThrow(/identificativo valido/i);

        backup.userData.nutrition['2026-09-29'].meals = [{ ...validMeal, id: 'bad/id' }];
        expect(() => decodeImport(backup, 'guest')).toThrow(/identificativo non valido/i);

        backup.userData.nutrition['2026-09-29'].meals = [validMeal];
        backup.userData.nutrition['2026-09-29'].supplementsIntake = [{ ...validIntake, supplementId: '' }];
        expect(() => decodeImport(backup, 'guest')).toThrow(/integratore senza identificativo valido/i);
    });
});
