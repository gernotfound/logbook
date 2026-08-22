/**
 * Runtime Delta Catalog Resolver (LogBook PWA)
 * 
 * Part of Requirement R3: Global Catalog, Offline Fallback & Separate Cache.
 * 
 * Architectural Role:
 * Implements in-memory dynamic resolution of global catalog items combined with user-specific
 * overrides and custom additions without duplicating static catalog items in the user's Firestore document.
 * 
 * Mathematical Model:
 * EffectiveLibrary = (GlobalExercises \ HiddenExerciseIds) ⊕ ExerciseOverrides ∪ UserCustomExercises
 * EffectiveFoods   = (GlobalFoods \ HiddenFoodIds) ⊕ FoodOverrides ∪ UserCustomFoods
 * 
 * Complies with AGENTS.md:
 * - Pure, non-mutating transformations.
 * - Deterministic ordering (custom user items first or alphabetically).
 * - Full legacy migration utilities for smooth upgrade from monolithic UserData.
 */

import type {
    CatalogExercise,
    CatalogFood,
    CatalogOverrides,
    ExerciseOverride,
    FoodOverride
} from './catalogTypes';

// Local standard shapes matching LogBook types.ts
export interface Exercise {
    id: string;
    name: string;
    notes?: string;
    setsCount: number;
    muscles?: string[];
    secondaryMuscles?: string[];
    sets?: any[];
    trackingType?: 'weight_reps' | 'time' | 'cardio';
    isDefault?: boolean;
    isBodyweight?: boolean;
    equipmentWeight?: number;
}

