import type {
    Exercise,
    NutritionDay,
    ProgressionContract,
    SessionExercise,
    SetContinuationTechnique,
    SetTechnique,
    TrainingCycleIntent,
    TrainingCycleProgressionFocus,
    WorkoutSession,
} from '../../types';
import { getWorkoutDurationSeconds } from './workoutDuration';
import { compareSessionChronology, orderedEarlierSessions } from './progressionHistory';
import {
    createHistoricalBodyweightLookup,
    historicalBodyweight,
    normalizeExerciseExposure,
    normalizeExerciseExposureWithWeight,
} from './progressionExposure';

import { compareExposureCompatibility, compareReferenceOutput, qualityFor, rirChange, selectBestHistorical, strongRecord } from './progressionComparisons';
import type { HistoricalExposureComparison } from './progressionComparisons';
import { describe } from './progressionPresentation';

export { normalizeExerciseExposure };
export { compareExposureCompatibility } from './progressionComparisons';
export { formatProgressionReference, progressionQualityLabel, progressionTrendLabel } from './progressionPresentation';

export type ProgressionExerciseRef = Pick<Exercise, 'id' | 'name' | 'trackingType' | 'isBodyweight' | 'equipmentWeight' | 'muscles' | 'secondaryMuscles'>;

type ComparisonLevel = 'high' | 'medium' | 'none';
export type ProgressionQuality = 'clear' | 'preliminary' | 'limited';
export type ProgressionClassification =
    | 'performance_record'
    | 'progression'
    | 'output_up_effort_up'
    | 'output_lower'
    | 'stable'
    | 'stable_less_effort'
    | 'stable_more_effort'
    | 'volume_progression'
    | 'maintenance_stable'
    | 'maintenance_change'
    | 'deload_change'
    | 'new_baseline'
    | 'execution_baseline'
    | 'density_limited'
    | 'descriptive_change'
    | 'insufficient_data';

export type OutputChange = 'better' | 'same' | 'worse' | 'longer' | 'shorter' | 'mixed' | 'unknown';
type TrendDirection = 'up' | 'stable' | 'down' | 'duration_up' | 'duration_down' | 'mixed' | 'insufficient';

export interface ProgressionBodyweightContext {
    nutrition?: Record<string, NutritionDay>;
    explicitBodyweightKg?: number;
}

export interface NormalizedSet {
    technique: SetTechnique;
    executionMode: 'standard' | 'stop_reps';
    kg?: number;
    effectiveKg?: number;
    reps?: number;
    rir?: number;
    timeSeconds?: number;
    segments: Array<{
        technique?: SetContinuationTechnique;
        kg?: number;
        effectiveKg?: number;
        reps?: number;
        timeSeconds?: number;
        restBeforeSeconds?: number;
        targetReps?: number;
    }>;
    targetReps?: number;
}

export interface NormalizedExposure {
    sessionId: string;
    date: string;
    routineId?: string;
    cycleId?: string;
    intent?: TrainingCycleIntent;
    focus?: TrainingCycleProgressionFocus;
    technicalStandard?: string;
    progressionContract?: ProgressionContract;
    exId: string;
    exName: string;
    trackingType: Exercise['trackingType'];
    isBodyweight: boolean;
    bodyweightKg?: number;
    sets: NormalizedSet[];
    workSets: number;
    totalReps: number;
    tonnageKg?: number;
    tonnageComplete: boolean;
    referenceSet?: NormalizedSet;
}

export interface ExposureComparison {
    level: ComparisonLevel;
    reasons: string[];
}

export interface ExerciseProgressionAnalysis {
    exId: string;
    exName: string;
    intent?: TrainingCycleIntent;
    focus?: TrainingCycleProgressionFocus;
    priority: 'primary' | 'secondary' | 'other';
    current: NormalizedExposure;
    latestExposure?: NormalizedExposure;
    previousComparable?: NormalizedExposure;
    cycleBaseline?: NormalizedExposure;
    bestHistorical?: NormalizedExposure;
    recentComparable: NormalizedExposure[];
    comparison: ExposureComparison;
    comparisonStatus: 'comparable' | 'limited' | 'not_comparable';
    progressionContract?: ProgressionContract;
    quality: ProgressionQuality;
    qualityReasons: string[];
    classification: ProgressionClassification;
    outputChange: OutputChange;
    trendDirection: TrendDirection;
    isRecord: boolean;
    headline: string;
    detail: string;
}

