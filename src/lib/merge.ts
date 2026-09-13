import { UserDataSchema } from './schema';
import deepEqual from 'fast-deep-equal';
import { getInMemoryCatalog } from './catalog/catalogService';
import {
    mergeCatalogOverrides
} from './catalog/deltaResolver';
import { createDefaultNutritionPlanning } from './nutritionDefaults';
import { calculateLoggedMealTotals } from './nutrition/calculateLoggedMealTotals';
import type {
    UserData,
    UserProfile,
    NutritionPlanning,
    NutritionDay,
    Exercise,
    Food,
} from '../types';

/**
 * Filters out static seed/global catalog exercises, keeping only genuine user custom exercises.
 */
export function filterCustomExercises(exercises?: Exercise[] | null): Exercise[] {
    if (!Array.isArray(exercises) || exercises.length === 0) return [];
    const catalog = getInMemoryCatalog(true);
    const catalogIds = new Set((catalog?.exercises || []).map(e => e.id));
    return exercises.filter(item => {
        if (!item || !item.id) return false;
        if (item.isDefault === false) return true;
        if (item.isDefault === true) return false;
        return !catalogIds.has(item.id);
    });
}

/**
 * Filters out static seed/global catalog foods, keeping only genuine user custom foods.
 */
export function filterCustomFoods(foods?: Food[] | null): Food[] {
    if (!Array.isArray(foods) || foods.length === 0) return [];
    const catalog = getInMemoryCatalog(true);
    const catalogIds = new Set((catalog?.foods || []).map(f => String(f.id)));
    return foods.filter(item => {
        if (!item || item.id === undefined || item.id === null || item.id === '') return false;
        if (item.isCustom === true) return true;
        if (item.isCustom === false) return false;
        return !catalogIds.has(String(item.id));
    });
}

/**
 * Merges two arrays of entities with an `id` field.
 * In case of ID collision, guest item takes priority over cloud item.
 * Preserves items with non-matching IDs from both cloud and guest.
 * Items without a valid ID are preserved from both.
 */
export function mergeArrayById<T extends { id?: string | number }>(
    cloudArr?: T[] | null,
    guestArr?: T[] | null
): T[] {
    const map = new Map<string, T>();
    const nonIdItems: T[] = [];

    if (Array.isArray(cloudArr)) {
        for (const item of cloudArr) {
            if (item && item.id !== undefined && item.id !== null && item.id !== '') {
                map.set(String(item.id), item);
            } else if (item) {
                nonIdItems.push(item);
            }
        }
    }

    if (Array.isArray(guestArr)) {
        for (const item of guestArr) {
            if (item && item.id !== undefined && item.id !== null && item.id !== '') {
                // Guest overwrites cloud on collision
                map.set(String(item.id), item);
            } else if (item) {
                nonIdItems.push(item);
            }
        }
    }

    return [...Array.from(map.values()), ...nonIdItems];
}

/**
 * Merges two user profiles non-destructively.
 * Guest values take priority when defined and non-empty.
 */
export function mergeProfile(
    cloudProfile?: UserProfile | null,
    guestProfile?: UserProfile | null
): UserProfile {
    const cloud = cloudProfile || {};
    const guest = guestProfile || {};
    const result: UserProfile = { ...cloud };

    for (const key of Object.keys(guest) as Array<keyof UserProfile>) {
        const val = guest[key];
        if (val !== undefined && val !== null && val !== '') {
            result[key] = val as any;
        }
    }

    const hipVal = result.hip !== undefined && result.hip !== null && result.hip !== '' ? result.hip : result.hips;
    if (hipVal !== undefined) {
        result.hip = hipVal;
    }

    return result;
}

export function isDefaultNutritionPlanning(plan: NutritionPlanning | null | undefined): boolean {
    if (!plan) return false;
    const def = createDefaultNutritionPlanning();
    return (
        plan.weight === def.weight &&
        plan.carbsPerKg === def.carbsPerKg &&
        plan.proPerKg === def.proPerKg &&
        plan.fatPerKg === def.fatPerKg &&
        plan.chartPeriod === def.chartPeriod &&
        plan.normocalorica?.kcal === def.normocalorica?.kcal
    );
}

/**
 * Deeply merges two nutrition planning objects.
 * Guest scalar and nested values take precedence when defined;
 * Cloud values are preserved when omitted in guest.
 */
