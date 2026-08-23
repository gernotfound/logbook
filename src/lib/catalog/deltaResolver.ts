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
    FoodOverride,
    Exercise,
    Food
} from '../../types';

// Types imported from types.ts

/**
 * Resolves the effective list of exercises by combining global catalog exercises,
 * applying user overrides, excluding hidden items, and appending user-created custom exercises.
 */
export function resolveEffectiveExercises(
    globalExercises: CatalogExercise[] = [],
    userCustom: Exercise[] = [],
    overrides?: CatalogOverrides
): Exercise[] {
    const globals = Array.isArray(globalExercises) ? globalExercises : [];
    const custom = Array.isArray(userCustom) ? userCustom : [];
    const hiddenSet = new Set(Array.isArray(overrides?.hiddenExerciseIds) ? overrides.hiddenExerciseIds : []);
    const exerciseOverrides = (overrides?.exercises && typeof overrides.exercises === 'object') ? overrides.exercises : {};

    const resolvedGlobal: Exercise[] = [];

    for (const base of globals) {
        if (!base || !base.id || hiddenSet.has(base.id)) {
            continue;
        }

        const override = Object.prototype.hasOwnProperty.call(exerciseOverrides, base.id)
            ? exerciseOverrides[base.id]
            : undefined;
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
    const cleanUserCustom = custom
        .filter(c => c && c.id)
        .map(c => ({
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
    globalFoods: CatalogFood[] = [],
    userCustom: Food[] = [],
    overrides?: CatalogOverrides
): Food[] {
    const globals = Array.isArray(globalFoods) ? globalFoods : [];
    const custom = Array.isArray(userCustom) ? userCustom : [];
    const hiddenSet = new Set((Array.isArray(overrides?.hiddenFoodIds) ? overrides.hiddenFoodIds : []).map(id => String(id)));
    const foodOverrides = (overrides?.foods && typeof overrides.foods === 'object') ? overrides.foods : {};

    const resolvedGlobal: Food[] = [];

    for (const base of globals) {
        if (!base || base.id === undefined || base.id === null) {
            continue;
        }

        const foodIdStr = String(base.id);
        if (hiddenSet.has(foodIdStr)) {
            continue;
        }

        const override = Object.prototype.hasOwnProperty.call(foodOverrides, foodIdStr)
            ? foodOverrides[foodIdStr]
            : undefined;
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

    const cleanUserCustom = custom
        .filter(f => f && f.id !== undefined && f.id !== null)
        .map(f => ({
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
    const hiddenList = Array.isArray(currentOverrides?.hiddenExerciseIds) ? currentOverrides.hiddenExerciseIds : [];
    const hiddenSet = new Set(hiddenList);
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
    const hiddenList = Array.isArray(currentOverrides?.hiddenExerciseIds) ? currentOverrides.hiddenExerciseIds : [];
    const hiddenSet = new Set(hiddenList);
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
    const hiddenList = Array.isArray(currentOverrides?.hiddenFoodIds) ? currentOverrides.hiddenFoodIds : [];
    const hiddenSet = new Set(hiddenList.map(id => String(id)));
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
    const hiddenList = Array.isArray(currentOverrides?.hiddenFoodIds) ? currentOverrides.hiddenFoodIds : [];
    const hiddenSet = new Set(hiddenList.map(id => String(id)));
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
 * Removes an override for a specific catalog exercise, resetting it to default.
 */
export function removeExerciseOverride(
    exerciseId: string,
    currentOverrides?: CatalogOverrides
): CatalogOverrides {
    const newExercises = { ...(currentOverrides?.exercises || {}) };
    delete newExercises[exerciseId];
    return {
        ...currentOverrides,
        exercises: newExercises
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
 * Removes an override for a specific catalog food item, resetting it to default.
 */
export function removeFoodOverride(
    foodId: string | number,
    currentOverrides?: CatalogOverrides
): CatalogOverrides {
    const foodIdStr = String(foodId);
    const newFoods = { ...(currentOverrides?.foods || {}) };
    delete newFoods[foodIdStr];
    return {
        ...currentOverrides,
        foods: newFoods
    };
}

/**
 * Symmetrically merges two CatalogOverrides objects without data loss.
 */
export function mergeCatalogOverrides(
    a?: CatalogOverrides | null,
    b?: CatalogOverrides | null
): CatalogOverrides {
    const overridesA = a || {};
    const overridesB = b || {};

    const hiddenExA = Array.isArray(overridesA.hiddenExerciseIds) ? overridesA.hiddenExerciseIds : [];
    const hiddenExB = Array.isArray(overridesB.hiddenExerciseIds) ? overridesB.hiddenExerciseIds : [];
    const hiddenFoodA = Array.isArray(overridesA.hiddenFoodIds) ? overridesA.hiddenFoodIds : [];
    const hiddenFoodB = Array.isArray(overridesB.hiddenFoodIds) ? overridesB.hiddenFoodIds : [];

    return {
        exercises: {
            ...(overridesA.exercises && typeof overridesA.exercises === 'object' ? overridesA.exercises : {}),
            ...(overridesB.exercises && typeof overridesB.exercises === 'object' ? overridesB.exercises : {}),
        },
        foods: {
            ...(overridesA.foods && typeof overridesA.foods === 'object' ? overridesA.foods : {}),
            ...(overridesB.foods && typeof overridesB.foods === 'object' ? overridesB.foods : {}),
        },
        hiddenExerciseIds: Array.from(new Set([...hiddenExA, ...hiddenExB])),
        hiddenFoodIds: Array.from(new Set([...hiddenFoodA.map(String), ...hiddenFoodB.map(String)])),
    };
}

/**
 * Migration helper: splits a monolithic legacy library array into user custom exercises
 * and catalog overrides by cross-referencing with the global catalog.
 */
export function migrateLegacyLibraryToOverrides(
    legacyLibrary: Exercise[] = [],
    globalExercises: CatalogExercise[] = []
): { customExercises: Exercise[]; overrides: CatalogOverrides } {
    const list = Array.isArray(legacyLibrary) ? legacyLibrary : [];
    const globals = Array.isArray(globalExercises) ? globalExercises : [];

    const globalMap = new Map<string, CatalogExercise>();
    for (const ex of globals) {
        if (ex && ex.id) {
            globalMap.set(ex.id, ex);
        }
    }

    const customExercises: Exercise[] = [];
    const exerciseOverrides: Record<string, ExerciseOverride> = {};
    const presentDefaultIds = new Set<string>();

    for (const item of list) {
        if (!item || !item.id) continue;
        const base = globalMap.get(item.id);
        if (!base || item.isDefault === false) {
            // User-created custom exercise
            customExercises.push({
                ...item,
                isDefault: false
            });
        } else {
            presentDefaultIds.add(item.id);
            const override = createExerciseOverride(base, item);
            if (Object.keys(override).length > 0) {
                exerciseOverrides[item.id] = override;
            }
        }
    }

    // Determine if any global defaults were deleted by user in legacy data.
    // If presentDefaultIds is empty, legacyLibrary contained no default items (e.g. pure custom list),
    // so no default items should be marked as hidden.
    const hiddenExerciseIds: string[] = [];
    if (presentDefaultIds.size > 0) {
        for (const globalEx of globals) {
            if (globalEx && globalEx.id && !presentDefaultIds.has(globalEx.id)) {
                hiddenExerciseIds.push(globalEx.id);
            }
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
    legacyFoods: Food[] = [],
    globalFoods: CatalogFood[] = []
): { customFoods: Food[]; overrides: CatalogOverrides } {
    const list = Array.isArray(legacyFoods) ? legacyFoods : [];
    const globals = Array.isArray(globalFoods) ? globalFoods : [];

    const globalMap = new Map<string, CatalogFood>();
    for (const f of globals) {
        if (f && f.id !== undefined && f.id !== null) {
            globalMap.set(String(f.id), f);
        }
    }

    const customFoods: Food[] = [];
    const foodOverrides: Record<string, FoodOverride> = {};
    const presentDefaultIds = new Set<string>();

    for (const item of list) {
        if (!item || item.id === undefined || item.id === null) continue;
        const itemKey = String(item.id);
        const base = globalMap.get(itemKey);
        if (!base || item.isCustom === true) {
            customFoods.push({
                ...item,
                isCustom: true
            });
        } else {
            presentDefaultIds.add(itemKey);
            const override = createFoodOverride(base, item);
            if (Object.keys(override).length > 0) {
                foodOverrides[itemKey] = override;
            }
        }
    }

    // Determine if any global defaults were deleted by user in legacy data.
    // If presentDefaultIds is empty, legacyFoods contained no default items,
    // so no default items should be marked as hidden.
    const hiddenFoodIds: string[] = [];
    if (presentDefaultIds.size > 0) {
        for (const globalFood of globals) {
            if (globalFood && globalFood.id !== undefined && globalFood.id !== null) {
                const foodKey = String(globalFood.id);
                if (!presentDefaultIds.has(foodKey)) {
                    hiddenFoodIds.push(foodKey);
                }
            }
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