export interface DensityProgressionAnalysis {
    quality: ProgressionQuality;
    headline: string;
    detail: string;
    previousDurationSeconds?: number;
    currentDurationSeconds?: number;
}

export interface ProgressionEngineResult {
    exercises: ExerciseProgressionAnalysis[];
    density?: DensityProgressionAnalysis;
}

function classificationFor(
    current: NormalizedExposure,
    previous: NormalizedExposure | undefined,
    output: OutputChange,
    isRecord: boolean,
): ProgressionClassification {
    if (!previous) return 'new_baseline';
    if (current.intent === 'deload') return 'deload_change';
    if (current.focus === 'density') return 'density_limited';
    if (current.focus === 'execution') return 'execution_baseline';
    const effort = rirChange(current.referenceSet, previous.referenceSet);
    if (current.intent === 'maintenance') {
        return output === 'same' && current.workSets <= previous.workSets ? 'maintenance_stable' : 'maintenance_change';
    }
    if (current.focus === 'volume') {
        const tonnageUp = current.tonnageKg !== undefined && previous.tonnageKg !== undefined && current.tonnageKg > previous.tonnageKg;
        if (current.workSets > previous.workSets || current.totalReps > previous.totalReps || tonnageUp) return 'volume_progression';
    }
    if (isRecord) return 'performance_record';
    if (output === 'better' && effort === 'more') return 'output_up_effort_up';
    if (output === 'better') return 'progression';
    if (output === 'same' && effort === 'less') return 'stable_less_effort';
    if (output === 'same' && effort === 'more') return 'stable_more_effort';
    if (output === 'same') return 'stable';
    if (output === 'worse') return 'output_lower';
    if (output === 'unknown') return 'insufficient_data';
    return 'descriptive_change';
}

function trendFor(exposures: NormalizedExposure[]): TrendDirection {
    if (exposures.length < 3) return 'insufficient';
    const directions: OutputChange[] = [];
    for (let index = 1; index < exposures.length; index++) {
        const current = exposures[index];
        const previous = exposures[index - 1];
        const output = compareReferenceOutput(current.referenceSet, previous.referenceSet, current.trackingType);
        if (output === 'better' && rirChange(current.referenceSet, previous.referenceSet) === 'more') directions.push('mixed');
        else directions.push(output);
    }
    if (directions.every(value => value === 'same')) return 'stable';
    if (exposures.at(-1)?.trackingType === 'time') {
        if (directions.includes('unknown')) return 'insufficient';
        if (directions.every(value => value === 'longer' || value === 'same')) return 'duration_up';
        if (directions.every(value => value === 'shorter' || value === 'same')) return 'duration_down';
        return 'mixed';
    }
    if (directions.every(value => value === 'better' || value === 'same') && directions.some(value => value === 'better')) return 'up';
    if (directions.every(value => value === 'worse' || value === 'same') && directions.some(value => value === 'worse')) return 'down';
    return 'mixed';
}

function priorityFor(
    exercise: ProgressionExerciseRef | undefined,
    session: WorkoutSession,
    contractRole?: ProgressionContract['role'],
): ExerciseProgressionAnalysis['priority'] {
    if (contractRole === 'primary') return 'primary';
    if (contractRole === 'secondary') return 'secondary';
    const muscles = new Set([...(exercise?.muscles ?? []), ...(exercise?.secondaryMuscles ?? [])]);
    if ((session.cycleStrategy?.primaryMuscles ?? []).some(muscle => muscles.has(muscle))) return 'primary';
    if ((session.cycleStrategy?.secondaryMuscles ?? []).some(muscle => muscles.has(muscle))) return 'secondary';
    return 'other';
}

function observedSessionWorkSets(
    session: WorkoutSession,
    libraryMap: Map<string, ProgressionExerciseRef>,
    context: ProgressionBodyweightContext,
): number {
    return (session.exercises ?? []).reduce((sum, exercise) => {
        if (!exercise?.exId) return sum;
        return sum + normalizeExerciseExposure(session, exercise, libraryMap.get(exercise.exId), context).workSets;
    }, 0);
}