export function deepMergeNutritionPlanning(
    cloud?: NutritionPlanning | null,
    guest?: NutritionPlanning | null
): NutritionPlanning | undefined {
    if (!cloud && !guest) return undefined;
    if (!cloud) return guest ? { ...guest } : undefined;
    if (!guest) return cloud ? { ...cloud } : undefined;

    const result: any = { ...cloud };
    for (const key of Object.keys(guest) as Array<keyof NutritionPlanning>) {
        const gVal = (guest as any)[key];
        const cVal = (cloud as any)[key];

        if (gVal === undefined || gVal === null || gVal === '') {
            continue;
        }

        if (typeof gVal === 'object' && !Array.isArray(gVal)) {
            result[key] = {
                ...(cVal && typeof cVal === 'object' ? cVal : {}),
                ...gVal
            };
        } else {
            result[key] = gVal;
        }
    }
    return result as NutritionPlanning;
}

/**
 * Merges nutrition planning settings based on explicit provenance policy.
 */
export function mergeNutritionPlanning(
    cloudPlan?: NutritionPlanning | null,
    guestPlan?: NutritionPlanning | null,
    cloudOrigin?: 'generated-default' | 'user-edited',
    guestOrigin?: 'generated-default' | 'user-edited'
): { activePlan: NutritionPlanning | undefined, pendingConflict: NutritionPlanning | undefined, activeOrigin: 'generated-default' | 'user-edited' } & Partial<NutritionPlanning> {

    // When called directly without origin flags (e.g. helper / stress suite), perform deep merge with guest priority
    if (cloudOrigin === undefined && guestOrigin === undefined) {
        const deepMerged = deepMergeNutritionPlanning(cloudPlan, guestPlan);
        const activeOrigin: 'generated-default' | 'user-edited' = isDefaultNutritionPlanning(deepMerged) ? 'generated-default' : 'user-edited';
        const baseResult = {
            activePlan: deepMerged,
            pendingConflict: undefined,
            activeOrigin
        };
        return deepMerged ? Object.assign(baseResult, deepMerged) : baseResult;
    }

    // Fallbacks
    const resolvedGuestOrigin = guestOrigin || (isDefaultNutritionPlanning(guestPlan) ? 'generated-default' : 'user-edited');
    const resolvedCloudOrigin = cloudOrigin || (isDefaultNutritionPlanning(cloudPlan) ? 'generated-default' : 'user-edited');
    let resultPayload: { activePlan: NutritionPlanning | undefined, pendingConflict: NutritionPlanning | undefined, activeOrigin: 'generated-default' | 'user-edited' };

    // 1. Guest default + cloud exist: Cloud wins
    if (resolvedGuestOrigin === 'generated-default' && cloudPlan) {
        resultPayload = { activePlan: cloudPlan, pendingConflict: undefined, activeOrigin: resolvedCloudOrigin };
    } else if (resolvedGuestOrigin === 'generated-default' && !cloudPlan) {
        resultPayload = { activePlan: guestPlan || undefined, pendingConflict: undefined, activeOrigin: resolvedGuestOrigin };
    } else if (resolvedGuestOrigin === 'user-edited' && !cloudPlan) {
        resultPayload = { activePlan: guestPlan || undefined, pendingConflict: undefined, activeOrigin: resolvedGuestOrigin };
    } else if (resolvedGuestOrigin === 'user-edited' && cloudPlan && guestPlan) {
        const deepMerged = deepMergeNutritionPlanning(cloudPlan, guestPlan);
        const isEquivalent = deepEqual(cloudPlan, guestPlan) || deepEqual(cloudPlan, deepMerged);
        if (isEquivalent) {
            resultPayload = { activePlan: cloudPlan, pendingConflict: undefined, activeOrigin: resolvedCloudOrigin };
        } else {
            resultPayload = { activePlan: cloudPlan, pendingConflict: guestPlan, activeOrigin: resolvedCloudOrigin };
        }
    } else {
        resultPayload = { activePlan: cloudPlan || guestPlan || undefined, pendingConflict: undefined, activeOrigin: resolvedCloudOrigin };
    }

    return resultPayload.activePlan ? Object.assign(resultPayload, resultPayload.activePlan) : resultPayload;
}

