import type { MuscleDef } from '../../lib/constants/muscles';

export const EXERCISE_DRAFT_KEY = 'draft_exercise';

export type ExerciseTrackingType = 'weight_reps' | 'time' | 'cardio';

export interface ExerciseDraft {
    name: string;
    notes: string;
    trackingType: ExerciseTrackingType;
    selectedMuscles: MuscleDef[];
    secondaryMuscles: MuscleDef[];
    isBodyweight: boolean;
    equipmentWeight: string;
}

export function readExerciseDraft(): Record<string, any> | null {
    const raw = localStorage.getItem(EXERCISE_DRAFT_KEY);
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function persistExerciseDraft(draft: ExerciseDraft): void {
    const hasContent = Boolean(
        draft.name.trim() ||
        draft.notes.trim() ||
        draft.selectedMuscles.length > 0 ||
        draft.secondaryMuscles.length > 0 ||
        draft.isBodyweight ||
        draft.equipmentWeight
    );

    if (hasContent) {
        try {
            localStorage.setItem(EXERCISE_DRAFT_KEY, JSON.stringify(draft));
        } catch (error) {
            console.warn('Quota exceeded or error saving draft', error);
        }
    } else {
        localStorage.removeItem(EXERCISE_DRAFT_KEY);
    }
}

export function clearExerciseDraft(): void {
    localStorage.removeItem(EXERCISE_DRAFT_KEY);
}
