import { z } from './zod';
import type { UserData } from '../types';
import { createDefaultNutritionPlanning } from './nutritionDefaults';
import { reportZodSchemaFallback, safeString } from './schemas/schema_utils';

export * from './schemas/schema_utils';
export * from './schemas/schema_profile';
export * from './schemas/schema_nutrition';
export * from './schemas/schema_training';
export * from './schemas/schema_catalog';

import { UserProfileSchema, LegalConsentSchema } from './schemas/schema_profile';
import { NutritionDaySchema, FoodSchema, NutritionPlanningSchema, SupplementSchema } from './schemas/schema_nutrition';
import { ExerciseSchema, WorkoutRoutineSchema, WorkoutSessionSchema, TrainingCycleSchema } from './schemas/schema_training';
import { CatalogOverridesSchema } from './schemas/schema_catalog';

export const defaultUserDataFallback: UserData = {
    profile: {},
    library: [],
    routines: [],
    history: [],
    nutrition: {},
    customFoods: [],
    activeWorkout: null,
    nutritionPlanning: createDefaultNutritionPlanning(),
    nutritionPlanningOrigin: 'generated-default' as const,
    trainingCycles: [],
    activeCycleId: null,
    supplements: [],
    activePains: [],
    catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
};

export const UserDataSchema = z.object({
    profile: UserProfileSchema.optional().catch({}).default({}),
    library: z.array(ExerciseSchema).optional().catch([]).default([]),
    routines: z.array(WorkoutRoutineSchema).optional().catch([]).default([]),
    history: z.array(WorkoutSessionSchema).optional().catch([]).default([]), // Actually stored in history_months in Firebase
    nutrition: z.record(z.string(), NutritionDaySchema).optional().catch({}).default({}), // nutrition_months
    customFoods: z.array(FoodSchema).optional().catch([]).default([]),
    activeWorkout: WorkoutSessionSchema.nullable().optional().catch(null).default(null),
    nutritionPlanning: NutritionPlanningSchema.optional().catch(undefined),
    trainingCycles: z.array(TrainingCycleSchema).optional().catch([]).default([]),
    activeCycleId: z.union([z.string(), z.null()]).optional().catch(null).default(null),
    supplements: z.array(SupplementSchema).optional().catch([]).default([]),
    activePains: z.array(safeString('')).optional().catch([]).default([]),
    catalogOverrides: CatalogOverridesSchema.optional().catch({ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }).default({ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }),
    legalConsent: LegalConsentSchema,
    nutritionPlanningOrigin: z.enum(['generated-default', 'user-edited']).optional().catch(undefined),
    pendingConflicts: z.object({
        nutritionPlanning: NutritionPlanningSchema.optional().catch(undefined)
    }).optional().catch(undefined),

}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'UserDataSchema',
        fallbackUsed: 'defaultUserDataFallback',
        error: ctx?.error,
    });
    return defaultUserDataFallback as any;
}).default(defaultUserDataFallback as any);

const isValidParsedId = (id: unknown) =>
    (typeof id === 'string' && id.trim().length > 0) || (typeof id === 'number' && Number.isFinite(id));

export function quarantineCorruptedRecord(context: {
    collection: string;
    raw: unknown;
    error?: unknown;
}): void {
    reportZodSchemaFallback({
        schema: context.collection,
        field: 'quarantine',
        fallbackUsed: 'record_quarantined',
        error: context.error,
    });
}

