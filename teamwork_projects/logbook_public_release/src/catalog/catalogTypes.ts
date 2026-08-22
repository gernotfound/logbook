/**
 * Global Catalog Types, Interfaces & Zod Validation Schemas (LogBook PWA)
 * 
 * Part of Requirement R3: Global Catalog, Offline Fallback & Separate Cache.
 * 
 * Defines:
 * - Lightweight manifest structure for O(1) Firestore read version check.
 * - Global catalog items (Exercise & Food).
 * - IndexedDB cached bundle representation under 'logbook_cached_global_catalog'.
 * - User delta override models (custom items, modifications, hidden item IDs)
 *   enabling minimal user document sizes (< 15KB) without bloating with default items.
 */

import { z } from 'zod';

// Defensive primitive helpers matching LogBook schema architecture exactly
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

// ==========================================
// 1. Catalog Manifest
// ==========================================

export interface CatalogManifest {
    version: string;        // Semantic version e.g. "1.0.0"
    updatedAt: string;      // ISO 8601 string e.g. "2026-08-22T00:00:00.000Z"
    schemaVersion: number;  // Schema version number e.g. 1
    docRefs: {
        exercises: string;  // Document ID in Firestore e.g. "exercises_v1"
        foods: string;      // Document ID in Firestore e.g. "foods_v1"
    };
    itemCounts: {
        exercises: number;
        foods: number;
    };
}

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

// ==========================================
// 2. Global Catalog Entities
// ==========================================

export interface CatalogExercise {
    id: string;
    name: string;
    muscles?: string[];
    secondaryMuscles?: string[];
    trackingType?: 'weight_reps' | 'time' | 'cardio';
    isDefault?: boolean;
    isBodyweight?: boolean;
    equipmentWeight?: number;
    notes?: string;
    setsCount?: number;
}

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

export interface CatalogFood {
    id: string | number;
    name: string;
    brand?: string;
    category?: string;
    kcal: number;
    pro: number;
    carbs: number;
    fat: number;
    baseQty?: number;
    unit?: string;
    servingUnit?: string;
    servingWeight?: number | null;
    isCustom?: boolean;
    // Micronutrients
    satFat?: number;
    sugars?: number;
    sodium?: number;
    fiber?: number;
    iron?: number;
    potassium?: number;
    calcium?: number;
    magnesium?: number;
    cholesterol?: number;
}

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

// ==========================================
// 3. Cached Global Catalog (Tier 2 IndexedDB)
// ==========================================

export interface CachedGlobalCatalog {
    manifest: CatalogManifest;
    exercises: CatalogExercise[];
    foods: CatalogFood[];
    cachedAt: number;
}

export const CachedGlobalCatalogSchema = z.object({
    manifest: CatalogManifestSchema,
    exercises: z.array(CatalogExerciseSchema).catch([]),
    foods: z.array(CatalogFoodSchema).catch([]),
    cachedAt: safeNumber(Date.now()),
}).passthrough();

// ==========================================
// 4. User Delta Overrides Model (Stored in UserData)
// ==========================================

export interface ExerciseOverride {
    name?: string;
    notes?: string;
    muscles?: string[];
    secondaryMuscles?: string[];
    equipmentWeight?: number;
    isBodyweight?: boolean;
    trackingType?: 'weight_reps' | 'time' | 'cardio';
}

export const ExerciseOverrideSchema = z.object({
    name: safeOptionalString(),
    notes: safeOptionalString(),
    muscles: z.array(safeString()).optional(),
    secondaryMuscles: z.array(safeString()).optional(),
    equipmentWeight: safeOptionalNumber(),
    isBodyweight: safeOptionalBoolean(),
    trackingType: z.enum(['weight_reps', 'time', 'cardio']).optional(),
}).passthrough();

export interface FoodOverride {
    name?: string;
    brand?: string;
    category?: string;
    kcal?: number;
    pro?: number;
    carbs?: number;
    fat?: number;
    baseQty?: number;
    unit?: string;
    servingUnit?: string;
    servingWeight?: number | null;
}

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

export interface CatalogOverrides {
    exercises?: Record<string, ExerciseOverride>;
    foods?: Record<string, FoodOverride>;
    hiddenExerciseIds?: string[];
    hiddenFoodIds?: string[];
}

export const CatalogOverridesSchema = z.object({
    exercises: z.record(z.string(), ExerciseOverrideSchema).optional().default({}),
    foods: z.record(z.string(), FoodOverrideSchema).optional().default({}),
    hiddenExerciseIds: z.array(safeString()).optional().default([]),
    hiddenFoodIds: z.array(safeString()).optional().default([]),
}).passthrough().catch({
    exercises: {},
    foods: {},
    hiddenExerciseIds: [],
    hiddenFoodIds: []
});

// Storage Constants
export const CATALOG_CACHE_KEY = 'logbook_cached_global_catalog';
export const CATALOG_FIRESTORE_COLLECTION = 'global_catalog';
export const CATALOG_MANIFEST_DOC_ID = 'manifest';
