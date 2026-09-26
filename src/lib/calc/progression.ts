import type {
    Exercise,
    NutritionDay,
    ProgressionContract,
    SessionExercise,
    SessionExerciseSet,
    SetSegment,
    SetTechnique,
    TrainingCycleIntent,
    TrainingCycleProgressionFocus,
    WorkoutSession,
} from '../../types';
import { getSetSegments, getSetTechnique } from '../advancedSets';

export type ProgressionExerciseRef = Pick<Exercise, 'id' | 'name' | 'trackingType' | 'isBodyweight' | 'equipmentWeight' | 'muscles' | 'secondaryMuscles'>;

export type ComparisonLevel = 'high' | 'medium' | 'none';
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

type OutputChange = 'better' | 'same' | 'worse' | 'mixed' | 'unknown';
type TrendDirection = 'up' | 'stable' | 'down' | 'mixed' | 'insufficient';

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
        kg?: number;
        effectiveKg?: number;
        reps?: number;
        timeSeconds?: number;
        restBeforeSeconds?: number;
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

function numberValue(value: unknown): number | undefined {
    const raw = typeof value === 'string' ? value.trim().replace(',', '.') : value;
    if (raw === '' || raw === null || raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInt(value: unknown): number | undefined {
    const parsed = numberValue(value);
    if (parsed === undefined || parsed < 0) return undefined;
    return Math.trunc(parsed);
}

function parseTimeSeconds(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const raw = value.trim().toLowerCase().replace(/\s+/g, '');
    if (/^\d+(?:[.,]\d+)?s$/.test(raw)) return numberValue(raw.slice(0, -1));
    if (/^\d+(?:[.,]\d+)?$/.test(raw)) return numberValue(raw);
    const parts = raw.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return undefined;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return undefined;
}

function validRir(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ? value : undefined;
}

function historicalBodyweight(
    date: string,
    context: ProgressionBodyweightContext,
): number | undefined {
    if (context.explicitBodyweightKg && context.explicitBodyweightKg > 0) return context.explicitBodyweightKg;
    if (!date || !context.nutrition) return undefined;
    const eligibleDates = Object.keys(context.nutrition)
        .filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key) && key <= date)
        .sort()
        .reverse();
    for (const key of eligibleDates) {
        const weight = numberValue(context.nutrition[key]?.weight);
        if (weight !== undefined && weight > 0) return weight;
    }
    return undefined;
}

function effectiveLoad(
    kg: number | undefined,
    exercise: ProgressionExerciseRef | undefined,
    bodyweightKg: number | undefined,
): number | undefined {
    const equipment = numberValue(exercise?.equipmentWeight) ?? 0;
    if (exercise?.isBodyweight) {
        if (bodyweightKg === undefined) return undefined;
        return (kg ?? 0) + bodyweightKg + equipment;
    }
    if (kg === undefined && equipment === 0) return undefined;
    return (kg ?? 0) + equipment;
}

function normalizeSegment(
    segment: SetSegment,
    exercise: ProgressionExerciseRef | undefined,
    bodyweightKg: number | undefined,
): NormalizedSet['segments'][number] {
    const kg = numberValue(segment.kg);
    const effectiveKg = effectiveLoad(kg, exercise, bodyweightKg);
    const reps = positiveInt(segment.reps);
    const timeSeconds = parseTimeSeconds(segment.time);
    return {
        ...(kg !== undefined ? { kg } : {}),
        ...(effectiveKg !== undefined ? { effectiveKg } : {}),
        ...(reps !== undefined ? { reps } : {}),
        ...(timeSeconds !== undefined ? { timeSeconds } : {}),
        ...(segment.restBeforeSeconds !== undefined ? { restBeforeSeconds: segment.restBeforeSeconds } : {}),
    };
}

function normalizeSet(
    set: SessionExerciseSet,
    exercise: ProgressionExerciseRef | undefined,
    bodyweightKg: number | undefined,
): NormalizedSet {
    const kg = numberValue(set.kg);
    const reps = positiveInt(set.reps);
    const effectiveKg = effectiveLoad(kg, exercise, bodyweightKg);
    const rir = validRir(set.rir);
    const timeSeconds = parseTimeSeconds(set.time);
    return {
        technique: getSetTechnique(set),
        executionMode: set.executionMode ?? 'standard',
        ...(kg !== undefined ? { kg } : {}),
        ...(effectiveKg !== undefined ? { effectiveKg } : {}),
        ...(reps !== undefined ? { reps } : {}),
        ...(rir !== undefined ? { rir } : {}),
        ...(timeSeconds !== undefined ? { timeSeconds } : {}),
        segments: getSetSegments(set).map(segment => normalizeSegment(segment, exercise, bodyweightKg)),
        ...(set.target?.type === 'reps' ? { targetReps: set.target.reps } : {}),
    };
}

