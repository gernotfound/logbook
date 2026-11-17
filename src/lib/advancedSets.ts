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
        if (technique && technique !== 'isometry') {
            firstAdvanced = technique;
            break;
        }
    }
    if (firstAdvanced) return firstAdvanced;
    return 'straight';
}

export function getSetSegments(set: SessionExerciseSet): SetSegment[] {
    return set.segments ?? [];
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
