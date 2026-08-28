import { z } from 'zod';
import { formatSleepTime } from './utils/date';
import { telemetryHub } from './telemetryHub';

export interface ZodFallbackContext {
    schema: string;
    field?: string;
    fallbackUsed?: string;
    expectedType?: string;
    receivedType?: string;
    issueCode?: string;
    error?: unknown;
}

export type SchemaFallbackListener = (context: ZodFallbackContext) => void;
let customFallbackListener: SchemaFallbackListener | null = null;

export function setSchemaFallbackListener(listener: SchemaFallbackListener | null): void {
    customFallbackListener = listener;
}

export function reportZodSchemaFallback(ctx: ZodFallbackContext): void {
    try {
        if (customFallbackListener) {
            try {
                customFallbackListener(ctx);
            } catch {
                // Safe fail-through
            }
        }

        if (typeof telemetryHub === 'undefined' || !telemetryHub) return;

        let expectedType = ctx.expectedType;
        let receivedType = ctx.receivedType;
        let issueCode = ctx.issueCode;
        let fieldPath = ctx.field;

        if (ctx.error && typeof ctx.error === 'object' && 'issues' in (ctx.error as any)) {
            const issues = (ctx.error as any).issues;
            if (Array.isArray(issues) && issues.length > 0) {
                const first = issues[0];
                if (first) {
                    if (!issueCode) issueCode = first.code || 'validation_error';
                    if (!fieldPath && Array.isArray(first.path) && first.path.length > 0) {
                        fieldPath = first.path.join('.');
                    }
                    if (!expectedType && 'expected' in first && first.expected !== undefined) {
                        expectedType = String(first.expected);
                    }
                    if (!receivedType && 'received' in first && first.received !== undefined) {
                        receivedType = String(first.received);
                    }
                }
            }
        }

        const safeIssueCode = issueCode || 'validation_fallback';
        const safeField = fieldPath || 'root';
        const safeFallback = ctx.fallbackUsed || 'default';

        const typeInfo = (expectedType && receivedType) ? ` (expected ${expectedType}, received ${receivedType})` : '';
        const syntheticMessage = `Zod fallback in ${ctx.schema} [${safeField}]: ${safeIssueCode}${typeInfo}`;

        // 1. Dispatch Telemetry Event (without raw corrupted values or PII)
        if (typeof telemetryHub.trackEvent === 'function') {
            telemetryHub.trackEvent('zod_schema_fallback', {
                schema: ctx.schema,
                field: safeField,
                issueCode: safeIssueCode,
                expectedType: expectedType || 'unknown',
                receivedType: receivedType || 'unknown',
                fallbackUsed: safeFallback,
            });
        }

        // 2. Dispatch Telemetry Error (deduplicated by telemetryHub)
        if (typeof telemetryHub.trackError === 'function') {
            const fallbackError = new Error(syntheticMessage);
            fallbackError.name = 'ZodSchemaFallbackError';
            telemetryHub.trackError(fallbackError, {
                source: 'zod_schema_fallback',
                customMessage: syntheticMessage,
            });
        }
    } catch {
        // Safe non-blocking guarantee: schema parsing must never fail because of telemetry
    }
}

// Defensive conversion helpers for robust runtime sanitization
const safeOptionalSleepTime = () =>
    z.union([
        z.string().transform(v => {
            const trimmed = v.trim();
            if (!trimmed) return undefined;
            const formatted = formatSleepTime(trimmed);
            return formatted || undefined;
        }),
        z.number().transform(v => {
            if (isNaN(v)) return undefined;
            const formatted = formatSleepTime(v);
            return formatted || undefined;
        })
    ]).optional().catch(undefined);

const safeNumber = (defaultVal = 0) =>
    z.union([
        z.number().refine(v => !isNaN(v), { message: "NaN is not a valid number" }),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return defaultVal;
            const num = Number(trimmed);
            return isNaN(num) ? defaultVal : num;
        })
    ]).catch(defaultVal).default(defaultVal);

const safeOptionalNumber = () =>
    z.union([
        z.number().refine(v => !isNaN(v), { message: "NaN is not a valid number" }),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return undefined;
            const num = Number(trimmed);
            return isNaN(num) ? undefined : num;
        })
    ]).optional().catch(undefined);

