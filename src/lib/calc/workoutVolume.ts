import { getSetSegments } from '../advancedSets';
import { parseDateInput } from '../utils/date';

export interface VolumeExerciseRef {
    isBodyweight?: boolean;
    equipmentWeight?: number;
    trackingType?: 'weight_reps' | 'time' | 'cardio';
}

/** A single strict parser for local-day weight aggregates and current-weight lookup. */
export function parsePositiveWeight(raw: unknown): number | null {
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    const normalized = typeof raw === 'string' ? raw.trim().replace(',', '.') : raw;
    if (typeof normalized === 'string' && !/^\d+(?:\.\d+)?$/.test(normalized)) return null;
    const value = Number(normalized);
    return Number.isFinite(value) && value > 0 ? value : null;
}

export function getLatestUserWeight(
    nutrition?: Record<string, { weight?: string | number | null } | undefined> | null,
    nutritionPlanning?: { weight?: number | string } | null
): number {
    let latestWeight: number | null = null;
    if (nutrition && typeof nutrition === 'object') {
        let latestDate: string | null = null;
        for (const [date, day] of Object.entries(nutrition)) {
            // Only canonical persisted day keys can establish measurement recency.
            const canonicalDate = parseDateInput(date);
            if (canonicalDate !== date || !day || day.weight === undefined || day.weight === null || day.weight === '') continue;
            const weight = parsePositiveWeight(day.weight);
            if (weight !== null && (latestDate === null || canonicalDate >= latestDate)) {
                latestDate = canonicalDate;
                latestWeight = weight;
            }
        }
    }
    if (latestWeight !== null) return latestWeight;
    if (nutritionPlanning?.weight) {
        const planWeight = parsePositiveWeight(nutritionPlanning.weight);
        if (planWeight !== null) return planWeight;
    }
    return 80;
}

// Assisted sets can have signed loads; malformed or non-finite numeric
// text must not contaminate the tonnage of otherwise valid workout sets.
function parseFiniteSetLoad(raw: string | number | undefined | null): number {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    if (typeof raw !== 'string') return 0;
    const normalized = raw.trim().replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return 0;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : 0;
}

export function calculateEffectiveSetWeight(
    setKg: string | number | undefined | null,
    exercise?: VolumeExerciseRef | null,
    userWeight: number = 80
): number {
    const baseKg = parseFiniteSetLoad(setKg);
    const bw = exercise?.isBodyweight && Number.isFinite(userWeight) && userWeight > 0 ? userWeight : 0;
    const eq = typeof exercise?.equipmentWeight === 'number'
        && Number.isFinite(exercise.equipmentWeight) && exercise.equipmentWeight > 0
        ? exercise.equipmentWeight : 0;
    const total = baseKg + bw + eq;
    return Number.isFinite(total) ? total : 0;
}

function observedReps(raw: unknown): number {
    const text = String(raw ?? '').trim();
    if (!/^-?\d+$/.test(text)) return 0;
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : 0;
}

export function calculateSetVolume(
    set: {
        kg?: string | number;
        reps?: string | number;
        segments?: Array<{ kg?: string | number; reps?: string | number }>;
    },
    exercise?: VolumeExerciseRef | null,
    userWeight: number = 80
): number {
    if (!set) return 0;
    const reps = observedReps(set.reps);
    const effectiveWeight = calculateEffectiveSetWeight(set.kg, exercise, userWeight);
    let volume = effectiveWeight * reps;

    for (const segment of getSetSegments(set as any)) {
        const segmentReps = observedReps(segment.reps);
        const segmentEffectiveWeight = calculateEffectiveSetWeight(segment.kg, exercise, userWeight);
        volume += segmentEffectiveWeight * segmentReps;
    }
    return volume;
}

export function calculateWorkoutVolume(
    session: { exercises?: Array<{ exId?: string; sets?: any[] }> },
    library: Array<{ id: string; isBodyweight?: boolean; equipmentWeight?: number; trackingType?: 'weight_reps' | 'time' | 'cardio' }> | ReadonlyMap<string, VolumeExerciseRef> = [],
    userWeight: number = 80
): number {
    if (!session || !Array.isArray(session.exercises)) return 0;
    // Callers analyzing multiple sessions may share an immutable catalog lookup.
    // An array keeps the original last-ID-wins lookup semantics.
    let libMap: ReadonlyMap<string, VolumeExerciseRef>;
    if (Array.isArray(library)) {
        const entries = new Map<string, VolumeExerciseRef>();
        for (const entry of library) {
            if (entry?.id) entries.set(entry.id, entry);
        }
        libMap = entries;
    } else {
        libMap = library as ReadonlyMap<string, VolumeExerciseRef>;
    }

    let totalVolume = 0;
    for (const ex of session.exercises) {
        if (!ex) continue;
        const libEx = ex.exId ? libMap.get(ex.exId) : null;
        // Numeric set fields on cardio/time exercises must not contribute mechanical tonnage.
        if (libEx?.trackingType === 'cardio' || libEx?.trackingType === 'time') continue;
        if (!Array.isArray(ex.sets)) continue;
        for (const s of ex.sets) {
            totalVolume += calculateSetVolume(s, libEx, userWeight);
        }
    }
    return totalVolume;
}
