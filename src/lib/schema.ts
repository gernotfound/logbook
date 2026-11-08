import { z } from './zod';
import type { UserData } from '../types';
import { createDefaultNutritionPlanning } from './nutritionDefaults';
import { isValidBusinessId, normalizeBusinessId } from './businessIdentity';
import { parseDateInput } from './utils/date';
import { safeString } from './schemas/schema_utils';

export * from './schemas/schema_utils';
export * from './schemas/schema_profile';
export * from './schemas/schema_nutrition';
export * from './schemas/schema_training';
export * from './schemas/schema_catalog';

import { UserProfileSchema, LegalConsentSchema } from './schemas/schema_profile';
import { NutritionDaySchema, FoodSchema, NutritionPlanningSchema, SupplementSchema } from './schemas/schema_nutrition';
import { ExerciseSchema, WorkoutRoutineSchema, WorkoutSessionSchema, TrainingCycleSchema } from './schemas/schema_training';
import { CatalogOverridesSchema } from './schemas/schema_catalog';


const normalizePersistedWorkoutId = (record: unknown): string | null => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    return normalizeBusinessId((record as { id?: unknown }).id);
};

const sanitizeWorkoutHistory = (data: unknown): unknown[] => {
    if (data === undefined) return [];
    if (!Array.isArray(data)) {
        return [];
    }

    const result: unknown[] = [];
    const seen = new Set<string>();
    for (const raw of data) {
        const id = normalizePersistedWorkoutId(raw);
        if (!id || seen.has(id)) {
            continue;
        }

        const parsed = WorkoutSessionSchema.parse(raw);
        seen.add(id);
        result.push({ ...parsed, id });
    }
    return result;
};

const WorkoutHistorySchema = z.preprocess(
    sanitizeWorkoutHistory,
    z.array(WorkoutSessionSchema),
).default([]);

const sanitizePersistedActiveWorkout = (data: unknown): unknown => {
    if (data === undefined || data === null) return null;

    const id = normalizePersistedWorkoutId(data);
    if (!id) {
        return null;
    }

    return { ...(data as Record<string, unknown>), id };
};

const PersistedActiveWorkoutSchema = z.preprocess(
    sanitizePersistedActiveWorkout,
    WorkoutSessionSchema.nullable(),
).catch(null).default(null);

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

function sanitizeTopLevelIdentityCollection(
    value: unknown,
    schema: { safeParse: (input: unknown) => { success: boolean; data?: any; error?: unknown } },
): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        return [];
    }
    const result: unknown[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        const parsed = schema.safeParse(raw);
        const id = parsed.success ? normalizeBusinessId(parsed.data?.id) : null;
        if (!parsed.success || !id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        result.push({ ...parsed.data, id });
    }
    return result;
}

export const UserDataSchema = z.object({
    profile: UserProfileSchema.optional().catch({}).default({}),
    library: z.preprocess(value => sanitizeTopLevelIdentityCollection(value, ExerciseSchema), z.array(ExerciseSchema)).default([]),
    routines: z.preprocess(value => sanitizeTopLevelIdentityCollection(value, WorkoutRoutineSchema), z.array(WorkoutRoutineSchema)).default([]),
    history: WorkoutHistorySchema, // Actually stored in history_months in Firebase
    nutrition: z.record(z.string(), NutritionDaySchema).optional().catch({}).default({}), // nutrition_months
    customFoods: z.preprocess(value => sanitizeTopLevelIdentityCollection(value, FoodSchema), z.array(FoodSchema)).default([]),
    activeWorkout: PersistedActiveWorkoutSchema,
    nutritionPlanning: NutritionPlanningSchema.optional().catch(undefined),
    trainingCycles: z.preprocess(value => sanitizeTopLevelIdentityCollection(value, TrainingCycleSchema), z.array(TrainingCycleSchema)).default([]),
    activeCycleId: z.union([z.string(), z.null()]).optional().catch(null).default(null),
    supplements: z.preprocess(value => sanitizeTopLevelIdentityCollection(value, SupplementSchema), z.array(SupplementSchema)).default([]),
    activePains: z.array(safeString('')).optional().catch([]).default([]),
    catalogOverrides: CatalogOverridesSchema.optional().catch({ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }).default({ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }),
    legalConsent: LegalConsentSchema,
    nutritionPlanningOrigin: z.enum(['generated-default', 'user-edited']).optional().catch(undefined),
    pendingConflicts: z.object({
        nutritionPlanning: NutritionPlanningSchema.optional().catch(undefined)
    }).optional().catch(undefined),

}).catch(() => {
    return defaultUserDataFallback as any;
}).default(defaultUserDataFallback as any);