const safeOptionalNullableNumber = () =>
    z.union([
        z.number().refine(v => !isNaN(v)),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return null;
            const num = Number(trimmed);
            return isNaN(num) ? null : num;
        }),
        z.null()
    ]).optional().catch(null);

const safeString = (defaultVal = '') =>
    z.union([
        z.string(),
        z.number().transform(v => String(v)),
    ]).catch(defaultVal).default(defaultVal);

const safeOptionalString = () =>
    z.union([
        z.string(),
        z.number().transform(v => String(v)),
    ]).optional().catch(undefined);

const safeBoolean = (defaultVal = false) =>
    z.union([
        z.boolean(),
        z.string().transform(v => v === 'true' || v === '1'),
        z.number().transform(v => v === 1),
    ]).catch(defaultVal).default(defaultVal);

const safeOptionalBoolean = () =>
    z.union([
        z.boolean(),
        z.string().transform(v => v === 'true' || v === '1'),
        z.number().transform(v => v === 1),
    ]).optional().catch(undefined);

export const UserProfileSchema = z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
        const hip = (val.hip !== undefined && val.hip !== null && val.hip !== '') ? val.hip : val.hips;
        return {
            ...val,
            hip: hip !== undefined ? hip : undefined,
        };
    }
    return val;
}, z.object({
    dob: safeOptionalString(),
    height: safeOptionalString(),
    gender: safeOptionalString(),
    neck: safeOptionalString(),
    waist: safeOptionalString(),
    hip: safeOptionalString(),
    hips: safeOptionalString(),
    manualBf: safeOptionalString(),
    chest: safeOptionalString(),
    shoulders: safeOptionalString(),
    biceps: safeOptionalString(),
    thighs: safeOptionalString(),
    calves: safeOptionalString(),
}).passthrough()).catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'UserProfileSchema',
        fallbackUsed: 'default_empty_profile',
        error: ctx?.error,
    });
    return {};
}).default({});

export const MacroTargetSchema = z.object({
    kcal: safeNumber(0),
    carbs: safeNumber(0),
    pro: safeNumber(0),
    fat: safeNumber(0),
}).passthrough().catch({ kcal: 0, carbs: 0, pro: 0, fat: 0 }).default({ kcal: 0, carbs: 0, pro: 0, fat: 0 });

export const MacroRatioSchema = z.object({
    carbsPerKg: safeNumber(0),
    proPerKg: safeNumber(0),
    fatPerKg: safeNumber(0),
}).passthrough().catch({ carbsPerKg: 0, proPerKg: 0, fatPerKg: 0 }).default({ carbsPerKg: 0, proPerKg: 0, fatPerKg: 0 });

export const MacroBoostSchema = z.object({
    carbsPercent: safeNumber(0),
    proPercent: safeNumber(0),
    fatPercent: safeNumber(0),
}).passthrough().catch({ carbsPercent: 0, proPercent: 0, fatPercent: 0 }).default({ carbsPercent: 0, proPercent: 0, fatPercent: 0 });

export const PartialMacroTargetSchema = z.object({
    kcal: safeOptionalNumber(),
    carbs: safeOptionalNumber(),
    pro: safeOptionalNumber(),
    fat: safeOptionalNumber(),
}).passthrough().optional().catch(undefined);

export const NutritionPlanningSchema = z.object({
    weight: safeOptionalNumber(),
    onDaysCount: safeOptionalNumber(),
    avgMacros: MacroRatioSchema.optional().catch(undefined),
    onBoost: MacroBoostSchema.optional().catch(undefined),
    onMacros: MacroRatioSchema.optional().catch(undefined),
    offMacros: MacroRatioSchema.optional().catch(undefined),
    notes: safeOptionalString(),
    carbsPerKg: safeOptionalNumber(),
    proPerKg: safeOptionalNumber(),
    fatPerKg: safeOptionalNumber(),
    lockedMacro: z.union([z.string(), z.null()]).optional().catch(undefined),
    chartPeriod: safeOptionalNumber(),
    normocalorica: PartialMacroTargetSchema.optional().catch(undefined),
    totalKcal: safeOptionalNumber(),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'NutritionPlanningSchema',
        fallbackUsed: 'default_empty_planning',
        error: ctx?.error,
    });
    return {};
}).default({});