function densityAnalysis(
    current: WorkoutSession,
    orderedHistory: WorkoutSession[],
    libraryMap: Map<string, ProgressionExerciseRef>,
    context: ProgressionBodyweightContext,
): DensityProgressionAnalysis | undefined {
    if (current.cycleStrategy?.progressionFocus !== 'density') return undefined;
    const currentDuration = getWorkoutDurationSeconds(current);
    let previous: WorkoutSession | undefined;
    for (const item of orderedHistory) {
        if (item.id === current.id
            || item.routineId !== current.routineId
            || item.cycleStrategy?.progressionFocus !== 'density'
            || (current.cycleId && item.cycleId !== current.cycleId)) continue;
        // Earlier sessions are already ordered. Preserve the first input
        // occurrence when multiple sessions have identical chronology.
        if (!previous || compareSessionChronology(item, previous) > 0) previous = item;
    }
    const previousDuration = previous ? getWorkoutDurationSeconds(previous) : undefined;
    if (!previous || currentDuration === undefined || previousDuration === undefined) {
        return { quality: 'limited', headline: 'Confronto densità limitato', detail: 'Serve la durata di due sessioni della stessa scheda; non vengono inventati tempi per esercizio.' };
    }
    const currentSets = observedSessionWorkSets(current, libraryMap, context);
    const previousSets = observedSessionWorkSets(previous, libraryMap, context);
    if (currentSets === 0 || previousSets === 0) {
        return {
            quality: 'limited',
            headline: 'Confronto densità senza lavoro osservabile',
            detail: 'Serve almeno una serie eseguita osservabile in entrambe le sessioni; la sola durata non misura la densità.',
            previousDurationSeconds: previousDuration,
            currentDurationSeconds: currentDuration,
        };
    }
    const similarWork = Math.abs(currentSets - previousSets) <= Math.max(1, Math.round(previousSets * 0.1));
    if (!similarWork) {
        return { quality: 'limited', headline: 'Durata cambiata con lavoro diverso', detail: `${Math.round(previousDuration / 60)} → ${Math.round(currentDuration / 60)} min, ma il numero di serie è cambiato: non dichiaro una progressione di densità.`, previousDurationSeconds: previousDuration, currentDurationSeconds: currentDuration };
    }
    const direction = currentDuration < previousDuration ? 'ridotta' : currentDuration > previousDuration ? 'aumentata' : 'stabile';
    return {
        quality: 'preliminary',
        headline: `Durata sessione ${direction} con lavoro osservabile simile`,
        detail: `${Math.round(previousDuration / 60)} → ${Math.round(currentDuration / 60)} min. È un'indicazione a livello di sessione, non una misura precisa per esercizio.`,
        previousDurationSeconds: previousDuration,
        currentDurationSeconds: currentDuration,
    };
}

