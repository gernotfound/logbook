import { z } from 'zod';

// Defensive conversion helpers for robust runtime sanitization
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

export const UserProfileSchema = z.object({
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
}).passthrough().catch({}).default({});

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
}).passthrough().catch({}).default({});

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
}).passthrough().catch({ id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] }).default({ id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] });

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
}).passthrough().catch({ id: '', name: '', exercises: [] }).default({ id: '', name: '', exercises: [] });

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
}).passthrough().catch({ exercises: [] }).default({ exercises: [] });

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
}).passthrough().catch({ id: '', name: '', unit: '' }).default({ id: '', name: '', unit: '' });

export const SupplementIntakeSchema = z.object({
    id: safeString(''),
    supplementId: safeString(''),
    amount: safeNumber(0),
    time: safeNumber(0),
}).passthrough().catch({ id: '', supplementId: '', amount: 0, time: 0 }).default({ id: '', supplementId: '', amount: 0, time: 0 });

export const NutritionDaySchema = z.object({
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
    chest: safeOptionalNumber(),
    shoulders: safeOptionalNumber(),
    biceps: safeOptionalNumber(),
    thighs: safeOptionalNumber(),
    calves: safeOptionalNumber(),
    measurementTime: safeOptionalString(),
    isDayOn: safeOptionalBoolean(),
    meals: z.array(LoggedMealItemSchema).optional().catch([]).default([]),
    supplementsIntake: z.array(SupplementIntakeSchema).optional().catch([]).default([]),
}).passthrough().catch({ date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] }).default({ date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] });

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
}).passthrough().catch({ name: '', kcal: 0, pro: 0, carbs: 0, fat: 0 }).default({ name: '', kcal: 0, pro: 0, carbs: 0, fat: 0 });

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
    notes: safeOptionalString(),
    routines: z.array(TrainingCycleRoutineItemSchema).catch([]).default([]),
    createdAt: safeOptionalNumber(),
    isActive: safeOptionalBoolean(),
}).passthrough().catch({ id: '', name: '', durationWeeks: 4, routines: [] }).default({ id: '', name: '', durationWeeks: 4, routines: [] });

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
    supplements: []
};

export const UserDataSchema = z.object({
    profile: UserProfileSchema.optional().catch({}).default({}),
    library: z.array(ExerciseSchema).optional().catch([]).default([]),
    routines: z.array(WorkoutRoutineSchema).optional().catch([]).default([]),
    history: z.array(WorkoutSessionSchema).optional().catch([]).default([]),
    nutrition: z.record(z.string(), NutritionDaySchema).optional().catch({}).default({}),
    customFoods: z.array(FoodSchema).optional().catch([]).default([]),
    activeWorkout: WorkoutSessionSchema.nullable().optional().catch(null).default(null),
    nutritionPlanning: NutritionPlanningSchema.optional().catch(undefined),
    trainingCycles: z.array(TrainingCycleSchema).optional().catch([]).default([]),
    activeCycleId: z.union([z.string(), z.null()]).optional().catch(null).default(null),
    supplements: z.array(SupplementSchema).optional().catch([]).default([]),
}).passthrough().catch(defaultUserDataFallback).default(defaultUserDataFallback);