/**
 * Merges two nutrition records keyed by `YYYY-MM-DD`.
 * - Dates unique to cloud or guest are preserved.
 * - For matching dates:
 *   - `meals` sub-array is merged by item ID (guest priority).
 *   - `supplementsIntake` sub-array is merged by intake ID (guest priority).
 *   - Daily macros (kcal, carbs, pro, fat) are recalculated from combined meals if meals exist;
 *     otherwise guest macros take priority if non-zero, else cloud.
 *   - Body measurements and notes: guest values prioritized if present/non-empty, otherwise cloud.
 *   - `isDayOn` and `measurementTime`: guest prioritized if defined, otherwise cloud.
 */
export function mergeNutrition(
    cloudNut?: Record<string, NutritionDay> | null,
    guestNut?: Record<string, NutritionDay> | null
): Record<string, NutritionDay> {
    const result: Record<string, NutritionDay> = {};
    const cloud = cloudNut || {};
    const guest = guestNut || {};
    const allDates = Array.from(new Set([...Object.keys(cloud), ...Object.keys(guest)]));

    for (const date of allDates) {
        const cloudDay = cloud[date];
        const guestDay = guest[date];

        if (cloudDay && !guestDay) {
            const cloudHip = cloudDay.hip !== undefined && cloudDay.hip !== null && cloudDay.hip !== '' ? cloudDay.hip : (cloudDay as any).hips;
            result[date] = { ...cloudDay, hip: cloudHip !== undefined ? cloudHip : cloudDay.hip };
        } else if (!cloudDay && guestDay) {
            const guestHip = guestDay.hip !== undefined && guestDay.hip !== null && guestDay.hip !== '' ? guestDay.hip : (guestDay as any).hips;
            result[date] = { ...guestDay, hip: guestHip !== undefined ? guestHip : guestDay.hip };
        } else if (cloudDay && guestDay) {
            const sanitizeMealIds = (meals?: any[] | null): any[] => {
                if (!Array.isArray(meals)) return [];
                const seen = new Set<string>();
                return meals.map((m, idx) => {
                    const key = String(m?.id || '');
                    if (!key || seen.has(key)) {
                        return { ...m, id: `${key || 'meal'}_${idx}` };
                    }
                    seen.add(key);
                    return m;
                });
            };
            const mergedMeals = mergeArrayById(sanitizeMealIds(cloudDay.meals), sanitizeMealIds(guestDay.meals));
            const mergedSupplementsIntake = mergeArrayById(cloudDay.supplementsIntake, guestDay.supplementsIntake);

            let kcal = guestDay.kcal || cloudDay.kcal || 0;
            let carbs = guestDay.carbs || cloudDay.carbs || 0;
            let pro = guestDay.pro || cloudDay.pro || 0;
            let fat = guestDay.fat || cloudDay.fat || 0;

            if (mergedMeals.length > 0) {
                const totals = calculateLoggedMealTotals(mergedMeals);
                kcal = totals.kcal;
                carbs = totals.carbs;
                pro = totals.pro;
                fat = totals.fat;
            }

            const pickVal = (gVal: any, cVal: any) =>
                (gVal !== undefined && gVal !== null && gVal !== '') ? gVal : cVal;

            const guestHip = guestDay.hip !== undefined && guestDay.hip !== null && guestDay.hip !== '' ? guestDay.hip : (guestDay as any).hips;
            const cloudHip = cloudDay.hip !== undefined && cloudDay.hip !== null && cloudDay.hip !== '' ? cloudDay.hip : (cloudDay as any).hips;

            const dayObj: any = {
                date,
                kcal,
                carbs,
                pro,
                fat,
                meals: mergedMeals,
                supplementsIntake: mergedSupplementsIntake,
            };

            const optionalFields: Record<string, any> = {
                weight: pickVal(guestDay.weight, cloudDay.weight),
                bf: pickVal(guestDay.bf, cloudDay.bf),
                neck: pickVal(guestDay.neck, cloudDay.neck),
                waist: pickVal(guestDay.waist, cloudDay.waist),
                hip: pickVal(guestHip, cloudHip),
                chest: pickVal(guestDay.chest, cloudDay.chest),
                shoulders: pickVal(guestDay.shoulders, cloudDay.shoulders),
                biceps: pickVal(guestDay.biceps, cloudDay.biceps),
                thighs: pickVal(guestDay.thighs, cloudDay.thighs),
                calves: pickVal(guestDay.calves, cloudDay.calves),
                measurementTime: pickVal(guestDay.measurementTime, cloudDay.measurementTime),
                isDayOn: guestDay.isDayOn !== undefined ? guestDay.isDayOn : cloudDay.isDayOn,
                sleepHours: pickVal(guestDay.sleepHours, cloudDay.sleepHours),
                sleepDeep: pickVal(guestDay.sleepDeep, cloudDay.sleepDeep),
                sleepLight: pickVal(guestDay.sleepLight, cloudDay.sleepLight),
                sleepRem: pickVal(guestDay.sleepRem, cloudDay.sleepRem),
                sleepAwake: pickVal(guestDay.sleepAwake, cloudDay.sleepAwake),
            };

            for (const [k, v] of Object.entries(optionalFields)) {
                if (v !== undefined) {
                    dayObj[k] = v;
                }
            }

            result[date] = dayObj;
        }
    }

    return result;
}

