import type { Exercise } from '../../types';
import type { NormalizedSet, NormalizedExposure, ExposureComparison, ProgressionQuality } from './progression';
import type { OutputChange } from './progressionInternalTypes';

export interface HistoricalExposureComparison {
    exposure: NormalizedExposure;
    comparison: ExposureComparison;
}

function setShape(set?: NormalizedSet): string {
    if (!set) return 'missing';
    const segmentShapes = set.segments
        .map(segment => [
            segment.technique ?? set.technique,
            segment.restBeforeSeconds === undefined ? '?' : String(segment.restBeforeSeconds),
            segment.targetReps === undefined ? 'no-target' : `target:${segment.targetReps}`,
        ].join(':'))
        .join(',');
    return [
        set.technique,
        set.executionMode,
        set.segments.length,
        set.targetReps === undefined ? 'no-target' : `target:${set.targetReps}`,
        `segments:${segmentShapes}`,
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
        const currentSegment = currentRef.segments[index];
        const previousSegment = previousRef.segments[index];
        const currentTechnique = currentSegment?.technique ?? currentRef.technique;
        const previousTechnique = previousSegment?.technique ?? previousRef.technique;
        if (currentTechnique !== previousTechnique) {
            return { level: 'none', reasons: ['Sequenza delle tecniche avanzate diversa.'] };
        }
        const currentRest = currentSegment?.restBeforeSeconds;
        const previousRest = previousSegment?.restBeforeSeconds;
        if (currentRest !== undefined && previousRest !== undefined && currentRest !== previousRest) {
            return { level: 'none', reasons: ['Recuperi strutturati delle tecniche avanzate diversi.'] };
        }
        if ((currentRest === undefined) !== (previousRest === undefined)) {
            reasons.push('Manca parte dei recuperi strutturati delle tecniche avanzate.');
        }
        if (currentSegment?.targetReps !== previousSegment?.targetReps) {
            reasons.push('Target di una tecnica avanzata diverso o non disponibile in entrambe le esposizioni.');
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

export function compareReferenceOutput(
    current?: NormalizedSet,
    previous?: NormalizedSet,
    trackingType: Exercise['trackingType'] = 'weight_reps',
): OutputChange {
    if (!current || !previous) return 'unknown';
    const pairs = partPairs(current, previous);
    if (!pairs.length) return 'unknown';
    if (trackingType === 'time') {
        let compared = 0;
        let anyLonger = false;
        let anyShorter = false;
        for (const [index, [curr, prev]] of pairs.entries()) {
            const currentSeconds = curr?.timeSeconds;
            const previousSeconds = prev?.timeSeconds;
            // The primary set may be unmeasured when its segments carry the time.
            // Missing time in a recorded segment cannot prove stable duration.
            if (index === 0 && !(currentSeconds !== undefined && currentSeconds > 0)
                && !(previousSeconds !== undefined && previousSeconds > 0)) continue;
            if (currentSeconds === undefined || previousSeconds === undefined
                || currentSeconds <= 0 || previousSeconds <= 0) return 'unknown';
            compared++;
            if (currentSeconds > previousSeconds) anyLonger = true;
            if (currentSeconds < previousSeconds) anyShorter = true;
        }
        if (compared === 0) return 'unknown';
        if (anyLonger && anyShorter) return 'mixed';
        if (anyLonger) return 'longer';
        if (anyShorter) return 'shorter';
        return 'same';
    }
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

export function rirChange(current?: NormalizedSet, previous?: NormalizedSet): 'less' | 'same' | 'more' | 'unknown' {
    if (current?.rir === undefined || previous?.rir === undefined) return 'unknown';
    if (current.rir > previous.rir) return 'less';
    if (current.rir < previous.rir) return 'more';
    return 'same';
}

export function strongRecord(current: NormalizedExposure, comparisons: HistoricalExposureComparison[]): boolean {
    if (current.trackingType !== 'weight_reps' || !current.referenceSet || current.referenceSet.rir === undefined) return false;
    const recentComparable = comparisons
        .filter(item => item.comparison.level !== 'none')
        .slice(-3);
    if (recentComparable.some(item => item.comparison.level === 'medium')) return false;

    const candidates = comparisons
        .filter(item => item.comparison.level === 'high')
        .map(item => item.exposure);
    if (!candidates.length) return false;
    return candidates.every(previous => {
        const change = compareReferenceOutput(current.referenceSet, previous.referenceSet);
        const effort = rirChange(current.referenceSet, previous.referenceSet);
        return change === 'better' && (effort === 'same' || effort === 'less');
    });
}

export function selectBestHistorical(
    comparisons: HistoricalExposureComparison[],
    trackingType: Exercise['trackingType'],
): NormalizedExposure | undefined {
    // No best duration exists without knowing whether the exercise rewards more or less time.
    if (trackingType === 'time') return undefined;
    const candidates = comparisons
        .filter(item => item.comparison.level === 'high')
        .map(item => item.exposure);
    if (!candidates.length) return undefined;
    // With distinct sessions, a lower known RIR always implies more effort than
    // at least one candidate. Such a reference cannot dominate every exposure.
    // Duplicate session IDs retain the original full comparison semantics.
    const distinctSessions = new Set(candidates.map(candidate => candidate.sessionId)).size === candidates.length;
    const maxKnownRir = distinctSessions
        ? candidates.reduce((max, candidate) => Math.max(max, candidate.referenceSet?.rir ?? -Infinity), -Infinity)
        : -Infinity;
    return candidates.find(candidate => {
        if (candidate.referenceSet?.rir !== undefined && candidate.referenceSet.rir < maxKnownRir) return false;
        return candidates.every(other => {
        if (candidate.sessionId === other.sessionId) return true;
        const change = compareReferenceOutput(candidate.referenceSet, other.referenceSet);
        const effort = rirChange(candidate.referenceSet, other.referenceSet);
        return (change === 'better' && effort !== 'more')
            || (change === 'same' && (effort === 'same' || effort === 'less'));
        });
    });
}

export function qualityFor(
    comparison: ExposureComparison,
    recentCount: number,
    hasRecentLimitations: boolean,
): ProgressionQuality {
    if (comparison.level === 'none') return 'limited';
    if (comparison.level === 'medium' || hasRecentLimitations) return 'preliminary';
    return recentCount >= 3 ? 'clear' : 'preliminary';
}
