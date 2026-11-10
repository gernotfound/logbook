import { z } from '../zod';
import { isValidBusinessId } from '../businessIdentity';
import { 
    safeNumber, 
    safeOptionalNumber, 
    safeOptionalString, 
    safeString, 
    safeOptionalNullableNumber, 
    safeOptionalBoolean,
    safeOptionalSleepTime,
} from './schema_utils';

const nonNegativeNumber = (defaultValue = 0) =>
    safeNumber(defaultValue).pipe(z.number().nonnegative()).catch(defaultValue);

const optionalNonNegativeNumber = () =>
    safeOptionalNumber().pipe(z.number().nonnegative().optional()).catch(undefined);

const optionalPositiveNumber = () =>
    safeOptionalNumber().pipe(z.number().positive().optional()).catch(undefined);

const macroBoostNumber = () =>
    safeNumber(0).pipe(z.number().min(-100)).catch(0);

export const MacroTargetSchema = z.object({
    kcal: nonNegativeNumber(0),
    carbs: nonNegativeNumber(0),
    pro: nonNegativeNumber(0),
    fat: nonNegativeNumber(0),
}).passthrough().catch({ kcal: 0, carbs: 0, pro: 0, fat: 0 }).default({ kcal: 0, carbs: 0, pro: 0, fat: 0 });

export const MacroRatioSchema = z.object({
    carbsPerKg: nonNegativeNumber(0),
    proPerKg: nonNegativeNumber(0),
    fatPerKg: nonNegativeNumber(0),
}).passthrough().catch({ carbsPerKg: 0, proPerKg: 0, fatPerKg: 0 }).default({ carbsPerKg: 0, proPerKg: 0, fatPerKg: 0 });

export const MacroBoostSchema = z.object({
    carbsPercent: macroBoostNumber(),
    proPercent: macroBoostNumber(),
    fatPercent: macroBoostNumber(),
}).passthrough().catch({ carbsPercent: 0, proPercent: 0, fatPercent: 0 }).default({ carbsPercent: 0, proPercent: 0, fatPercent: 0 });

export const PartialMacroTargetSchema = z.object({
    kcal: optionalNonNegativeNumber(),
    carbs: optionalNonNegativeNumber(),
    pro: optionalNonNegativeNumber(),
    fat: optionalNonNegativeNumber(),
}).passthrough().optional().catch(undefined);

export const NutritionPlanningSchema = z.object({
    weight: optionalPositiveNumber(),
    onDaysCount: safeOptionalNumber(),
    avgMacros: MacroRatioSchema.optional().catch(undefined),
    onBoost: MacroBoostSchema.optional().catch(undefined),
    onMacros: MacroRatioSchema.optional().catch(undefined),
    offMacros: MacroRatioSchema.optional().catch(undefined),
    notes: safeOptionalString(),
    normocalorica: PartialMacroTargetSchema.optional().catch(undefined),
}).passthrough().transform(({
    totalKcal: _retiredTotalKcal,
    lockedMacro: _retiredLockedMacro,
    chartPeriod: _retiredChartPeriod,
    carbsPerKg: _retiredCarbsPerKg,
    proPerKg: _retiredProPerKg,
    fatPerKg: _retiredFatPerKg,
    ...planning
}) => planning).catch(() => {
    return {};
}).default({});

const NutritionEntityIdSchema = z.string().trim().refine(
    id => isValidBusinessId(id),
    'Identificativo nutrizione non valido',
);

export const LoggedMealItemSchema = z.object({
    id: NutritionEntityIdSchema,
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
}).passthrough();

export const MealSchema = LoggedMealItemSchema;

export const SupplementSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    unit: safeString(''),
    target: safeOptionalNumber(),
    portion: safeOptionalNumber(),
}).passthrough().catch(() => {
    return { id: '', name: '', unit: '' };
}).default({ id: '', name: '', unit: '' });

export const SupplementIntakeSchema = z.object({
    id: NutritionEntityIdSchema,
    supplementId: NutritionEntityIdSchema,
    amount: safeNumber(0),
    time: safeNumber(0),
}).passthrough();

