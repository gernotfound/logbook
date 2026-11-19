import type {
    Exercise,
    SessionExercise,
    SessionExerciseSet,
    SetSegment,
    TrainingCycleProgressionFocus,
    WorkoutSession,
} from '../../types';
import { getSetSegments, getSetTechnique } from '../advancedSets';
import type {
    NormalizedExposure,
    NormalizedSet,
    ProgressionBodyweightContext,
    ProgressionExerciseRef,
} from './progression';

function numberValue(value: unknown): number | undefined {
    const raw = typeof value === 'string' ? value.trim().replace(',', '.') : value;
    if (raw === '' || raw === null || raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInt(value: unknown): number | undefined {
    const parsed = numberValue(value);
    if (parsed === undefined || !Number.isSafeInteger(parsed) || parsed < 0) return undefined;
    return parsed;
}

function parseTimeSeconds(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const raw = value.trim().toLowerCase().replace(/\s+/g, '');
    if (/^\d+(?:[.,]\d+)?s$/.test(raw)) return numberValue(raw.slice(0, -1));
    if (/^\d+(?:[.,]\d+)?$/.test(raw)) return numberValue(raw);
    const components = raw.split(':');
    // Number() also accepts empty fields and hexadecimal/exponent syntax,
    // neither of which is a valid colon-separated duration component.
    if (components.some(component => !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(component))) return undefined;
    const parts = components.map(Number);
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return undefined;
    const seconds = parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts.length === 3
            ? parts[0] * 3600 + parts[1] * 60 + parts[2]
            : undefined;
    return seconds !== undefined && Number.isFinite(seconds) ? seconds : undefined;
}

function validRir(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ? value : undefined;
}

export function historicalBodyweight(
    date: string,
    context: ProgressionBodyweightContext,
): number | undefined {
    if (Number.isFinite(context.explicitBodyweightKg) && (context.explicitBodyweightKg ?? 0) > 0) return context.explicitBodyweightKg;
    if (!date || !context.nutrition) return undefined;
    let latestDate = '';
    let latestWeight: number | undefined;
    for (const [day, entry] of Object.entries(context.nutrition)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > date || day <= latestDate) continue;
        const weight = numberValue(entry?.weight);
        if (weight !== undefined && weight > 0) {
            latestDate = day;
            latestWeight = weight;
        }
    }
    return latestWeight;
}


export function createHistoricalBodyweightLookup(nutrition: ProgressionBodyweightContext['nutrition']): (date: string) => number | undefined {
    // Standalone normalisation keeps its existing lookup contract. A complete
    // report can index dated weigh-ins once rather than sort them per exercise.
    const measurements = Object.keys(nutrition ?? {})
        .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort()
        .flatMap(date => {
            const weight = numberValue(nutrition?.[date]?.weight);
            return weight !== undefined && weight > 0 ? [{ date, weight }] : [];
        });
    return (date: string) => {
        if (!date) return undefined;
        let low = 0;
        let high = measurements.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (measurements[mid].date <= date) low = mid + 1;
            else high = mid;
        }
        return low ? measurements[low - 1].weight : undefined;
    };
}

function effectiveLoad(
    kg: number | undefined,
    exercise: ProgressionExerciseRef | undefined,
    bodyweightKg: number | undefined,
): number | undefined {
    const equipment = numberValue(exercise?.equipmentWeight) ?? 0;
    if (exercise?.isBodyweight && bodyweightKg === undefined) return undefined;
    if (!exercise?.isBodyweight && kg === undefined && equipment === 0) return undefined;
    const load = (kg ?? 0) + (exercise?.isBodyweight ? (bodyweightKg ?? 0) : 0) + equipment;
    return Number.isFinite(load) ? load : undefined;
}

function normalizeMeasurements(
    input: Pick<SessionExerciseSet, 'kg' | 'reps' | 'time'>,
    exercise: ProgressionExerciseRef | undefined,
    bodyweightKg: number | undefined,
): Pick<NormalizedSet, 'kg' | 'effectiveKg' | 'reps' | 'timeSeconds'> {
    const kg = numberValue(input.kg);
    const effectiveKg = effectiveLoad(kg, exercise, bodyweightKg);
    const reps = positiveInt(input.reps);
    const timeSeconds = parseTimeSeconds(input.time);
    return {
        ...(kg !== undefined ? { kg } : {}),
        ...(effectiveKg !== undefined ? { effectiveKg } : {}),
        ...(reps !== undefined ? { reps } : {}),
        ...(timeSeconds !== undefined ? { timeSeconds } : {}),
    };
}

function normalizeSegment(
    segment: SetSegment,
    exercise: ProgressionExerciseRef | undefined,
    bodyweightKg: number | undefined,
): NormalizedSet['segments'][number] {
    return {
        ...(segment.technique ? { technique: segment.technique } : {}),
        ...normalizeMeasurements(segment, exercise, bodyweightKg),
        ...(segment.restBeforeSeconds !== undefined ? { restBeforeSeconds: segment.restBeforeSeconds } : {}),
        ...(segment.target?.type === 'reps' ? { targetReps: segment.target.reps } : {}),
    };
}

