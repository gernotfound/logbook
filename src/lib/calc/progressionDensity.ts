import type { WorkoutSession } from '../../types';
import { getWorkoutDurationSeconds } from './workoutDuration';
import { compareSessionChronology } from './progressionHistory';
import { normalizeExerciseExposure } from './progressionExposure';
import type { DensityProgressionAnalysis, ProgressionBodyweightContext, ProgressionExerciseRef } from './progression';

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

export function densityAnalysis(
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