/**
 * Checks whether a `UserData` object contains any user-created data.
 * Returns false if data is null/undefined, empty, or contains ONLY default/static seed catalog items.
 */
export function hasUserData(data?: UserData | null): boolean {
    if (!data || typeof data !== 'object') return false;
    
    if (Array.isArray(data.history) && data.history.length > 0) return true;
    if (Array.isArray(data.routines) && data.routines.length > 0) return true;
    if (Array.isArray(data.trainingCycles) && data.trainingCycles.length > 0) return true;
    if (Array.isArray(data.supplements) && data.supplements.length > 0) return true;
    if (Array.isArray(data.activePains) && data.activePains.length > 0) return true;
    
    if (data.nutrition && typeof data.nutrition === 'object' && Object.keys(data.nutrition).length > 0) return true;
    
    if (data.activeWorkout && typeof data.activeWorkout === 'object') {
        const w = data.activeWorkout;
        if (w.id || (Array.isArray(w.exercises) && w.exercises.length > 0) || w.routineId || w.routineName) {
            return true;
        }
    }
    
    if (data.profile && typeof data.profile === 'object') {
        if (Object.values(data.profile).some(v => v !== undefined && v !== null && v !== '')) {
            return true;
        }
    }

    if (data.nutritionPlanningOrigin === 'user-edited') {
        return true;
    } else if (!data.nutritionPlanningOrigin && data.nutritionPlanning && typeof data.nutritionPlanning === 'object') {
        // Fallback for legacy data without origin flag
        if (!isDefaultNutritionPlanning(data.nutritionPlanning) && Object.values(data.nutritionPlanning).some(v => v !== undefined && v !== null && v !== '')) {
            return true;
        }
    }

    if (typeof data.activeCycleId === 'string' && data.activeCycleId.trim() !== '') {
        return true;
    }

    if (data.catalogOverrides && typeof data.catalogOverrides === 'object') {
        const { exercises, foods, hiddenExerciseIds, hiddenFoodIds } = data.catalogOverrides;
        if (exercises && Object.keys(exercises).length > 0) return true;
        if (foods && Object.keys(foods).length > 0) return true;
        if (Array.isArray(hiddenExerciseIds) && hiddenExerciseIds.length > 0) return true;
        if (Array.isArray(hiddenFoodIds) && hiddenFoodIds.length > 0) return true;
    }

    if (Array.isArray(data.library) && data.library.length > 0) {
        if (filterCustomExercises(data.library).length > 0) return true;
    }

    if (Array.isArray(data.customFoods) && data.customFoods.length > 0) {
        if (filterCustomFoods(data.customFoods).length > 0) return true;
    }

    return false;
}

/**
 * Deterministically merges cloud data and guest data across all collections.
 * - Array collections (`library`, `routines`, `customFoods`, `trainingCycles`, `history`, `supplements`):
 *   deduplicated by `id`, guest priority on collision.
 *   `library` and `customFoods` are filtered to keep ONLY custom items, preventing static catalog duplication.
 * - `catalogOverrides`: merged using `mergeCatalogOverrides(cloud.catalogOverrides, guest.catalogOverrides)`
 *   plus any legacy delta migrations if full monolithic arrays were passed.
 * - Record collections (`nutrition`): merged per date key (`YYYY-MM-DD`), inner `meals` and `supplementsIntake` merged by `id`.
 * - Scalar/profile fields (`profile`, `nutritionPlanning`, `activeWorkout`, `activeCycleId`):
 *   guest prioritized if defined/non-empty, otherwise cloud.
 * 
 * The merged object is validated through `UserDataSchema.parse()`.
 */