export const ExerciseSetSchema = z.object({
    weight: safeString(''),
    reps: safeString(''),
    time: safeOptionalString(),
    done: safeBoolean(false),
}).passthrough().catch({ weight: '', reps: '', done: false }).default({ weight: '', reps: '', done: false });

export const ExerciseSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    notes: safeOptionalString(),
    setsCount: safeNumber(0),
    muscles: z.array(safeString('')).optional().catch([]).default([]),
    secondaryMuscles: z.array(safeString('')).optional().catch([]).default([]),
    sets: z.array(ExerciseSetSchema).catch([]).default([]),
    trackingType: z.enum(['weight_reps', 'time', 'cardio']).optional().catch(undefined),
    isDefault: safeOptionalBoolean(),
    isBodyweight: safeOptionalBoolean(),
    equipmentWeight: safeOptionalNumber(),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'ExerciseSchema',
        fallbackUsed: 'default_empty_exercise',
        error: ctx?.error,
    });
    return { id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] };
}).default({ id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] });

export const RoutineExerciseSchema = z.object({
    exId: safeString(''),
    setsCount: safeNumber(0),
    minReps: safeOptionalNumber(),
    maxReps: safeOptionalNumber(),
    defaultTechnique: z.enum(['none', 'dropset', 'isometrics']).optional().catch(undefined),
}).passthrough().catch({ exId: '', setsCount: 0 }).default({ exId: '', setsCount: 0 });

export const WorkoutRoutineSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    exercises: z.array(RoutineExerciseSchema).catch([]).default([]),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'WorkoutRoutineSchema',
        fallbackUsed: 'default_empty_routine',
        error: ctx?.error,
    });
    return { id: '', name: '', exercises: [] };
}).default({ id: '', name: '', exercises: [] });

export const SessionExerciseDropsetSchema = z.object({
    id: safeString(''),
    kg: safeString(''),
    reps: safeString(''),
}).passthrough().catch({ id: '', kg: '', reps: '' }).default({ id: '', kg: '', reps: '' });

export const SessionExerciseIsometricSchema = z.object({
    id: safeString(''),
    kg: safeString(''),
    time: safeString(''),
}).passthrough().catch({ id: '', kg: '', time: '' }).default({ id: '', kg: '', time: '' });

export const SessionExerciseSetSchema = z.object({
    id: safeString(''),
    kg: safeString(''),
    reps: safeString(''),
    time: safeOptionalString(),
    distance: safeOptionalString(),
    speed: safeOptionalString(),
    incline: safeOptionalString(),
    kcal: safeOptionalString(),
    done: safeOptionalBoolean(),
    dropsets: z.array(SessionExerciseDropsetSchema).optional().catch([]).default([]),
    isometrics: z.array(SessionExerciseIsometricSchema).optional().catch([]).default([]),
}).passthrough().catch({ id: '', kg: '', reps: '', dropsets: [], isometrics: [] }).default({ id: '', kg: '', reps: '', dropsets: [], isometrics: [] });

export const SessionExerciseSchema = z.object({
    id: safeOptionalString(),
    exId: safeString(''),
    sessionNote: safeString(''),
    sets: z.array(SessionExerciseSetSchema).catch([]).default([]),
    minReps: safeOptionalNumber(),
    maxReps: safeOptionalNumber(),
}).passthrough().catch({ exId: '', sessionNote: '', sets: [] }).default({ exId: '', sessionNote: '', sets: [] });

export const WorkoutSessionSchema = z.object({
    id: safeOptionalString(),
    routineId: safeOptionalString(),
    routineName: safeOptionalString(),
    cycleId: safeOptionalString(),
    cycleName: safeOptionalString(),
    date: safeOptionalString(),
    globalStartTime: safeOptionalNumber(),
    globalEndTime: safeOptionalNumber(),
    globalDurationStr: safeOptionalString(),
    manualDurationStr: safeOptionalString(),
    moodRating: safeOptionalNullableNumber(),
    pumpRating: safeOptionalNullableNumber(),
    fatigueRating: safeOptionalNullableNumber(),
    waterLiters: safeOptionalNumber(),
    endTime: safeOptionalNumber(),
    exercises: z.array(SessionExerciseSchema).catch([]).default([]),
    isEditingHistory: safeOptionalBoolean(),
    originalHistoryId: safeOptionalString(),
    pains: z.array(safeString('')).optional().catch([]).default([]),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'WorkoutSessionSchema',
        fallbackUsed: 'default_empty_session',
        error: ctx?.error,
    });
    return { exercises: [], pains: [] };
}).default({ exercises: [], pains: [] });