function sanitizeLoggedMeals(value: unknown): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        return [];
    }
    const result: unknown[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        const parsed = LoggedMealItemSchema.safeParse(raw);
        if (!parsed.success || seen.has(parsed.data.id)) {
            continue;
        }
        seen.add(parsed.data.id);
        result.push(parsed.data);
    }
    return result;
}

function sanitizeSupplementIntakes(value: unknown): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        return [];
    }
    const result: unknown[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        const parsed = SupplementIntakeSchema.safeParse(raw);
        if (!parsed.success || seen.has(parsed.data.id)) {
            continue;
        }
        seen.add(parsed.data.id);
        result.push(parsed.data);
    }
    return result;
}

export const CardioSessionSchema = z.object({
    id: z.string().trim().min(1).max(160).refine(isValidBusinessId, 'Identificativo cardio non valido'),
    startedAt: z.number().finite().nonnegative().optional().catch(undefined),
    modality: z.enum(['walk', 'treadmill', 'bike', 'elliptical', 'stair', 'run', 'row', 'swim', 'other']),
    structure: z.enum(['continuous', 'intervals']).optional().catch(undefined),
    durationMinutes: z.number().finite().int().positive().max(1440),
    intensity: z.enum(['low', 'moderate', 'high']).optional().catch(undefined),
    averageHeartRate: z.number().finite().int().positive().max(300).optional().catch(undefined),
    distanceKm: z.number().finite().nonnegative().optional().catch(undefined),
    notes: safeOptionalString(),
    source: z.enum(['manual', 'imported']).optional().catch(undefined),
    externalId: safeOptionalString(),
}).passthrough();

const BodyFatProvenanceSchema = z.object({
    method: z.literal('us_navy'),
    inputs: z.object({
        heightCm: safeOptionalNumber(),
        waistCm: safeOptionalNumber(),
        neckCm: safeOptionalNumber(),
        hipCm: safeOptionalNumber(),
        gender: safeOptionalString(),
    }).passthrough().optional().catch(undefined),
}).passthrough();

function sanitizeCardioSessions(value: unknown): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        return [];
    }
    const result: unknown[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        const parsed = CardioSessionSchema.safeParse(raw);
        if (!parsed.success || seen.has(parsed.data.id)) {
            continue;
        }
        seen.add(parsed.data.id);
        result.push(parsed.data);
    }
    return result;
}

export const NutritionDaySchema = z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
        return {
            ...val,
            meals: sanitizeLoggedMeals(val.meals),
            supplementsIntake: sanitizeSupplementIntakes(val.supplementsIntake),
            cardioSessions: sanitizeCardioSessions(val.cardioSessions),
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
    bfProvenance: BodyFatProvenanceSchema.optional().catch(undefined),
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
    meals: z.array(LoggedMealItemSchema).optional().default([]),
    supplementsIntake: z.array(SupplementIntakeSchema).optional().default([]),
    sleepHours: safeOptionalSleepTime(),
    sleepDeep: safeOptionalSleepTime(),
    sleepLight: safeOptionalSleepTime(),
    sleepRem: safeOptionalSleepTime(),
    sleepAwake: safeOptionalSleepTime(),
    steps: z.number().finite().int().nonnegative().optional().catch(undefined),
    stepsSource: z.enum(['manual', 'imported']).optional().catch(undefined),
    stepsCapturedAt: z.number().finite().nonnegative().optional().catch(undefined),
    cardioSessions: z.array(CardioSessionSchema).optional().default([]),
}).passthrough().transform((day) => {
    const { hips: _unsupportedHips, ...canonicalDay } = day;
    if (canonicalDay.steps !== undefined) return canonicalDay;
    const { stepsSource: _source, stepsCapturedAt: _capturedAt, ...withoutStepMetadata } = canonicalDay;
    return withoutStepMetadata;
})).catch(() => {
    return { date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [], cardioSessions: [] };
}).default({ date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [], cardioSessions: [] });

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
}).passthrough().catch(() => {
    return { name: '', kcal: 0, pro: 0, carbs: 0, fat: 0 };
}).default({ name: '', kcal: 0, pro: 0, carbs: 0, fat: 0 });