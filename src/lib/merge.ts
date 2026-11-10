import { UserDataSchema } from './schema';
import deepEqual from 'fast-deep-equal';
import { getInMemoryCatalog } from './catalog/catalogService';
import {
    mergeCatalogOverrides
} from './catalog/deltaResolver';
import { calculateLoggedMealTotals } from './nutrition/calculateLoggedMealTotals';
import { normalizeBusinessId } from './businessIdentity';
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
 * Preserves items with non-matching valid IDs and quarantines entities
 * whose business identity is missing or invalid.
 */
function sanitizeIdentityCollection<T extends { id?: string | number }>(
    items?: T[] | null,
    extraIdentity?: (item: T) => unknown,
): T[] {
    if (!Array.isArray(items)) return [];
    const result: T[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        const id = item ? normalizeBusinessId(item.id) : null;
        if (!id || seen.has(id)) continue;
        if (extraIdentity && !normalizeBusinessId(extraIdentity(item))) continue;
        seen.add(id);
        result.push(item);
    }
    return result;
}

export function mergeArrayById<T extends { id?: string | number }>(
    cloudArr?: T[] | null,
    guestArr?: T[] | null
): T[] {
    const map = new Map<string, T>();

    for (const item of sanitizeIdentityCollection(cloudArr)) {
        map.set(normalizeBusinessId(item.id)!, item);
    }

    for (const item of sanitizeIdentityCollection(guestArr)) {
        map.set(normalizeBusinessId(item.id)!, item);
    }

    return Array.from(map.values());
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

    const { hips: _unsupportedHips, ...canonicalProfile } = result as UserProfile & { hips?: unknown };
    return canonicalProfile;
}

/**
 * Deeply merges two nutrition planning objects.
 * Guest scalar and nested values take precedence when defined;
 * Cloud values are preserved when omitted in guest.
 */
function deepMergeNutritionPlanning(
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
): { activePlan: NutritionPlanning | undefined, pendingConflict: NutritionPlanning | undefined, activeOrigin: 'generated-default' | 'user-edited' } {
    // The current writer records provenance explicitly. Missing provenance is
    // never evidence that a populated plan can be discarded as a generated default.
    // Keep it as user data and preserve a competing guest plan as a conflict.
    const resolvedGuestOrigin = guestOrigin ?? (guestPlan ? 'user-edited' : 'generated-default');
    const resolvedCloudOrigin = cloudOrigin ?? (cloudPlan ? 'user-edited' : 'generated-default');
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

    return resultPayload;
}

/**
 * Merges two nutrition records keyed by `YYYY-MM-DD`.
 * - Dates unique to cloud or guest are preserved.
 * - For matching dates:
 *   - `meals` sub-array is merged by item ID (guest priority).
 *   - `supplementsIntake` and `cardioSessions` are merged by stable ID (guest priority).
 *   - Daily steps and their provenance metadata move together; an explicit guest value, including 0, wins.
 *   - Daily macros (kcal, carbs, pro, fat) are recalculated from combined meals if meals exist;
 *     otherwise guest macros take priority if non-zero, else cloud.
 *   - Body measurements and notes: guest values prioritized if present/non-empty, otherwise cloud; BF provenance follows the selected BF value.
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
        const sanitizeDayIdentities = (day: NutritionDay | undefined): NutritionDay | undefined => {
            if (!day) return undefined;
            const { hips: _unsupportedHips, ...canonicalDay } = day as NutritionDay & { hips?: unknown };
            return {
                ...canonicalDay,
                ...(day.meals !== undefined ? { meals: sanitizeIdentityCollection(day.meals) } : {}),
                ...(day.supplementsIntake !== undefined ? {
                    supplementsIntake: sanitizeIdentityCollection(day.supplementsIntake, item => item.supplementId),
                } : {}),
                ...(day.cardioSessions !== undefined ? { cardioSessions: sanitizeIdentityCollection(day.cardioSessions) } : {}),
            };
        };

        const cloudDay = sanitizeDayIdentities(cloud[date]);
        const guestDay = sanitizeDayIdentities(guest[date]);

        if (cloudDay && !guestDay) {
            result[date] = cloudDay;
        } else if (!cloudDay && guestDay) {
            result[date] = guestDay;
        } else if (cloudDay && guestDay) {
            const mergedMeals = mergeArrayById(cloudDay.meals, guestDay.meals);
            const mergedSupplementsIntake = mergeArrayById(cloudDay.supplementsIntake, guestDay.supplementsIntake);
            const mergedCardioSessions = mergeArrayById(cloudDay.cardioSessions, guestDay.cardioSessions);

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

            const dayObj: any = {
                date,
                kcal,
                carbs,
                pro,
                fat,
                meals: mergedMeals,
                supplementsIntake: mergedSupplementsIntake,
                cardioSessions: mergedCardioSessions,
            };

            const stepsDay = guestDay.steps !== undefined ? guestDay : cloudDay;
            if (stepsDay.steps !== undefined) {
                dayObj.steps = stepsDay.steps;
                if (stepsDay.stepsSource !== undefined) dayObj.stepsSource = stepsDay.stepsSource;
                if (stepsDay.stepsCapturedAt !== undefined) dayObj.stepsCapturedAt = stepsDay.stepsCapturedAt;
            }

            const hasGuestBf = guestDay.bf !== undefined && guestDay.bf !== null && guestDay.bf !== '';
            const bfDay = hasGuestBf ? guestDay : cloudDay;
            if (bfDay.bf !== undefined && bfDay.bf !== null && bfDay.bf !== '') {
                dayObj.bf = bfDay.bf;
                if (bfDay.bfProvenance !== undefined) dayObj.bfProvenance = structuredClone(bfDay.bfProvenance);
            }

            const optionalFields: Record<string, any> = {
                weight: pickVal(guestDay.weight, cloudDay.weight),
                neck: pickVal(guestDay.neck, cloudDay.neck),
                waist: pickVal(guestDay.waist, cloudDay.waist),
                hip: pickVal(guestDay.hip, cloudDay.hip),
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

    if (data.nutritionPlanningOrigin === 'user-edited') return true;
    // An omitted origin is not a licence to infer that a populated plan is a
    // disposable default. A fresh generated plan always carries its origin.
    if (data.nutritionPlanningOrigin === undefined && data.nutritionPlanning
        && Object.values(data.nutritionPlanning).some(value => value !== undefined && value !== null && value !== '')) {
        return true;
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
 *   plus current catalog normalization when resolved lists include global items.
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
    const mergedPendingConflicts = {
        ...(cloud.pendingConflicts || {}),
        ...(guest.pendingConflicts || {}),
        ...(mergedNutrition.pendingConflict ? { nutritionPlanning: mergedNutrition.pendingConflict } : {}),
    };

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
        pendingConflicts: Object.keys(mergedPendingConflicts).length ? mergedPendingConflicts : undefined,
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
        // A guest acceptance must never become an authenticated account's consent.
        // Only the account's own record survives the business-data merge.
        legalConsent: cloud.legalConsent,
    };

    return UserDataSchema.parse(rawMerged) as unknown as UserData;
}