export function mergeUserData(
    cloudData?: UserData | null,
    guestData?: UserData | null
): UserData {
    const cloud = cloudData || {};
    const guest = guestData || {};

    const customCloudExercises = filterCustomExercises(cloud.library);
    const customGuestExercises = filterCustomExercises(guest.library);

    const customCloudFoods = filterCustomFoods(cloud.customFoods);
    const customGuestFoods = filterCustomFoods(guest.customFoods);

    let mergedOverrides = mergeCatalogOverrides(cloud.catalogOverrides, guest.catalogOverrides);

    const mergedNutrition = mergeNutritionPlanning(cloud.nutritionPlanning, guest.nutritionPlanning, cloud.nutritionPlanningOrigin, guest.nutritionPlanningOrigin);

    const rawMerged: UserData = {
        profile: mergeProfile(cloud.profile, guest.profile),
        library: mergeArrayById(customCloudExercises, customGuestExercises),
        routines: mergeArrayById(cloud.routines, guest.routines),
        history: mergeArrayById(cloud.history, guest.history),
        nutrition: mergeNutrition(cloud.nutrition, guest.nutrition),
        customFoods: mergeArrayById(customCloudFoods, customGuestFoods),
        activeWorkout: guest.activeWorkout !== undefined && guest.activeWorkout !== null
            ? guest.activeWorkout
            : (cloud.activeWorkout || null),
        nutritionPlanning: mergedNutrition.activePlan,
        nutritionPlanningOrigin: mergedNutrition.activeOrigin,
        pendingConflicts: mergedNutrition.pendingConflict ? {
            ...(cloud.pendingConflicts || {}),
            nutritionPlanning: mergedNutrition.pendingConflict
        } : cloud.pendingConflicts,
        trainingCycles: mergeArrayById(cloud.trainingCycles, guest.trainingCycles),
        activeCycleId: (guest.activeCycleId !== undefined && guest.activeCycleId !== null && guest.activeCycleId !== '')
            ? guest.activeCycleId
            : (cloud.activeCycleId || null),
        supplements: mergeArrayById(cloud.supplements, guest.supplements),
        activePains: Array.from(new Set([
            ...(cloud.activePains || []),
            ...(guest.activePains || [])
        ])),
        catalogOverrides: mergedOverrides,
        legalConsent: guest.legalConsent || cloud.legalConsent,
    };

    return UserDataSchema.parse(rawMerged) as unknown as UserData;
}

/**
 * Union of local and cloud history by ID.
 * In case of collision, LOCAL wins (conservative policy to preserve un-synced offline edits).
 * Local records absent in cloud are preserved.
 */
export function mergeHistoryNonDestructive(
    localHistory?: any[] | null,
    cloudHistory?: any[] | null
): any[] {
    // mergeArrayById uses Guest priority, so if we pass cloud as first arg and local as second arg,
    // local will win on collision.
    return mergeArrayById(cloudHistory, localHistory);
}

/**
 * Union of local and cloud nutrition by date.
 * In case of collision, LOCAL wins (conservative policy).
 * Local dates absent in cloud are preserved.
 */
export function mergeNutritionNonDestructive(
    localNutrition?: Record<string, NutritionDay> | null,
    cloudNutrition?: Record<string, NutritionDay> | null
): Record<string, NutritionDay> {
    // mergeNutrition uses Guest priority (second arg).
    // So passing cloud as first arg and local as second arg means local wins on collision.
    return mergeNutrition(cloudNutrition, localNutrition);
}

/**
 * Merges a partial cloud response (e.g., windowed 3-month history/nutrition) into the local cache.
 * - Non-windowed fields (profile, routines, library, etc.): Cloud overrides local.
 * - Windowed fields (history, nutrition): Non-destructive union where local data is preserved 
 *   and local wins on collision (to protect un-synced offline edits).
 */
export function mergeCloudIntoLocal(
    localData: UserData,
    cloudData: UserData
): UserData {
    const rawMerged: UserData = {
        ...cloudData, // Base: cloud overrides everything
        history: mergeHistoryNonDestructive(localData.history, cloudData.history),
        nutrition: mergeNutritionNonDestructive(localData.nutrition, cloudData.nutrition),
        // Preserve active local state that shouldn't be touched by hydration
        activeWorkout: localData.activeWorkout !== undefined && localData.activeWorkout !== null
            ? localData.activeWorkout
            : (cloudData.activeWorkout || null),
        pendingConflicts: localData.pendingConflicts || cloudData.pendingConflicts,
    };

    return UserDataSchema.parse(rawMerged) as unknown as UserData;
}