export const LoggedMealItemSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    meal: safeString(''),
    quantity: safeNumber(0),
    baseQty: safeOptionalNumber(),
    unit: safeOptionalString(),
    kcal: safeNumber(0),
    carbs: safeNumber(0),
    pro: safeNumber(0),
    fat: safeNumber(0),
    time: safeOptionalNumber(),
    foodId: z.union([z.string(), z.number()]).optional().catch(undefined),
    brand: safeOptionalString(),
}).passthrough().catch({ id: '', name: '', meal: '', quantity: 0, kcal: 0, carbs: 0, pro: 0, fat: 0 }).default({ id: '', name: '', meal: '', quantity: 0, kcal: 0, carbs: 0, pro: 0, fat: 0 });

export const MealSchema = LoggedMealItemSchema;
export const RoutineSchema = WorkoutRoutineSchema;
export const ExerciseLibraryItemSchema = ExerciseSchema;

export const SupplementSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    unit: safeString(''),
    target: safeOptionalNumber(),
    portion: safeOptionalNumber(),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'SupplementSchema',
        fallbackUsed: 'default_empty_supplement',
        error: ctx?.error,
    });
    return { id: '', name: '', unit: '' };
}).default({ id: '', name: '', unit: '' });

export const SupplementIntakeSchema = z.object({
    id: safeString(''),
    supplementId: safeString(''),
    amount: safeNumber(0),
    time: safeNumber(0),
}).passthrough().catch({ id: '', supplementId: '', amount: 0, time: 0 }).default({ id: '', supplementId: '', amount: 0, time: 0 });

export const NutritionDaySchema = z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
        const hip = (val.hip !== undefined && val.hip !== null && val.hip !== '') ? val.hip : val.hips;
        return {
            ...val,
            hip: hip !== undefined ? hip : undefined,
        };
    }
    return val;
}, z.object({
    date: safeString(''),
    kcal: safeNumber(0),
    carbs: safeNumber(0),
    pro: safeNumber(0),
    fat: safeNumber(0),
    weight: safeOptionalNumber(),
    bf: safeOptionalNumber(),
    neck: safeOptionalNumber(),
    waist: safeOptionalNumber(),
    hip: safeOptionalNumber(),
    hips: safeOptionalNumber(),
    chest: safeOptionalNumber(),
    shoulders: safeOptionalNumber(),
    biceps: safeOptionalNumber(),
    thighs: safeOptionalNumber(),
    calves: safeOptionalNumber(),
    measurementTime: safeOptionalString(),
    isDayOn: safeOptionalBoolean(),
    meals: z.array(LoggedMealItemSchema).optional().catch([]).default([]),
    supplementsIntake: z.array(SupplementIntakeSchema).optional().catch([]).default([]),
    sleepHours: safeOptionalSleepTime(),
    sleepDeep: safeOptionalSleepTime(),
    sleepLight: safeOptionalSleepTime(),
    sleepRem: safeOptionalSleepTime(),
    sleepAwake: safeOptionalSleepTime(),
}).passthrough()).catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'NutritionDaySchema',
        fallbackUsed: 'default_empty_day',
        error: ctx?.error,
    });
    return { date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] };
}).default({ date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] });