export function computeProgressionEngine(
    currentWorkout: WorkoutSession,
    history: WorkoutSession[],
    libraryMap: Map<string, ProgressionExerciseRef>,
    context: ProgressionBodyweightContext = {},
): ProgressionEngineResult {
    const analyses: ExerciseProgressionAnalysis[] = [];
    const orderedHistory = orderedEarlierSessions(history, currentWorkout);
    const requestedIds = new Set((currentWorkout.exercises ?? [])
        .filter(item => Boolean(item?.exId))
        .map(item => item.exId));
    const historicalById = new Map<string, { session: WorkoutSession; exercise: SessionExercise }[]>();
    // Search each historical session's exercise list once; the first matching
    // exercise in a session remains authoritative if malformed duplicates exist.
    for (const session of orderedHistory) {
        const seen = new Set<string>();
        for (const exercise of session.exercises ?? []) {
            const id = exercise?.exId;
            if (!id || !requestedIds.has(id) || seen.has(id)) continue;
            seen.add(id);
            const matches = historicalById.get(id) ?? [];
            matches.push({ session, exercise });
            historicalById.set(id, matches);
        }
    }
    const usesBodyweight = [...requestedIds].some(id => libraryMap.get(id)?.isBodyweight);
    const weightAtDate = usesBodyweight ? createHistoricalBodyweightLookup(context.nutrition) : undefined;
    const currentBodyweight = usesBodyweight
        ? historicalBodyweight(currentWorkout.date ?? '', context)
        : undefined;
    for (const currentExercise of currentWorkout.exercises ?? []) {
        if (!currentExercise?.exId) continue;
        const exercise = libraryMap.get(currentExercise.exId);
        const current = normalizeExerciseExposureWithWeight(currentWorkout, currentExercise, exercise,
            exercise?.isBodyweight ? currentBodyweight : undefined);
        // A current-only explicit weight is never used to rewrite historic loads.
        const historical = (historicalById.get(currentExercise.exId) ?? []).map(({ session, exercise: prior }) =>
            normalizeExerciseExposureWithWeight(session, prior, exercise,
                exercise?.isBodyweight ? weightAtDate?.(session.date ?? '') : undefined)
        );

        const comparisons: HistoricalExposureComparison[] = historical.map(exposure => ({
            exposure,
            comparison: compareExposureCompatibility(current, exposure),
        }));
        const latestExposure = historical.at(-1);
        const comparable = comparisons.filter(item => item.comparison.level !== 'none');
        const previousComparable = comparable.at(-1)?.exposure;
        const comparison = comparable.at(-1)?.comparison
            ?? comparisons.at(-1)?.comparison
            ?? { level: 'none' as const, reasons: ['Nessuna esposizione precedente disponibile.'] };
        const recentHistorical = comparable.slice(-3);
        const recentComparable = [...recentHistorical.map(item => item.exposure), current];
        const recentLimitations = recentHistorical.filter(item => item.comparison.level === 'medium');
        const cycleBaseline = current.cycleId
            ? comparable.find(item => item.exposure.cycleId === current.cycleId)?.exposure
            : undefined;
        const bestHistorical = selectBestHistorical(comparisons, current.trackingType);
        const isRecord = strongRecord(current, comparisons);
        const outputChange = previousComparable
            ? compareReferenceOutput(current.referenceSet, previousComparable.referenceSet, current.trackingType)
            : 'unknown';
        const classification = !current.referenceSet
            ? 'insufficient_data'
            : comparison.level === 'none' && latestExposure
                ? 'new_baseline'
                : classificationFor(current, previousComparable, outputChange, isRecord);
        const timedOutputUnverified = current.trackingType === 'time'
            && Boolean(previousComparable) && outputChange === 'unknown';
        const quality = timedOutputUnverified
            ? 'limited'
            : qualityFor(comparison, recentComparable.length, recentLimitations.length > 0);
        const qualityReasons = [
            ...comparison.reasons,
            ...(timedOutputUnverified ? ['Durata non verificabile per tutti i segmenti temporizzati confrontati.'] : []),
        ];
        for (const limitation of recentLimitations) {
            if (limitation.exposure.sessionId === previousComparable?.sessionId) continue;
            qualityReasons.push(
                ...limitation.comparison.reasons.map(
                    reason => `Esposizione del ${limitation.exposure.date || 'data non disponibile'}: ${reason}`,
                ),
            );
        }
        if (latestExposure && previousComparable && latestExposure.sessionId !== previousComparable.sessionId) {
            const latestComparison = comparisons.at(-1)?.comparison;
            if (latestComparison) qualityReasons.unshift(...latestComparison.reasons.map(reason => `Esposizione più recente esclusa: ${reason}`));
        }
        const description = describe(classification, current, previousComparable ?? latestExposure);
        analyses.push({
            exId: current.exId,
            exName: current.exName,
            ...(current.intent ? { intent: current.intent } : {}),
            ...(current.focus ? { focus: current.focus } : {}),
            priority: priorityFor(exercise, currentWorkout, current.progressionContract?.role),
            current,
            ...(latestExposure ? { latestExposure } : {}),
            ...(previousComparable ? { previousComparable } : {}),
            ...(cycleBaseline ? { cycleBaseline } : {}),
            ...(bestHistorical ? { bestHistorical } : {}),
            recentComparable,
            comparison,
            comparisonStatus: comparison.level === 'high' ? 'comparable' : comparison.level === 'medium' ? 'limited' : 'not_comparable',
            ...(current.progressionContract ? { progressionContract: current.progressionContract } : {}),
            quality,
            qualityReasons,
            classification,
            outputChange,
            trendDirection: trendFor(recentComparable),
            isRecord: classification === 'performance_record',
            ...description,
        });
    }

    const priorityOrder = { primary: 0, secondary: 1, other: 2 } as const;
    analyses.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    const density = densityAnalysis(currentWorkout, orderedHistory, libraryMap, context);
    return { exercises: analyses, ...(density ? { density } : {}) };
}