const isValidParsedId = isValidBusinessId;

export const DomainParsers = {
    // Oggetti singoli: fallback al default schema in caso di dato corrotto
    parseProfile: (data: unknown) => {
        return UserProfileSchema.parse(data);
    },
    parseWorkoutSession: (data: unknown) => {
        return WorkoutSessionSchema.parse(data);
    },
    parseActiveWorkout: (data: unknown) => {
        return PersistedActiveWorkoutSchema.parse(data);
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
        return WorkoutHistorySchema.parse(data);
    },
    parseLibrary: (data: unknown) => {
        if (!Array.isArray(data)) {
            return [];
        }
        return data.map((item) => ExerciseSchema.parse(item)).filter(item => isValidParsedId(item.id));
    },
    parseCustomFoods: (data: unknown) => {
        if (!Array.isArray(data)) {
            return [];
        }
        return data.map((item) => FoodSchema.parse(item)).filter(item => isValidParsedId(item.id));
    },
    parseRoutines: (data: unknown) => {
        if (!Array.isArray(data)) {
            return [];
        }
        return data.map((item) => {
            try {
                return WorkoutRoutineSchema.parse(item);
            } catch {
                return { id: '', name: '', exercises: [] };
            }
        }).filter(item => isValidParsedId(item.id));
    },
    parseTrainingCycles: (data: unknown) => {
        if (!Array.isArray(data)) {
            return [];
        }
        return data.map((item) => TrainingCycleSchema.parse(item)).filter(item => isValidParsedId(item.id));
    },
    parseSupplements: (data: unknown) => {
        if (!Array.isArray(data)) {
            return [];
        }
        return data.map((item) => SupplementSchema.parse(item)).filter(item => isValidParsedId(item.id));
    },
    parseActivePains: (data: unknown) => {
        if (!Array.isArray(data)) {
            return [];
        }
        return data.filter((item): item is string => {
            const isStr = typeof item === 'string' && item.trim().length > 0;
            return isStr;
        });
    },
    parseNutrition: (data: unknown) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return {};
        }
        const result: Record<string, z.infer<typeof NutritionDaySchema>> = {};
        for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
            // The final authoritative gateway must reject invalid dates before
            // a dynamic key such as "__proto__" can disappear into an object prototype.
            if (parseDateInput(key) !== key) throw new Error(`Giornata nutrizione non valida: ${key}`);
            const day = NutritionDaySchema.parse(val);
            if (day.date !== key) throw new Error(`Giornata nutrizione incoerente: ${key}`);
            Object.defineProperty(result, key, { value: day, enumerable: true, writable: true, configurable: true });
        }
        return result;
    },
};

// ==========================================
// Application Tab & Navigation Schemas (ARCH-05)
// ==========================================

export const AppTabSchema = z.enum(['home', 'training', 'nutrition', 'data']);
export const MainTabSchema = AppTabSchema;
export const TrainingSubTabSchema = z.enum(['session', 'planning', 'routines', 'exercises', 'history']);
export const NutritionSubTabSchema = z.enum(['meals', 'planning', 'archive', 'history', 'supplements']);
export const DataSubTabSchema = z.enum(['measurements', 'sleep', 'activity', 'biometry', 'history']);
