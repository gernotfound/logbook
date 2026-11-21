import type { WorkoutSession } from '../../../types';
import type { WorkoutCompletionDraft } from '../../../hooks/workout/workoutSessionPreparation';

// These values can be read from a protected device draft but must still be
// checked against the current workout before they are presented or committed.
export interface PostSessionDraft extends WorkoutCompletionDraft {
    workoutId: string;
}

export function createPostSessionDraft(workout: WorkoutSession): PostSessionDraft {
    return {
        workoutId: String(workout.id ?? ''),
        mood: workout.moodRating !== undefined && workout.moodRating !== null ? String(workout.moodRating) : '',
        pump: workout.pumpRating !== undefined && workout.pumpRating !== null ? String(workout.pumpRating) : '',
        fatigue: workout.fatigueRating !== undefined && workout.fatigueRating !== null ? String(workout.fatigueRating) : '',
        water: workout.waterLiters !== undefined && workout.waterLiters !== null ? String(workout.waterLiters) : '',
        pains: Array.isArray(workout.pains) ? [...workout.pains] : [],
    };
}

export function parsePostSessionRecovery(raw: unknown | null, workoutId: string): { pendingEndTime: number | null; draft: PostSessionDraft } | null {
    if (raw === null) return null;
    const parsed = raw as { pendingEndTime?: unknown; draft?: Partial<PostSessionDraft> };
    const draft = parsed?.draft;
    if (!draft || draft.workoutId !== workoutId) throw new Error('Bozza finale appartiene a un workout diverso.');
    if (!Array.isArray(draft.pains) || draft.pains.some(value => typeof value !== 'string')) throw new Error('Bozza finale corrotta.');
    const mood = draft.mood;
    const pump = draft.pump;
    const fatigue = draft.fatigue;
    const water = draft.water;
    if (typeof mood !== 'string' || typeof pump !== 'string' || typeof fatigue !== 'string' || typeof water !== 'string') {
        throw new Error('Bozza finale non valida.');
    }
    const pendingEndTime = parsed.pendingEndTime === null || parsed.pendingEndTime === undefined
        ? null
        : typeof parsed.pendingEndTime === 'number' && Number.isFinite(parsed.pendingEndTime)
            ? parsed.pendingEndTime
            : (() => { throw new Error('Timestamp finale della bozza non valido.'); })();
    return {
        pendingEndTime,
        draft: {
            workoutId,
            mood,
            pump,
            fatigue,
            water,
            pains: [...draft.pains],
        },
    };
}