function hasObservedSet(set: NormalizedSet, trackingType: Exercise['trackingType']): boolean {
    if (trackingType === 'time') return (set.timeSeconds ?? 0) > 0;
    if (trackingType === 'cardio') return (set.timeSeconds ?? 0) > 0 || (set.reps ?? 0) > 0;
    return (set.reps ?? 0) > 0;
}

function referenceSet(sets: NormalizedSet[], trackingType: Exercise['trackingType']): NormalizedSet | undefined {
    const observed = sets.filter(set => hasObservedSet(set, trackingType));
    if (observed.length === 0) return sets[0];
    if (trackingType !== 'weight_reps') return observed[0];
    return observed.reduce<NormalizedSet | undefined>((best, candidate) => {
        if (!best) return candidate;
        const bestLoad = best.effectiveKg ?? best.kg ?? -Infinity;
        const candidateLoad = candidate.effectiveKg ?? candidate.kg ?? -Infinity;
        if (candidateLoad !== bestLoad) return candidateLoad > bestLoad ? candidate : best;
        return (candidate.reps ?? 0) > (best.reps ?? 0) ? candidate : best;
    }, undefined);
}

export function normalizeExerciseExposure(
    session: WorkoutSession,
    sessionExercise: SessionExercise,
    exercise: ProgressionExerciseRef | undefined,
    context: ProgressionBodyweightContext = {},
): NormalizedExposure {
    const date = session.date ?? '';
    const bodyweightKg = exercise?.isBodyweight ? historicalBodyweight(date, context) : undefined;
    const trackingType = exercise?.trackingType ?? 'weight_reps';
    const sets = (sessionExercise.sets ?? []).map(set => normalizeSet(set, exercise, bodyweightKg));
    const observedSets = sets.filter(set => hasObservedSet(set, trackingType));
    let totalReps = 0;
    let tonnage = 0;
    let tonnageComplete = true;
    for (const set of observedSets) {
        if (set.reps) {
            totalReps += set.reps;
            if (set.effectiveKg === undefined) tonnageComplete = false;
            else tonnage += set.effectiveKg * set.reps;
        }
        for (const segment of set.segments) {
            if (!segment.reps) continue;
            totalReps += segment.reps;
            if (segment.effectiveKg === undefined) tonnageComplete = false;
            else tonnage += segment.effectiveKg * segment.reps;
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

function setShape(set?: NormalizedSet): string {
    if (!set) return 'missing';
    const rests = set.segments
        .map(segment => segment.restBeforeSeconds === undefined ? '?' : String(segment.restBeforeSeconds))
        .join(',');
    return [
        set.technique,
        set.executionMode,
        set.segments.length,
        set.targetReps === undefined ? 'no-target' : `target:${set.targetReps}`,
        `rests:${rests}`,
    ].join('|');
}

function exposureStructurePalette(exposure: NormalizedExposure): string[] {
    return [...new Set(exposure.sets.map(setShape))].sort();
}

export function compareExposureCompatibility(
    current: NormalizedExposure,
    previous: NormalizedExposure,
): ExposureComparison {
    const reasons: string[] = [];
    if (current.exId !== previous.exId) return { level: 'none', reasons: ['Esercizio diverso.'] };
    if (current.routineId !== previous.routineId) {
        return {
            level: 'none',
            reasons: ['Scheda diversa: la progressione viene confrontata nello stesso utilizzo dell’esercizio nella scheda.'],
        };
    }
    if (current.trackingType !== previous.trackingType) return { level: 'none', reasons: ['Tipo di tracciamento diverso.'] };
    if (!current.referenceSet || !previous.referenceSet) return { level: 'none', reasons: ['Manca un set di riferimento osservabile.'] };

    const currentStandard = current.technicalStandard?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('it');
    const previousStandard = previous.technicalStandard?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('it');
    if (currentStandard && previousStandard && currentStandard !== previousStandard) {
        return { level: 'none', reasons: ['Standard tecnico registrato diverso.'] };
    }
    if (Boolean(currentStandard) !== Boolean(previousStandard)) reasons.push('Standard tecnico registrato solo in una delle esposizioni.');

    const currentMetric = current.progressionContract?.metric;
    const previousMetric = previous.progressionContract?.metric;
    if (currentMetric && previousMetric && currentMetric !== previousMetric) reasons.push('Metrica del contratto di progressione diversa.');

    const currentRef = current.referenceSet;
    const previousRef = previous.referenceSet;
    if (currentRef.technique !== previousRef.technique) {
        return { level: 'none', reasons: [`Tecnica diversa: ${previousRef.technique} → ${currentRef.technique}.`] };
    }
    if (currentRef.executionMode !== previousRef.executionMode) {
        return { level: 'none', reasons: [`Modalità di esecuzione diversa: ${previousRef.executionMode} → ${currentRef.executionMode}.`] };
    }
    if (currentRef.segments.length !== previousRef.segments.length) {
        return { level: 'none', reasons: ['Struttura dei segmenti diversa.'] };
    }
    for (let index = 0; index < currentRef.segments.length; index++) {
        const currentRest = currentRef.segments[index]?.restBeforeSeconds;
        const previousRest = previousRef.segments[index]?.restBeforeSeconds;
        if (currentRest !== undefined && previousRest !== undefined && currentRest !== previousRest) {
            return { level: 'none', reasons: ['Recuperi strutturati dei segmenti diversi.'] };
        }
        if ((currentRest === undefined) !== (previousRest === undefined)) {
            reasons.push('Manca parte dei recuperi strutturati dei segmenti.');
        }
    }
    if (currentRef.targetReps !== previousRef.targetReps) reasons.push('Target strutturato diverso o non disponibile in entrambe le esposizioni.');
    const currentPalette = exposureStructurePalette(current);
    const previousPalette = exposureStructurePalette(previous);
    if (currentPalette.length !== previousPalette.length || currentPalette.some((shape, index) => shape !== previousPalette[index])) {
        reasons.push('Il mix di tecniche o strutture delle serie è cambiato tra le esposizioni.');
    }
    if (current.isBodyweight && (current.bodyweightKg === undefined || previous.bodyweightKg === undefined)) {
        reasons.push('Peso corporeo storico mancante in almeno una esposizione.');
    }
    if (
        current.trackingType === 'weight_reps'
        && ((currentRef.effectiveKg ?? currentRef.kg) === undefined || (previousRef.effectiveKg ?? previousRef.kg) === undefined)
    ) {
        reasons.push('Carico osservato mancante in almeno una esposizione.');
    }
    if (current.trackingType === 'weight_reps' && (currentRef.rir === undefined || previousRef.rir === undefined)) {
        reasons.push(`RIR mancante in almeno una esposizione (${previous.date || 'precedente'} / ${current.date || 'corrente'}).`);
    }
    return { level: reasons.length ? 'medium' : 'high', reasons };
}

function partPairs(current?: NormalizedSet, previous?: NormalizedSet) {
    if (!current || !previous || setShape(current) !== setShape(previous)) return [];
    return [
        [current, previous] as const,
        ...current.segments.map((segment, index) => [segment, previous.segments[index]] as const),
    ];
}

function compareReferenceOutput(current?: NormalizedSet, previous?: NormalizedSet): OutputChange {
    if (!current || !previous) return 'unknown';
    const pairs = partPairs(current, previous);
    if (!pairs.length) return 'unknown';
    let anyBetter = false;
    let anyWorse = false;
    for (const [curr, prev] of pairs) {
        const currLoad = curr.effectiveKg ?? curr.kg;
        const prevLoad = prev.effectiveKg ?? prev.kg;
        const currReps = curr.reps;
        const prevReps = prev.reps;
        if (currLoad === undefined || prevLoad === undefined || currReps === undefined || prevReps === undefined) return 'unknown';
        if (currLoad >= prevLoad && currReps >= prevReps && (currLoad > prevLoad || currReps > prevReps)) anyBetter = true;
        else if (currLoad <= prevLoad && currReps <= prevReps && (currLoad < prevLoad || currReps < prevReps)) anyWorse = true;
        else if (currLoad !== prevLoad || currReps !== prevReps) {
            anyBetter = true;
            anyWorse = true;
        }
    }
    if (anyBetter && anyWorse) return 'mixed';
    if (anyBetter) return 'better';
    if (anyWorse) return 'worse';
    return 'same';
}

function rirChange(current?: NormalizedSet, previous?: NormalizedSet): 'less' | 'same' | 'more' | 'unknown' {
    if (current?.rir === undefined || previous?.rir === undefined) return 'unknown';
    if (current.rir > previous.rir) return 'less';
    if (current.rir < previous.rir) return 'more';
    return 'same';
}

function strongRecord(current: NormalizedExposure, historical: NormalizedExposure[]): boolean {
    if (current.trackingType !== 'weight_reps' || !current.referenceSet || current.referenceSet.rir === undefined) return false;
    const compatibility = historical.map(previous => ({
        previous,
        comparison: compareExposureCompatibility(current, previous),
    }));
    if (compatibility.some(item => item.comparison.level === 'medium')) return false;
    const candidates = compatibility
        .filter(item => item.comparison.level === 'high')
        .map(item => item.previous);
    if (!candidates.length) return false;
    return candidates.every(previous => {
        const change = compareReferenceOutput(current.referenceSet, previous.referenceSet);
        const effort = rirChange(current.referenceSet, previous.referenceSet);
        return change === 'better' && (effort === 'same' || effort === 'less');
    });
}

function selectBestHistorical(current: NormalizedExposure, historical: NormalizedExposure[]): NormalizedExposure | undefined {
    const compatibility = historical.map(previous => ({
        previous,
        comparison: compareExposureCompatibility(current, previous),
    }));
    if (compatibility.some(item => item.comparison.level === 'medium')) return undefined;
    const candidates = compatibility
        .filter(item => item.comparison.level === 'high')
        .map(item => item.previous);
    if (!candidates.length) return undefined;
    return candidates.find(candidate => candidates.every(other => {
        if (candidate.sessionId === other.sessionId) return true;
        const change = compareReferenceOutput(candidate.referenceSet, other.referenceSet);
        const effort = rirChange(candidate.referenceSet, other.referenceSet);
        return (change === 'better' && effort !== 'more')
            || (change === 'same' && (effort === 'same' || effort === 'less'));
    }));
}

function qualityFor(
    comparison: ExposureComparison,
    recentCount: number,
    hasRecentLimitations: boolean,
): ProgressionQuality {
    if (comparison.level === 'none') return 'limited';
    if (comparison.level === 'medium' || hasRecentLimitations) return 'preliminary';
    return recentCount >= 3 ? 'clear' : 'preliminary';
}

export function formatProgressionReference(exposure?: NormalizedExposure): string {
    const set = exposure?.referenceSet;
    if (!set) return 'dati insufficienti';
    if (exposure?.trackingType === 'time') return set.timeSeconds !== undefined ? `${set.timeSeconds}s` : 'tempo non disponibile';
    const load = set.effectiveKg ?? set.kg;
    const output = `${load !== undefined ? load : '?'} kg × ${set.reps ?? '?'}`;
    return set.rir === undefined ? output : `${output} · RIR ${set.rir}`;
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

function describe(
    classification: ProgressionClassification,
    current: NormalizedExposure,
    previous?: NormalizedExposure,
): { headline: string; detail: string } {
    const currentRef = formatProgressionReference(current);
    const previousRef = formatProgressionReference(previous);
    switch (classification) {
        case 'performance_record':
            return { headline: 'Record di performance', detail: `${previousRef} → ${currentRef}, in condizioni direttamente confrontabili.` };
        case 'output_up_effort_up':
            return { headline: 'Output aumentato con effort maggiore', detail: `${previousRef} → ${currentRef}. L'output è salito insieme all'effort dichiarato.` };
        case 'progression':
            return { headline: 'Progressione osservata', detail: `${previousRef} → ${currentRef}.` };
        case 'stable_less_effort':
            return { headline: 'Output stabile, effort minore', detail: `${currentRef}. Stesso output con RIR dichiarato più alto.` };
        case 'stable_more_effort':
            return { headline: 'Output stabile, effort maggiore', detail: `${currentRef}. Stesso output con RIR dichiarato più basso.` };
        case 'stable':
            return { headline: 'Prestazione stabile', detail: `${previousRef} → ${currentRef}.` };
        case 'output_lower':
            return { headline: 'Output di riferimento inferiore', detail: `${previousRef} → ${currentRef}. È una variazione osservata della prestazione, non una conclusione fisiologica.` };
        case 'volume_progression':
            return {
                headline: 'Volume di lavoro aumentato',
                detail: `${previous?.workSets ?? 0} → ${current.workSets} serie, ${previous?.totalReps ?? 0} → ${current.totalReps} ripetizioni. Set di riferimento: ${previousRef} → ${currentRef}.`,
            };
        case 'maintenance_stable':
            return { headline: 'Performance di riferimento stabile nel mantenimento', detail: `Set di riferimento: ${previousRef} → ${currentRef}. Dose osservata: ${previous?.workSets ?? 0} → ${current.workSets} serie.` };
        case 'maintenance_change':
            return { headline: 'Mantenimento: variazione osservata', detail: `Set di riferimento: ${previousRef} → ${currentRef}. Dose osservata: ${previous?.workSets ?? 0} → ${current.workSets} serie. Il dato descrive la prestazione, non il mantenimento della massa muscolare.` };
        case 'deload_change':
            return { headline: 'Deload: variazione descrittiva', detail: `Set di riferimento: ${previousRef} → ${currentRef}. Dose osservata: ${previous?.workSets ?? 0} → ${current.workSets} serie. Le riduzioni programmate non vengono classificate come regressione.` };
        case 'execution_baseline':
            return { headline: 'Esecuzione: baseline registrata', detail: 'LogBook usa modalità, standard tecnico e parametri registrati. Non deduce la qualità tecnica da dati non inseriti.' };
        case 'density_limited':
            return { headline: 'Densità: confronto limitato alla sessione', detail: 'Non sono disponibili timestamp per attribuire una densità precisa al singolo esercizio.' };
        case 'new_baseline':
            return { headline: 'Nuova baseline', detail: previous ? 'Le condizioni registrate sono sostanzialmente diverse; evito un confronto diretto.' : `Prima esposizione confrontabile registrata: ${currentRef}.` };
        case 'descriptive_change':
            return { headline: 'Variazione descrittiva', detail: `${previousRef} → ${currentRef}. Carico e ripetizioni sono cambiati in direzioni che non supportano una conclusione univoca.` };
        default:
            return { headline: 'Dati insufficienti', detail: 'Le informazioni disponibili non supportano una conclusione diretta robusta.' };
    }
}

function trendFor(exposures: NormalizedExposure[]): TrendDirection {
    if (exposures.length < 3) return 'insufficient';
    const directions: OutputChange[] = [];
    for (let index = 1; index < exposures.length; index++) {
        const current = exposures[index];
        const previous = exposures[index - 1];
        const output = compareReferenceOutput(current.referenceSet, previous.referenceSet);
        if (output === 'better' && rirChange(current.referenceSet, previous.referenceSet) === 'more') directions.push('mixed');
        else directions.push(output);
    }
    if (directions.every(value => value === 'same')) return 'stable';
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

function sessionTimestamp(session: WorkoutSession, preferEnd = false): number | undefined {
    const candidates = preferEnd
        ? [session.globalEndTime, session.endTime, session.globalStartTime]
        : [session.globalStartTime, session.globalEndTime, session.endTime];
    return candidates.find(value => typeof value === 'number' && Number.isFinite(value));
}

function isSessionEarlier(candidate: WorkoutSession, current: WorkoutSession): boolean {
    if (candidate.id && current.id && candidate.id === current.id) return false;
    if (candidate.date && current.date) {
        if (candidate.date < current.date) return true;
        if (candidate.date > current.date) return false;
    }
    const candidateEnd = sessionTimestamp(candidate, true);
    const currentStart = sessionTimestamp(current, false);
    return candidateEnd !== undefined && currentStart !== undefined && candidateEnd < currentStart;
}

function compareSessionChronology(a: WorkoutSession, b: WorkoutSession): number {
    const dateCompare = (a.date ?? '').localeCompare(b.date ?? '');
    if (dateCompare !== 0) return dateCompare;
    return (sessionTimestamp(a, false) ?? 0) - (sessionTimestamp(b, false) ?? 0);
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

function durationSeconds(session: WorkoutSession): number | undefined {
    if (session.globalStartTime && session.globalEndTime && session.globalEndTime >= session.globalStartTime) {
        return Math.floor((session.globalEndTime - session.globalStartTime) / 1000);
    }
    return parseTimeSeconds(session.globalDurationStr || session.manualDurationStr);
}

function densityAnalysis(
    current: WorkoutSession,
    history: WorkoutSession[],
    libraryMap: Map<string, ProgressionExerciseRef>,
    context: ProgressionBodyweightContext,
): DensityProgressionAnalysis | undefined {
    if (current.cycleStrategy?.progressionFocus !== 'density') return undefined;
    const currentDuration = durationSeconds(current);
    const previous = [...history]
        .filter(item => (
            item.id !== current.id
            && item.routineId === current.routineId
            && isSessionEarlier(item, current)
            && item.cycleStrategy?.progressionFocus === 'density'
            && (!current.cycleId || item.cycleId === current.cycleId)
        ))
        .sort((a, b) => compareSessionChronology(b, a))[0];
    const previousDuration = previous ? durationSeconds(previous) : undefined;
    if (!previous || currentDuration === undefined || previousDuration === undefined) {
        return { quality: 'limited', headline: 'Confronto densità limitato', detail: 'Serve la durata di due sessioni della stessa scheda; non vengono inventati tempi per esercizio.' };
    }
    const currentSets = observedSessionWorkSets(current, libraryMap, context);
    const previousSets = observedSessionWorkSets(previous, libraryMap, context);
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
    for (const currentExercise of currentWorkout.exercises ?? []) {
        if (!currentExercise?.exId) continue;
        const exercise = libraryMap.get(currentExercise.exId);
        const current = normalizeExerciseExposure(currentWorkout, currentExercise, exercise, context);
        const historical = history
            .filter(session => isSessionEarlier(session, currentWorkout))
            .sort(compareSessionChronology)
            .flatMap(session => {
                const found = (session.exercises ?? []).find(item => item.exId === currentExercise.exId);
                return found ? [normalizeExerciseExposure(session, found, exercise, context)] : [];
            });

        const latestExposure = historical.at(-1);
        const comparable = historical.filter(previous => compareExposureCompatibility(current, previous).level !== 'none');
        const previousComparable = comparable.at(-1);
        const comparison = previousComparable
            ? compareExposureCompatibility(current, previousComparable)
            : latestExposure
                ? compareExposureCompatibility(current, latestExposure)
                : { level: 'none' as const, reasons: ['Nessuna esposizione precedente disponibile.'] };
        const recentHistorical = comparable.slice(-3);
        const recentComparable = [...recentHistorical, current];
        const recentLimitations = recentHistorical
            .map(exposure => ({
                exposure,
                comparison: compareExposureCompatibility(current, exposure),
            }))
            .filter(item => item.comparison.level === 'medium');
        const cycleBaseline = current.cycleId
            ? comparable.find(item => item.cycleId === current.cycleId)
            : undefined;
        const bestHistorical = selectBestHistorical(current, historical);
        const isRecord = strongRecord(current, historical);
        const outputChange = previousComparable
            ? compareReferenceOutput(current.referenceSet, previousComparable.referenceSet)
            : 'unknown';
        const classification = !current.referenceSet
            ? 'insufficient_data'
            : comparison.level === 'none' && latestExposure
                ? 'new_baseline'
                : classificationFor(current, previousComparable, outputChange, isRecord);
        const quality = qualityFor(comparison, recentComparable.length, recentLimitations.length > 0);
        const qualityReasons = [...comparison.reasons];
        for (const limitation of recentLimitations) {
            if (limitation.exposure.sessionId === previousComparable?.sessionId) continue;
            qualityReasons.push(
                ...limitation.comparison.reasons.map(
                    reason => `Esposizione del ${limitation.exposure.date || 'data non disponibile'}: ${reason}`,
                ),
            );
        }
        if (latestExposure && previousComparable && latestExposure.sessionId !== previousComparable.sessionId) {
            const latestComparison = compareExposureCompatibility(current, latestExposure);
            qualityReasons.unshift(...latestComparison.reasons.map(reason => `Esposizione più recente esclusa: ${reason}`));
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
    const density = densityAnalysis(currentWorkout, history, libraryMap, context);
    return { exercises: analyses, ...(density ? { density } : {}) };
}

export function progressionQualityLabel(quality: ProgressionQuality): string {
    if (quality === 'clear') return 'Trend chiaro';
    if (quality === 'preliminary') return 'Indicazione preliminare';
    return 'Confronto limitato';
}

export function progressionTrendLabel(
    direction: ExerciseProgressionAnalysis['trendDirection'],
    intent?: TrainingCycleIntent,
): string {
    if (intent === 'deload') return 'Deload: andamento descrittivo';
    if (intent === 'maintenance') return 'Andamento in mantenimento';
    if (direction === 'up') return 'Trend in crescita';
    if (direction === 'stable') return 'Trend stabile';
    if (direction === 'down') return 'Trend in calo';
    if (direction === 'mixed') return 'Trend misto';
    return 'Trend non ancora definito';
}