export const FoodSchema = z.object({
    id: z.union([z.string(), z.number()]).optional().catch(undefined),
    name: safeString(''),
    kcal: safeNumber(0),
    pro: safeNumber(0),
    carbs: safeNumber(0),
    fat: safeNumber(0),
    brand: safeOptionalString(),
    category: safeOptionalString(),
    baseQty: safeOptionalNumber(),
    unit: safeOptionalString(),
    servingUnit: safeOptionalString(),
    servingWeight: safeOptionalNullableNumber(),
    isCustom: safeOptionalBoolean(),
    satFat: safeOptionalNullableNumber(),
    sugars: safeOptionalNullableNumber(),
    sodium: safeOptionalNullableNumber(),
    fiber: safeOptionalNullableNumber(),
    iron: safeOptionalNullableNumber(),
    potassium: safeOptionalNullableNumber(),
    calcium: safeOptionalNullableNumber(),
    magnesium: safeOptionalNullableNumber(),
    cholesterol: safeOptionalNullableNumber(),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'FoodSchema',
        fallbackUsed: 'default_empty_food',
        error: ctx?.error,
    });
    return { name: '', kcal: 0, pro: 0, carbs: 0, fat: 0 };
}).default({ name: '', kcal: 0, pro: 0, carbs: 0, fat: 0 });

export const TrainingCycleRoutineItemSchema = z.object({
    routineId: safeString(''),
    frequencyPerWeek: safeNumber(1),
}).passthrough().catch({ routineId: '', frequencyPerWeek: 1 }).default({ routineId: '', frequencyPerWeek: 1 });

export const TrainingCycleSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    durationWeeks: safeNumber(4),
    sessionsPerWeek: safeOptionalNumber(),
    progressionMode: z.enum(['sequential', 'fixed']).optional().catch(undefined),
    startDate: safeOptionalString(),
    endDate: safeOptionalString(),
    notes: safeOptionalString(),
    routines: z.array(TrainingCycleRoutineItemSchema).catch([]).default([]),
    createdAt: safeOptionalNumber(),
    isActive: safeOptionalBoolean(),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'TrainingCycleSchema',
        fallbackUsed: 'default_empty_cycle',
        error: ctx?.error,
    });
    return { id: '', name: '', durationWeeks: 4, routines: [] };
}).default({ id: '', name: '', durationWeeks: 4, routines: [] });

export const defaultUserDataFallback = {
    profile: {},
    library: [],
    routines: [],
    history: [],
    nutrition: {},
    customFoods: [],
    activeWorkout: null,
    nutritionPlanning: {
        weight: 80,
        carbsPerKg: 3.5,
        proPerKg: 2.0,
        fatPerKg: 1.0,
        lockedMacro: null,
        chartPeriod: 7,
        normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    },
    trainingCycles: [],
    activeCycleId: null,
    supplements: [],
    activePains: [],
    catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
};

// ==========================================
// Catalog Schemas
// ==========================================

export const CatalogManifestSchema = z.object({
    version: safeString('1.0.0'),
    updatedAt: safeString(new Date().toISOString()),
    schemaVersion: safeNumber(1),
    docRefs: z.object({
        exercises: safeString('exercises_v1'),
        foods: safeString('foods_v1'),
    }).catch({ exercises: 'exercises_v1', foods: 'foods_v1' }),
    itemCounts: z.object({
        exercises: safeNumber(0),
        foods: safeNumber(0),
    }).catch({ exercises: 0, foods: 0 }),
}).passthrough();

export const CatalogExerciseSchema = z.object({
    id: safeString(),
    name: safeString(),
    muscles: z.array(safeString()).optional().default([]),
    secondaryMuscles: z.array(safeString()).optional().default([]),
    trackingType: z.enum(['weight_reps', 'time', 'cardio']).catch('weight_reps'),
    isDefault: safeOptionalBoolean(),
    isBodyweight: safeOptionalBoolean(),
    equipmentWeight: safeOptionalNumber(),
    notes: safeOptionalString(),
    setsCount: safeOptionalNumber(),
}).passthrough();

export const CatalogFoodSchema = z.object({
    id: z.union([safeString(), safeNumber()]).transform(val => String(val)),
    name: safeString(),
    brand: safeOptionalString(),
    category: safeOptionalString(),
    kcal: safeNumber(0),
    pro: safeNumber(0),
    carbs: safeNumber(0),
    fat: safeNumber(0),
    baseQty: safeOptionalNumber(),
    unit: safeOptionalString(),
    servingUnit: safeOptionalString(),
    servingWeight: safeOptionalNullableNumber(),
    isCustom: safeOptionalBoolean(),
    satFat: safeOptionalNumber(),
    sugars: safeOptionalNumber(),
    sodium: safeOptionalNumber(),
    fiber: safeOptionalNumber(),
    iron: safeOptionalNumber(),
    potassium: safeOptionalNumber(),
    calcium: safeOptionalNumber(),
    magnesium: safeOptionalNumber(),
    cholesterol: safeOptionalNumber(),
}).passthrough();

