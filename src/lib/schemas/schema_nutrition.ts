import { z } from 'zod';
import { 
    safeNumber, 
    safeOptionalNumber, 
    safeOptionalString, 
    safeString, 
    safeOptionalNullableNumber, 
    safeOptionalBoolean,
    safeOptionalSleepTime,
    reportZodSchemaFallback 
} from './schema_utils';

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