export interface Food {
    id?: string | number;
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

/**
 * Resolves the effective list of exercises by combining global catalog exercises,
 * applying user overrides, excluding hidden items, and appending user-created custom exercises.
 */
export function resolveEffectiveExercises(
    globalExercises: CatalogExercise[],
    userCustom: Exercise[] = [],
    overrides?: CatalogOverrides
): Exercise[] {
    const hiddenSet = new Set(overrides?.hiddenExerciseIds || []);
    const exerciseOverrides = overrides?.exercises || {};

    const resolvedGlobal: Exercise[] = [];

    for (const base of globalExercises) {
        if (hiddenSet.has(base.id)) {
            continue;
        }

        const override = exerciseOverrides[base.id];
        if (!override) {
            resolvedGlobal.push({
                id: base.id,
                name: base.name,
                notes: base.notes,
                setsCount: base.setsCount ?? 3,
                muscles: base.muscles ? [...base.muscles] : [],
                secondaryMuscles: base.secondaryMuscles ? [...base.secondaryMuscles] : [],
                trackingType: base.trackingType ?? 'weight_reps',
                isDefault: true,
                isBodyweight: base.isBodyweight ?? false,
                equipmentWeight: base.equipmentWeight,
                sets: []
            });
        } else {
            resolvedGlobal.push({
                id: base.id,
                name: override.name !== undefined ? override.name : base.name,
                notes: override.notes !== undefined ? override.notes : base.notes,
                setsCount: base.setsCount ?? 3,
                muscles: override.muscles !== undefined ? [...override.muscles] : (base.muscles ? [...base.muscles] : []),
                secondaryMuscles: override.secondaryMuscles !== undefined ? [...override.secondaryMuscles] : (base.secondaryMuscles ? [...base.secondaryMuscles] : []),
                trackingType: override.trackingType !== undefined ? override.trackingType : (base.trackingType ?? 'weight_reps'),
                isDefault: true,
                isBodyweight: override.isBodyweight !== undefined ? override.isBodyweight : (base.isBodyweight ?? false),
                equipmentWeight: override.equipmentWeight !== undefined ? override.equipmentWeight : base.equipmentWeight,
                sets: []
            });
        }
    }

    // Return custom exercises followed by global resolved exercises
    const cleanUserCustom = userCustom.map(c => ({
        ...c,
        isDefault: false,
        setsCount: c.setsCount ?? 3,
        sets: c.sets || []
    }));

    return [...cleanUserCustom, ...resolvedGlobal];
}

/**
 * Resolves the effective list of foods by combining global catalog foods,
 * applying user overrides, excluding hidden items, and appending user-created custom foods.
 */
export function resolveEffectiveFoods(
    globalFoods: CatalogFood[],
    userCustom: Food[] = [],
    overrides?: CatalogOverrides
): Food[] {
    const hiddenSet = new Set((overrides?.hiddenFoodIds || []).map(id => String(id)));
    const foodOverrides = overrides?.foods || {};

    const resolvedGlobal: Food[] = [];

    for (const base of globalFoods) {
        const foodIdStr = String(base.id);
        if (hiddenSet.has(foodIdStr)) {
            continue;
        }

        const override = foodOverrides[foodIdStr];
        if (!override) {
            resolvedGlobal.push({
                ...base,
                isCustom: false
            });
        } else {
            resolvedGlobal.push({
                ...base,
                name: override.name !== undefined ? override.name : base.name,
                brand: override.brand !== undefined ? override.brand : base.brand,
                category: override.category !== undefined ? override.category : base.category,
                kcal: override.kcal !== undefined ? override.kcal : base.kcal,
                pro: override.pro !== undefined ? override.pro : base.pro,
                carbs: override.carbs !== undefined ? override.carbs : base.carbs,
                fat: override.fat !== undefined ? override.fat : base.fat,
                baseQty: override.baseQty !== undefined ? override.baseQty : base.baseQty,
                unit: override.unit !== undefined ? override.unit : base.unit,
                servingUnit: override.servingUnit !== undefined ? override.servingUnit : base.servingUnit,
                servingWeight: override.servingWeight !== undefined ? override.servingWeight : base.servingWeight,
                isCustom: false
            });
        }
    }

    const cleanUserCustom = userCustom.map(f => ({
        ...f,
        isCustom: true
    }));

    return [...cleanUserCustom, ...resolvedGlobal];
}

/**
 * Computes an ExerciseOverride by comparing modified values against a base CatalogExercise.
 */
export function createExerciseOverride(
    base: CatalogExercise, 
    updates: Partial<Exercise>
): ExerciseOverride {
    const override: ExerciseOverride = {};

    if (updates.name !== undefined && updates.name !== base.name) {
        override.name = updates.name;
    }
    if (updates.notes !== undefined && updates.notes !== base.notes) {
        override.notes = updates.notes;
    }
    if (updates.trackingType !== undefined && updates.trackingType !== base.trackingType) {
        override.trackingType = updates.trackingType;
    }
    if (updates.isBodyweight !== undefined && updates.isBodyweight !== base.isBodyweight) {
        override.isBodyweight = updates.isBodyweight;
    }
    if (updates.equipmentWeight !== undefined && updates.equipmentWeight !== base.equipmentWeight) {
        override.equipmentWeight = updates.equipmentWeight;
    }
    if (updates.muscles && JSON.stringify(updates.muscles) !== JSON.stringify(base.muscles || [])) {
        override.muscles = [...updates.muscles];
    }
    if (updates.secondaryMuscles && JSON.stringify(updates.secondaryMuscles) !== JSON.stringify(base.secondaryMuscles || [])) {
        override.secondaryMuscles = [...updates.secondaryMuscles];
    }

    return override;
}

/**
 * Computes a FoodOverride by comparing modified values against a base CatalogFood.
 */
export function createFoodOverride(
    base: CatalogFood, 
    updates: Partial<Food>
): FoodOverride {
    const override: FoodOverride = {};

    if (updates.name !== undefined && updates.name !== base.name) override.name = updates.name;
    if (updates.brand !== undefined && updates.brand !== base.brand) override.brand = updates.brand;
    if (updates.category !== undefined && updates.category !== base.category) override.category = updates.category;
    if (updates.kcal !== undefined && updates.kcal !== base.kcal) override.kcal = updates.kcal;
    if (updates.pro !== undefined && updates.pro !== base.pro) override.pro = updates.pro;
    if (updates.carbs !== undefined && updates.carbs !== base.carbs) override.carbs = updates.carbs;
    if (updates.fat !== undefined && updates.fat !== base.fat) override.fat = updates.fat;
    if (updates.baseQty !== undefined && updates.baseQty !== base.baseQty) override.baseQty = updates.baseQty;
    if (updates.unit !== undefined && updates.unit !== base.unit) override.unit = updates.unit;
    if (updates.servingUnit !== undefined && updates.servingUnit !== base.servingUnit) override.servingUnit = updates.servingUnit;
    if (updates.servingWeight !== undefined && updates.servingWeight !== base.servingWeight) override.servingWeight = updates.servingWeight;

    return override;
}

/**
 * Hides a global catalog exercise for the user.
 */
export function hideCatalogExercise(
    exerciseId: string, 
    currentOverrides?: CatalogOverrides
): CatalogOverrides {
    const hiddenSet = new Set(currentOverrides?.hiddenExerciseIds || []);
    hiddenSet.add(exerciseId);

    return {
        ...currentOverrides,
        hiddenExerciseIds: Array.from(hiddenSet)
    };
}

/**
 * Unhides a previously hidden global catalog exercise.
 */
export function unhideCatalogExercise(
    exerciseId: string, 
    currentOverrides?: CatalogOverrides
): CatalogOverrides {
    const hiddenSet = new Set(currentOverrides?.hiddenExerciseIds || []);
    hiddenSet.delete(exerciseId);

    return {
        ...currentOverrides,
        hiddenExerciseIds: Array.from(hiddenSet)
    };
}

/**
 * Hides a global catalog food item for the user.
 */
export function hideCatalogFood(
    foodId: string | number, 
    currentOverrides?: CatalogOverrides
): CatalogOverrides {
    const foodIdStr = String(foodId);
    const hiddenSet = new Set((currentOverrides?.hiddenFoodIds || []).map(id => String(id)));
    hiddenSet.add(foodIdStr);

    return {
        ...currentOverrides,
        hiddenFoodIds: Array.from(hiddenSet)
    };
}

/**
 * Unhides a previously hidden global catalog food item.
 */
export function unhideCatalogFood(
    foodId: string | number, 
    currentOverrides?: CatalogOverrides
): CatalogOverrides {
    const foodIdStr = String(foodId);
    const hiddenSet = new Set((currentOverrides?.hiddenFoodIds || []).map(id => String(id)));
    hiddenSet.delete(foodIdStr);

    return {
        ...currentOverrides,
        hiddenFoodIds: Array.from(hiddenSet)
    };
}

/**
 * Applies an override for a specific catalog exercise.
 */
export function applyExerciseOverride(
    exerciseId: string, 
    override: ExerciseOverride, 
    currentOverrides?: CatalogOverrides
): CatalogOverrides {
    return {
        ...currentOverrides,
        exercises: {
            ...(currentOverrides?.exercises || {}),
            [exerciseId]: override
        }
    };
}

/**
 * Applies an override for a specific catalog food item.
 */
export function applyFoodOverride(
    foodId: string | number, 
    override: FoodOverride, 
    currentOverrides?: CatalogOverrides
): CatalogOverrides {
    const foodIdStr = String(foodId);
    return {
        ...currentOverrides,
        foods: {
            ...(currentOverrides?.foods || {}),
            [foodIdStr]: override
        }
    };
}

/**
 * Migration helper: splits a monolithic legacy library array into user custom exercises
 * and catalog overrides by cross-referencing with the global catalog.
 */
export function migrateLegacyLibraryToOverrides(
    legacyLibrary: Exercise[],
    globalExercises: CatalogExercise[]
): { customExercises: Exercise[]; overrides: CatalogOverrides } {
    const globalMap = new Map<string, CatalogExercise>();
    for (const ex of globalExercises) {
        globalMap.set(ex.id, ex);
    }

    const customExercises: Exercise[] = [];
    const exerciseOverrides: Record<string, ExerciseOverride> = {};
    const presentDefaultIds = new Set<string>();

    for (const item of legacyLibrary) {
        const base = globalMap.get(item.id);
        if (!base || !item.isDefault) {
            // User-created custom exercise
            customExercises.push(item);
        } else {
            presentDefaultIds.add(item.id);
            const override = createExerciseOverride(base, item);
            if (Object.keys(override).length > 0) {
                exerciseOverrides[item.id] = override;
            }
        }
    }

    // Determine if any global defaults were deleted by user in legacy data
    const hiddenExerciseIds: string[] = [];
    for (const globalEx of globalExercises) {
        if (!presentDefaultIds.has(globalEx.id) && legacyLibrary.length > 0) {
            hiddenExerciseIds.push(globalEx.id);
        }
    }

    return {
        customExercises,
        overrides: {
            exercises: exerciseOverrides,
            hiddenExerciseIds
        }
    };
}

/**
 * Migration helper: splits a monolithic legacy customFoods array into true custom foods
 * and catalog overrides by cross-referencing with the global foods catalog.
 */
export function migrateLegacyFoodsToOverrides(
    legacyFoods: Food[],
    globalFoods: CatalogFood[]
): { customFoods: Food[]; overrides: CatalogOverrides } {
    const globalMap = new Map<string, CatalogFood>();
    for (const f of globalFoods) {
        globalMap.set(String(f.id), f);
    }

    const customFoods: Food[] = [];
    const foodOverrides: Record<string, FoodOverride> = {};
    const presentDefaultIds = new Set<string>();

    for (const item of legacyFoods) {
        const itemKey = String(item.id);
        const base = globalMap.get(itemKey);
        if (!base || item.isCustom) {
            customFoods.push(item);
        } else {
            presentDefaultIds.add(itemKey);
            const override = createFoodOverride(base, item);
            if (Object.keys(override).length > 0) {
                foodOverrides[itemKey] = override;
            }
        }
    }

    const hiddenFoodIds: string[] = [];
    for (const globalFood of globalFoods) {
        const foodKey = String(globalFood.id);
        if (!presentDefaultIds.has(foodKey) && legacyFoods.length > 0) {
            hiddenFoodIds.push(foodKey);
        }
    }

    return {
        customFoods,
        overrides: {
            foods: foodOverrides,
            hiddenFoodIds
        }
    };
}