export const CachedGlobalCatalogSchema = z.object({
    manifest: CatalogManifestSchema,
    exercises: z.array(CatalogExerciseSchema).catch([]),
    foods: z.array(CatalogFoodSchema).catch([]),
    cachedAt: safeNumber(Date.now()),
}).passthrough();

export const ExerciseOverrideSchema = z.object({
    name: safeOptionalString(),
    notes: safeOptionalString(),
    muscles: z.array(safeString()).optional(),
    secondaryMuscles: z.array(safeString()).optional(),
    equipmentWeight: safeOptionalNumber(),
    isBodyweight: safeOptionalBoolean(),
    trackingType: z.enum(['weight_reps', 'time', 'cardio']).optional(),
}).passthrough();

export const FoodOverrideSchema = z.object({
    name: safeOptionalString(),
    brand: safeOptionalString(),
    category: safeOptionalString(),
    kcal: safeOptionalNumber(),
    pro: safeOptionalNumber(),
    carbs: safeOptionalNumber(),
    fat: safeOptionalNumber(),
    baseQty: safeOptionalNumber(),
    unit: safeOptionalString(),
    servingUnit: safeOptionalString(),
    servingWeight: safeOptionalNullableNumber(),
}).passthrough();

export const CatalogOverridesSchema = z.object({
    exercises: z.record(z.string(), ExerciseOverrideSchema).optional().default({}),
    foods: z.record(z.string(), FoodOverrideSchema).optional().default({}),
    hiddenExerciseIds: z.array(safeString()).max(500).optional().default([]), // Firestore protection
    hiddenFoodIds: z.array(safeString()).max(500).optional().default([]), // Firestore protection
}).passthrough().catch({
    exercises: {},
    foods: {},
    hiddenExerciseIds: [],
    hiddenFoodIds: []
});

export const LegalConsentSchema = z.object({
    hasAcceptedTerms: safeBoolean(false),
    hasAcceptedHealthData: safeBoolean(false),
    acceptedAt: safeString(''),
    privacyVersion: safeString(''),
    termsVersion: safeString(''),
}).passthrough().optional().catch(undefined);

export const UserDataSchema = z.object({
    profile: UserProfileSchema.optional().catch({}).default({}),
    library: z.array(ExerciseSchema).max(500).optional().catch([]).default([]),
    routines: z.array(WorkoutRoutineSchema).max(300).optional().catch([]).default([]),
    history: z.array(WorkoutSessionSchema).optional().catch([]).default([]), // Actually stored in history_months in Firebase
    nutrition: z.record(z.string(), NutritionDaySchema).optional().catch({}).default({}), // nutrition_months
    customFoods: z.array(FoodSchema).max(500).optional().catch([]).default([]),
    activeWorkout: WorkoutSessionSchema.nullable().optional().catch(null).default(null),
    nutritionPlanning: NutritionPlanningSchema.optional().catch(undefined),
    trainingCycles: z.array(TrainingCycleSchema).max(100).optional().catch([]).default([]),
    activeCycleId: z.union([z.string(), z.null()]).optional().catch(null).default(null),
    supplements: z.array(SupplementSchema).max(100).optional().catch([]).default([]),
    activePains: z.array(safeString('')).max(50).optional().catch([]).default([]),
    catalogOverrides: CatalogOverridesSchema.optional().catch({ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }).default({ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }),
    legalConsent: LegalConsentSchema,

}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'UserDataSchema',
        fallbackUsed: 'defaultUserDataFallback',
        error: ctx?.error,
    });
    return defaultUserDataFallback;
}).default(defaultUserDataFallback);

const isValidParsedId = (id: unknown) => typeof id === 'string' && id.trim().length > 0;

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
        return data.map((item) => WorkoutSessionSchema.parse(item));
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
        return data.map((item) => WorkoutRoutineSchema.parse(item));
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
        return data.map((item) => TrainingCycleSchema.parse(item));
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
        return data.map((item) => SupplementSchema.parse(item));
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

