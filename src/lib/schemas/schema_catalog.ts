import { z } from '../zod';
import { 
    safeNumber, 
    safeOptionalNumber, 
    safeOptionalString, 
    safeString, 
    safeOptionalNullableNumber, 
    safeOptionalBoolean
} from './schema_utils';

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
