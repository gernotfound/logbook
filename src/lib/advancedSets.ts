import type { PlannedSetTechnique, SessionExerciseSet, SetSegment, SetTechnique } from '../types';

export const ADVANCED_TECHNIQUES: Exclude<SetTechnique, 'straight'>[] = ['dropset', 'rest_pause', 'cluster', 'rep_match', 'diminishing'];

export function techniqueLabel(technique: SetTechnique): string {
    return ({ straight: 'Serie normale', dropset: 'Dropset', rest_pause: 'Rest-pause', cluster: 'Cluster', rep_match: 'Rep-match', diminishing: 'Diminishing set' })[technique];
}

export function getSetTechnique(set: SessionExerciseSet): SetTechnique {
    if (set.technique && set.technique !== 'straight') return set.technique;
    if (set.dropsets?.length) return 'dropset';
    return 'straight';
}

export function getSetSegments(set: SessionExerciseSet): SetSegment[] {
    if (set.segments?.length) return set.segments;
    return (set.dropsets || []).map(ds => ({ id: ds.id, kg: ds.kg, reps: ds.reps }));
}

export function getRoutineSetPlan(set: SessionExerciseSet): PlannedSetTechnique {
    const technique = getSetTechnique(set);
    const segments = getSetSegments(set);
    const plan: PlannedSetTechnique = { technique };
    if (set.target) plan.target = structuredClone(set.target);
    if (technique !== 'straight' && segments.length > 0) {
        plan.segmentCount = segments.length + 1;
        const firstRest = segments[0]?.restBeforeSeconds;
        if (firstRest !== undefined && segments.every(segment => segment.restBeforeSeconds === firstRest)) {
            plan.restSeconds = firstRest;
        }
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
    const technique = getSetTechnique(set);
    if (technique === 'straight') return null;
    const segments = getSetSegments(set);
    const parts = [techniqueLabel(technique)];
    if (segments.length) parts.push(segments.map(s => [s.kg && s.reps ? s.kg + 'kg×' + s.reps : s.reps ? s.reps + ' rep' : s.time ? s.time + 's' : 'segmento', s.restBeforeSeconds !== undefined ? 'rec ' + s.restBeforeSeconds + 's' : ''].filter(Boolean).join(' · ')).join(' → '));
    if (set.target?.type === 'reps') parts.push('target ' + set.target.reps + ' rep');
    return parts.join(' · ');
}