export const DomainParsers = {
    // Oggetti singoli: fallback al default schema in caso di dato corrotto
    parseProfile: (data: unknown) => {
        return UserProfileSchema.parse(data);
    },
    parseWorkoutSession: (data: unknown) => {
        return WorkoutSessionSchema.parse(data);
    },
    parseNutritionPlanning: (data: unknown) => {
        if (data === null || data === undefined) return null;
        return NutritionPlanningSchema.parse(data);
    },
    parseLegalConsent: (data: unknown) => {
        if (data === null || data === undefined) return undefined;
        return LegalConsentSchema.parse(data);
    },
    // Array: sanifica i singoli elementi con sub-schema fallbacks
    parseHistory: (data: unknown) => {
        if (!Array.isArray(data)) {
            if (data !== undefined && data !== null) {
                reportZodSchemaFallback({
                    schema: 'WorkoutSessionSchema',
                    field: 'history',
                    fallbackUsed: 'empty_array',
                    receivedType: typeof data,
                    issueCode: 'invalid_type',
                    expectedType: 'array',
                });
            }
            return [];
        }
        return data.map((item) => {
            try {
                return WorkoutSessionSchema.parse(item);
            } catch (e) {
                quarantineCorruptedRecord({ collection: 'history', raw: item, error: e });
                return { exercises: [], pains: [] };
            }
        });
    },
    parseLibrary: (data: unknown) => {
        if (!Array.isArray(data)) {
            if (data !== undefined && data !== null) {
                reportZodSchemaFallback({
                    schema: 'ExerciseSchema',
                    field: 'library',
                    fallbackUsed: 'empty_array',
                    receivedType: typeof data,
                    issueCode: 'invalid_type',
                    expectedType: 'array',
                });
            }
            return [];
        }
        return data.map((item) => ExerciseSchema.parse(item)).filter(item => isValidParsedId(item.id));
    },
    parseCustomFoods: (data: unknown) => {
        if (!Array.isArray(data)) {
            if (data !== undefined && data !== null) {
                reportZodSchemaFallback({
                    schema: 'FoodSchema',
                    field: 'customFoods',
                    fallbackUsed: 'empty_array',
                    receivedType: typeof data,
                    issueCode: 'invalid_type',
                    expectedType: 'array',
                });
            }
            return [];
        }
        return data.map((item) => FoodSchema.parse(item)).filter(item => isValidParsedId(item.id));
    },
    parseRoutines: (data: unknown) => {
        if (!Array.isArray(data)) {
            if (data !== undefined && data !== null) {
                reportZodSchemaFallback({
                    schema: 'WorkoutRoutineSchema',
                    field: 'routines',
                    fallbackUsed: 'empty_array',
                    receivedType: typeof data,
                    issueCode: 'invalid_type',
                    expectedType: 'array',
                });
            }
            return [];
        }
        return data.map((item) => {
            try {
                return WorkoutRoutineSchema.parse(item);
            } catch (e) {
                quarantineCorruptedRecord({ collection: 'routines', raw: item, error: e });
                return { id: '', name: '', exercises: [] };
            }
        }).filter(item => isValidParsedId(item.id));
    },
    parseTrainingCycles: (data: unknown) => {
        if (!Array.isArray(data)) {
            if (data !== undefined && data !== null) {
                reportZodSchemaFallback({
                    schema: 'TrainingCycleSchema',
                    field: 'trainingCycles',
                    fallbackUsed: 'empty_array',
                    receivedType: typeof data,
                    issueCode: 'invalid_type',
                    expectedType: 'array',
                });
            }
            return [];
        }
        return data.map((item) => TrainingCycleSchema.parse(item)).filter(item => isValidParsedId(item.id));
    },
    parseSupplements: (data: unknown) => {
        if (!Array.isArray(data)) {
            if (data !== undefined && data !== null) {
                reportZodSchemaFallback({
                    schema: 'SupplementSchema',
                    field: 'supplements',
                    fallbackUsed: 'empty_array',
                    receivedType: typeof data,
                    issueCode: 'invalid_type',
                    expectedType: 'array',
                });
            }
            return [];
        }
        return data.map((item) => SupplementSchema.parse(item)).filter(item => isValidParsedId(item.id));
    },
    parseActivePains: (data: unknown) => {
        if (!Array.isArray(data)) {
            if (data !== undefined && data !== null) {
                reportZodSchemaFallback({
                    schema: 'UserDataSchema',
                    field: 'activePains',
                    fallbackUsed: 'empty_array',
                    receivedType: typeof data,
                    issueCode: 'invalid_type',
                    expectedType: 'array',
                });
            }
            return [];
        }
        return data.filter((item): item is string => {
            const isStr = typeof item === 'string' && item.trim().length > 0;
            if (!isStr && item !== null && item !== undefined && item !== '') {
                reportZodSchemaFallback({
                    schema: 'UserDataSchema',
                    field: 'activePains[]',
                    fallbackUsed: 'entry_discarded',
                    receivedType: typeof item,
                    issueCode: 'invalid_type',
                    expectedType: 'string',
                });
            }
            return isStr;
        });
    },
    parseNutrition: (data: unknown) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            if (data !== undefined && data !== null) {
                reportZodSchemaFallback({
                    schema: 'NutritionDaySchema',
                    field: 'nutrition',
                    fallbackUsed: 'empty_record',
                    receivedType: Array.isArray(data) ? 'array' : typeof data,
                    issueCode: 'invalid_type',
                    expectedType: 'object',
                });
            }
            return {};
        }
        const result: Record<string, z.infer<typeof NutritionDaySchema>> = {};
        for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
            result[key] = NutritionDaySchema.parse(val);
        }
        return result;
    },
};

// ==========================================
// Application Tab & Navigation Schemas (ARCH-05)
// ==========================================

export const AppTabSchema = z.enum(['home', 'training', 'nutrition', 'data', 'settings']);
export const MainTabSchema = AppTabSchema;
export const TrainingSubTabSchema = z.enum(['session', 'planning', 'routines', 'exercises', 'history']);
export const NutritionSubTabSchema = z.enum(['meals', 'planning', 'archive', 'history', 'supplements']);
export const DataSubTabSchema = z.enum(['measurements', 'sleep', 'biometry', 'history']);