function normalizeSet(
    set: SessionExerciseSet,
    exercise: ProgressionExerciseRef | undefined,
    bodyweightKg: number | undefined,
): NormalizedSet {
    const { timeSeconds, ...measurements } = normalizeMeasurements(set, exercise, bodyweightKg);
    const rir = validRir(set.rir);
    return {
        technique: getSetTechnique(set),
        executionMode: set.executionMode ?? 'standard',
        ...measurements,
        ...(rir !== undefined ? { rir } : {}),
        ...(timeSeconds !== undefined ? { timeSeconds } : {}),
        segments: getSetSegments(set).map(segment => normalizeSegment(segment, exercise, bodyweightKg)),
        ...(set.target?.type === 'reps' ? { targetReps: set.target.reps } : {}),
    };
}

function hasObservedSet(set: NormalizedSet, trackingType: Exercise['trackingType']): boolean {
    if (trackingType === 'time') {
        return (set.timeSeconds ?? 0) > 0 || set.segments.some(segment => (segment.timeSeconds ?? 0) > 0);
    }
    if (trackingType === 'cardio') {
        return (set.timeSeconds ?? 0) > 0 || (set.reps ?? 0) > 0
            || set.segments.some(segment => (segment.timeSeconds ?? 0) > 0 || (segment.reps ?? 0) > 0);
    }
    return (set.reps ?? 0) > 0
        || set.segments.some(segment => (segment.reps ?? 0) > 0 || (segment.timeSeconds ?? 0) > 0);
}

function referenceSet(sets: NormalizedSet[], trackingType: Exercise['trackingType']): NormalizedSet | undefined {
    const observed = sets.filter(set => hasObservedSet(set, trackingType));
    if (observed.length === 0) return undefined;
    if (trackingType !== 'weight_reps') return observed[0];
    return observed.reduce<NormalizedSet | undefined>((best, candidate) => {
        if (!best) return candidate;
        const bestLoad = best.effectiveKg ?? best.kg ?? -Infinity;
        const candidateLoad = candidate.effectiveKg ?? candidate.kg ?? -Infinity;
        if (candidateLoad !== bestLoad) return candidateLoad > bestLoad ? candidate : best;
        return (candidate.reps ?? 0) > (best.reps ?? 0) ? candidate : best;
    }, undefined);
}

export function normalizeExerciseExposureWithWeight(
    session: WorkoutSession,
    sessionExercise: SessionExercise,
    exercise: ProgressionExerciseRef | undefined,
    bodyweightKg: number | undefined,
): NormalizedExposure {
    const date = session.date ?? '';
    const trackingType = exercise?.trackingType ?? 'weight_reps';
    const sets = (sessionExercise.sets ?? []).map(set => normalizeSet(set, exercise, bodyweightKg));
    const observedSets = sets.filter(set => hasObservedSet(set, trackingType));
    let totalReps = 0;
    let tonnage = 0;
    let tonnageComplete = true;
    const recordReps = (reps: number, effectiveKg: number | undefined): void => {
        totalReps += reps;
        if (effectiveKg === undefined) {
            tonnageComplete = false;
            return;
        }
        // Finite inputs can still overflow when multiplied or accumulated.
        const nextTonnage = tonnage + effectiveKg * reps;
        if (!Number.isFinite(nextTonnage)) {
            tonnageComplete = false;
            return;
        }
        tonnage = nextTonnage;
    };
    for (const set of observedSets) {
        if (set.timeSeconds && !set.reps) tonnageComplete = false;
        if (set.reps) recordReps(set.reps, set.effectiveKg);
        for (const segment of set.segments) {
            if (segment.timeSeconds && !segment.reps) tonnageComplete = false;
            if (segment.reps) recordReps(segment.reps, segment.effectiveKg);
        }
    }
    const ref = referenceSet(sets, trackingType);
    return {
        sessionId: session.id ?? '',
        date,
        ...(session.routineId ? { routineId: session.routineId } : {}),
        ...(session.cycleId ? { cycleId: session.cycleId } : {}),
        ...(session.cycleStrategy?.intent ? { intent: session.cycleStrategy.intent } : {}),
        ...((sessionExercise.progressionContract?.metric ?? session.cycleStrategy?.progressionFocus)
            ? { focus: (sessionExercise.progressionContract?.metric ?? session.cycleStrategy?.progressionFocus) as TrainingCycleProgressionFocus }
            : {}),
        ...(sessionExercise.technicalStandard?.trim() ? { technicalStandard: sessionExercise.technicalStandard.trim() } : {}),
        ...(sessionExercise.progressionContract ? { progressionContract: structuredClone(sessionExercise.progressionContract) } : {}),
        exId: sessionExercise.exId,
        exName: exercise?.name ?? 'Esercizio',
        trackingType,
        isBodyweight: Boolean(exercise?.isBodyweight),
        ...(bodyweightKg !== undefined ? { bodyweightKg } : {}),
        sets,
        workSets: observedSets.length,
        totalReps,
        ...(tonnageComplete ? { tonnageKg: tonnage } : {}),
        tonnageComplete,
        ...(ref ? { referenceSet: ref } : {}),
    };
}

export function normalizeExerciseExposure(
    session: WorkoutSession,
    sessionExercise: SessionExercise,
    exercise: ProgressionExerciseRef | undefined,
    context: ProgressionBodyweightContext = {},
): NormalizedExposure {
    const bodyweightKg = exercise?.isBodyweight ? historicalBodyweight(session.date ?? '', context) : undefined;
    return normalizeExerciseExposureWithWeight(session, sessionExercise, exercise, bodyweightKg);
}
