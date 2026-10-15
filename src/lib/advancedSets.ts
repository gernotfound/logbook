import type { PlannedSetTechnique, SessionExerciseSet, SetContinuationTechnique, SetSegment, SetTarget, SetTechnique } from '../types';

function techniqueLabel(technique: SetTechnique): string {
    return ({ straight: 'Serie normale', dropset: 'Dropset', rest_pause: 'Rest-pause', cluster: 'Cluster', rep_match: 'Rep-match', diminishing: 'Diminishing set' })[technique];
}

export function continuationTechniqueLabel(technique: SetContinuationTechnique): string {
    return technique === 'isometry' ? 'Isometria' : techniqueLabel(technique);
}

export function getContinuationTechnique(
    set: Pick<SessionExerciseSet, 'technique'>,
    segment: Pick<SetSegment, 'technique'>,
): SetContinuationTechnique | undefined {
    if (segment.technique) return segment.technique;
    return set.technique && set.technique !== 'straight' ? set.technique : undefined;
}

export function getSetTechnique(set: SessionExerciseSet): SetTechnique {
    if (set.technique && set.technique !== 'straight') return set.technique;
    let firstAdvanced: Exclude<SetTechnique, 'straight'> | undefined;
    for (const segment of set.segments ?? []) {
        const technique = segment.technique;
        if (technique && technique !== 'isometry' && technique !== 'straight') {
            firstAdvanced = technique;
            break;
        }
    }
    if (firstAdvanced) return firstAdvanced;
    if (set.dropsets?.length) return 'dropset';
    return 'straight';
}

export function getSetSegments(set: SessionExerciseSet): SetSegment[] {
    if (set.segments?.length) return set.segments;
    return [
        ...(set.dropsets || []).map(ds => ({ id: ds.id, kg: ds.kg, reps: ds.reps, technique: 'dropset' as const })),
        ...(set.isometrics || []).map(iso => ({ id: iso.id, kg: iso.kg, reps: '', time: iso.time, technique: 'isometry' as const })),
    ];
}

function targetsMatch(left?: SetTarget, right?: SetTarget): boolean {
    if (!left && !right) return true;
    return Boolean(left && right && left.type === right.type && left.reps === right.reps);
}

export function canRepresentSetAsRoutinePlan(set: SessionExerciseSet): boolean {
    const technique = getSetTechnique(set);
    const segments = getSetSegments(set);
    if (segments.some(segment => getContinuationTechnique(set, segment) === 'isometry')) return false;
    if (technique === 'straight') return segments.length === 0;
    if (segments.some(segment => getContinuationTechnique(set, segment) !== technique)) return false;

    const firstRest = segments[0]?.restBeforeSeconds;
    if (segments.some(segment => segment.restBeforeSeconds !== firstRest)) return false;
    const firstTarget = segments[0]?.target ?? set.target;
    return segments.every(segment => targetsMatch(segment.target ?? set.target, firstTarget));
}

export function getRoutineSetPlan(set: SessionExerciseSet): PlannedSetTechnique {
    const technique = getSetTechnique(set);
    const segments = getSetSegments(set);
    const plan: PlannedSetTechnique = { technique };
    const firstTarget = segments[0]?.target ?? set.target;
    if (firstTarget) plan.target = { type: 'reps', reps: firstTarget.reps };
    if (technique !== 'straight' && segments.length > 0 && canRepresentSetAsRoutinePlan(set)) {
        plan.segmentCount = segments.length + 1;
        const firstRest = segments[0]?.restBeforeSeconds;
        if (firstRest !== undefined) plan.restSeconds = firstRest;
    }
    return plan;
}

export function getSetTotalReps(set: SessionExerciseSet): number {
    const main = Number.parseFloat(set.reps || '') || 0;
    return main + getSetSegments(set).reduce((sum, segment) => sum + (Number.parseFloat(segment.reps || '') || 0), 0);
}

export function getSetObservedTonnage(set: SessionExerciseSet): number {
    const main = (Number.parseFloat(set.kg || '') || 0) * (Number.parseFloat(set.reps || '') || 0);
    return main + getSetSegments(set).reduce((sum, segment) => sum + (Number.parseFloat(segment.kg || '') || 0) * (Number.parseFloat(segment.reps || '') || 0), 0);
}

export function formatAdvancedSetSummary(set: SessionExerciseSet): string | null {
    const segments = getSetSegments(set);
    const technique = getSetTechnique(set);
    if (segments.length === 0) {
        if (technique === 'straight') return null;
        const target = set.target?.type === 'reps' ? ` · target ${set.target.reps} rep` : '';
        return techniqueLabel(technique) + target;
    }

    const totals = new Map<SetContinuationTechnique, number>();
    for (const segment of segments) {
        const current = getContinuationTechnique(set, segment);
        if (current) totals.set(current, (totals.get(current) ?? 0) + 1);
    }
    const seen = new Map<SetContinuationTechnique, number>();

    return segments.map((segment, index) => {
        const segmentTechnique = getContinuationTechnique(set, segment);
        const baseLabel = segmentTechnique ? continuationTechniqueLabel(segmentTechnique) : 'Tecnica';
        let label = baseLabel;
        if (segmentTechnique && (totals.get(segmentTechnique) ?? 0) > 1) {
            const occurrence = (seen.get(segmentTechnique) ?? 0) + 1;
            seen.set(segmentTechnique, occurrence);
            label = `${baseLabel} ${occurrence}`;
        }
        const target = segment.target ?? (!segment.technique ? set.target : undefined);
        const details = [
            segment.kg && segment.reps ? `${segment.kg}kg×${segment.reps}` : segment.reps ? `${segment.reps} rep` : segment.time ? `${segment.time}s` : '',
            segment.restBeforeSeconds !== undefined ? `rec ${segment.restBeforeSeconds}s` : '',
            target?.type === 'reps' ? `target ${target.reps} rep` : '',
        ].filter(Boolean).join(' · ');
        return details ? `${label} · ${details}` : label;
    }).join(' → ');
}
