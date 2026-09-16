import { Logic } from '../src/lib/logic';

/* =========================================================================
 * PURE CALCULATION & AUTO-HEALING CONTRACT HELPERS (R1, R2, R6)
 * ========================================================================= */

export function getLatestUserWeightContract(
    nutrition?: Record<string, any> | null,
    nutritionPlanning?: { weight?: number | string } | null
): number {
    if ((Logic as any).getLatestUserWeight) {
        return (Logic as any).getLatestUserWeight(nutrition, nutritionPlanning);
    }
    if (nutrition && typeof nutrition === 'object') {
        const sortedDates = Object.keys(nutrition).sort().reverse();
        for (const date of sortedDates) {
            const day = nutrition[date];
            if (day && day.weight !== undefined && day.weight !== null && day.weight !== '') {
                const num = typeof day.weight === 'number' ? day.weight : parseFloat(String(day.weight).trim().replace(',', '.'));
                if (!isNaN(num) && num > 0) return num;
            }
        }
    }
    if (nutritionPlanning?.weight !== undefined && nutritionPlanning?.weight !== null && nutritionPlanning?.weight !== '') {
        const num = typeof nutritionPlanning.weight === 'number' ? nutritionPlanning.weight : parseFloat(String(nutritionPlanning.weight).trim().replace(',', '.'));
        if (!isNaN(num) && num > 0) return num;
    }
    return 0;
}

export function calculateEffectiveSetWeightContract(
    setKg: string | number | undefined | null,
    exercise?: { isBodyweight?: boolean; equipmentWeight?: number } | null,
    userWeight: number = 0
): number {
    if ((Logic as any).calculateEffectiveSetWeight) {
        return (Logic as any).calculateEffectiveSetWeight(setKg, exercise, userWeight);
    }
    const rawKg = typeof setKg === 'number' ? setKg : parseFloat(String(setKg || '0').trim().replace(',', '.')) || 0;
    const equip = typeof exercise?.equipmentWeight === 'number' ? exercise.equipmentWeight : parseFloat(String(exercise?.equipmentWeight || '0').trim().replace(',', '.')) || 0;
    let total = rawKg + equip;
    if (exercise?.isBodyweight) {
        total += userWeight;
    }
    return total;
}

export function calculateSetVolumeContract(
    set: { kg?: string | number; reps?: string | number; dropsets?: Array<{ kg?: string | number; reps?: string | number }> },
    exercise?: { isBodyweight?: boolean; equipmentWeight?: number } | null,
    userWeight: number = 0
): number {
    if ((Logic as any).calculateSetVolume) {
        return (Logic as any).calculateSetVolume(set, exercise, userWeight);
    }
    const effectiveWeight = calculateEffectiveSetWeightContract(set.kg, exercise, userWeight);
    const reps = typeof set.reps === 'number' ? set.reps : parseInt(String(set.reps || '0').trim(), 10) || 0;
    let vol = effectiveWeight * reps;

    if (Array.isArray(set.dropsets)) {
        for (const ds of set.dropsets) {
            const dsEffectiveWeight = calculateEffectiveSetWeightContract(ds.kg, exercise, userWeight);
            const dsReps = typeof ds.reps === 'number' ? ds.reps : parseInt(String(ds.reps || '0').trim(), 10) || 0;
            vol += dsEffectiveWeight * dsReps;
        }
    }
    return vol;
}

export function calculateWorkoutVolumeContract(
    session: { exercises?: Array<{ exId?: string; sets?: any[] }> },
    library?: Array<{ id: string; isBodyweight?: boolean; equipmentWeight?: number }>,
    userWeight: number = 0
): number {
    if ((Logic as any).calculateWorkoutVolume) {
        return (Logic as any).calculateWorkoutVolume(session, library, userWeight);
    }
    if (!Array.isArray(session?.exercises)) return 0;
    const libMap = new Map((library || []).map(ex => [ex.id, ex]));
    let total = 0;
    for (const sex of session.exercises) {
        const ex = libMap.get(sex.exId || '');
        if (Array.isArray(sex.sets)) {
            for (const s of sex.sets) {
                total += calculateSetVolumeContract(s, ex, userWeight);
            }
        }
    }
    return total;
}

export function calculateRealtimeKcalContract(carbs: any, pro: any, fat: any): number {
    const c = typeof carbs === 'number' ? carbs : parseFloat(String(carbs || '0').trim().replace(',', '.')) || 0;
    const p = typeof pro === 'number' ? pro : parseFloat(String(pro || '0').trim().replace(',', '.')) || 0;
    const f = typeof fat === 'number' ? fat : parseFloat(String(fat || '0').trim().replace(',', '.')) || 0;
    return Math.round(c * 4 + p * 4 + f * 9);
}

export function autoHealPainsContract(
    activePains: string[] = [],
    sessionExercises: Array<{ exId?: string }> = [],
    library: Array<{ id: string; muscles?: string[] }> = [],
    sessionPains: string[] = []
): string[] {
    if ((Logic as any).autoHealPains) {
        return (Logic as any).autoHealPains(activePains, sessionExercises, library, sessionPains);
    }
    const libMap = new Map(library.map(ex => [ex.id, ex]));
    const trainedPrimaryMuscles = new Set<string>();
    for (const se of sessionExercises) {
        const ex = libMap.get(se.exId || '');
        if (Array.isArray(ex?.muscles)) {
            ex.muscles.forEach(m => trainedPrimaryMuscles.add(m));
        }
    }

    const sessionPainsSet = new Set(sessionPains);
    const resultPains: string[] = [];

    // Evaluate active pains
    for (const pain of activePains) {
        if (trainedPrimaryMuscles.has(pain)) {
            // Trained as primary: keep only if explicitly selected in session pains
            if (sessionPainsSet.has(pain)) {
                resultPains.push(pain);
            }
        } else {
            // Untrained: preserve
            resultPains.push(pain);
        }
    }

    // Add new session pains
    for (const pain of sessionPains) {
        if (!resultPains.includes(pain)) {
            resultPains.push(pain);
        }
    }

    return resultPains;
}
