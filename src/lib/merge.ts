import { UserDataSchema } from './schema';
import type {
    UserData,
    UserProfile,
    NutritionPlanning,
    NutritionDay,
} from '../types';

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

    return result;
}

/**
 * Merges nutrition planning settings non-destructively.
 * Guest settings take priority when defined.
 */
export function mergeNutritionPlanning(
    cloudPlan?: NutritionPlanning | null,
    guestPlan?: NutritionPlanning | null
): NutritionPlanning | undefined {
    if (!cloudPlan && !guestPlan) return undefined;
    if (!cloudPlan) return guestPlan || undefined;
    if (!guestPlan) return cloudPlan || undefined;

    return {
        ...cloudPlan,
        ...guestPlan,
        avgMacros: guestPlan.avgMacros || cloudPlan.avgMacros,
        onBoost: guestPlan.onBoost || cloudPlan.onBoost,
        onMacros: guestPlan.onMacros || cloudPlan.onMacros,
        offMacros: guestPlan.offMacros || cloudPlan.offMacros,
        normocalorica: {
            ...(cloudPlan.normocalorica || {}),
            ...(guestPlan.normocalorica || {})
        }
    };
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
            result[date] = { ...cloudDay };
        } else if (!cloudDay && guestDay) {
            result[date] = { ...guestDay };
        } else if (cloudDay && guestDay) {
            const mergedMeals = mergeArrayById(cloudDay.meals, guestDay.meals);
            const mergedSupplementsIntake = mergeArrayById(cloudDay.supplementsIntake, guestDay.supplementsIntake);

            let kcal = guestDay.kcal || cloudDay.kcal || 0;
            let carbs = guestDay.carbs || cloudDay.carbs || 0;
            let pro = guestDay.pro || cloudDay.pro || 0;
            let fat = guestDay.fat || cloudDay.fat || 0;

            if (mergedMeals.length > 0) {
                let mKcal = 0, mCarbs = 0, mPro = 0, mFat = 0;
                for (const m of mergedMeals) {
                    const qty = (m as any).quantity ?? (m as any).baseQty ?? 100;
                    const base = (m as any).baseQty ?? 100;
                    const ratio = base > 0 ? qty / base : 1;
                    mKcal += (parseFloat((m as any).kcal) || 0) * ratio;
                    mCarbs += (parseFloat((m as any).carbs) || 0) * ratio;
                    mPro += (parseFloat((m as any).pro) || 0) * ratio;
                    mFat += (parseFloat((m as any).fat) || 0) * ratio;
                }
                kcal = Math.round(mKcal);
                carbs = Math.round(mCarbs * 10) / 10;
                pro = Math.round(mPro * 10) / 10;
                fat = Math.round(mFat * 10) / 10;
            }

            const pickVal = (gVal: any, cVal: any) =>
                (gVal !== undefined && gVal !== null && gVal !== '') ? gVal : cVal;

            result[date] = {
                date,
                kcal,
                carbs,
                pro,
                fat,
                weight: pickVal(guestDay.weight, cloudDay.weight),
                bf: pickVal(guestDay.bf, cloudDay.bf),
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
                meals: mergedMeals,
                supplementsIntake: mergedSupplementsIntake,
            };
        }
    }

    return result;
}

/**
 * Checks whether a `UserData` object contains any user-created data.
 */
export function hasUserData(data?: UserData | null): boolean {
    if (!data) return false;
    if (data.history && data.history.length > 0) return true;
    if (data.routines && data.routines.length > 0) return true;
    if (data.library && data.library.length > 0) return true;
    if (data.customFoods && data.customFoods.length > 0) return true;
    if (data.trainingCycles && data.trainingCycles.length > 0) return true;
    if (data.supplements && data.supplements.length > 0) return true;
    if (data.nutrition && Object.keys(data.nutrition).length > 0) return true;
    if (data.activeWorkout && data.activeWorkout.exercises && data.activeWorkout.exercises.length > 0) return true;
    if (data.profile && Object.values(data.profile).some(v => v !== undefined && v !== null && v !== '')) return true;
    return false;
}

/**
 * Deterministically merges cloud data and guest data across all collections.
 * - Array collections (`library`, `routines`, `customFoods`, `trainingCycles`, `history`, `supplements`):
 *   deduplicated by `id`, guest priority on collision.
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

    const rawMerged: UserData = {
        profile: mergeProfile(cloud.profile, guest.profile),
        library: mergeArrayById(cloud.library, guest.library),
        routines: mergeArrayById(cloud.routines, guest.routines),
        history: mergeArrayById(cloud.history, guest.history),
        nutrition: mergeNutrition(cloud.nutrition, guest.nutrition),
        customFoods: mergeArrayById(cloud.customFoods, guest.customFoods),
        activeWorkout: guest.activeWorkout !== undefined && guest.activeWorkout !== null
            ? guest.activeWorkout
            : (cloud.activeWorkout || null),
        nutritionPlanning: mergeNutritionPlanning(cloud.nutritionPlanning, guest.nutritionPlanning),
        trainingCycles: mergeArrayById(cloud.trainingCycles, guest.trainingCycles),
        activeCycleId: (guest.activeCycleId !== undefined && guest.activeCycleId !== null && guest.activeCycleId !== '')
            ? guest.activeCycleId
            : (cloud.activeCycleId || null),
        supplements: mergeArrayById(cloud.supplements, guest.supplements),
    };

    return UserDataSchema.parse(rawMerged) as unknown as UserData;
}
