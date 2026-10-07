import type { MuscleDef } from '../../lib/constants/muscles';
import { readDeviceValue, writeDeviceValue } from '../../lib/sync/deviceStorage';

const EXERCISE_DRAFT_KEY = 'draft_exercise';

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

export function readExerciseDraft(owner?: string): Record<string, any> | null {
    const raw = readDeviceValue(EXERCISE_DRAFT_KEY, owner);
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function persistExerciseDraft(draft: ExerciseDraft, owner?: string): void {
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
            writeDeviceValue(EXERCISE_DRAFT_KEY, JSON.stringify(draft), owner);
        } catch (error) {
            console.warn('Quota exceeded or error saving draft', error);
        }
    } else {
        try {
            writeDeviceValue(EXERCISE_DRAFT_KEY, null, owner);
        } catch {
            // Draft cleanup is best-effort.
        }
    }
}

export function clearExerciseDraft(owner?: string): void {
    try {
        writeDeviceValue(EXERCISE_DRAFT_KEY, null, owner);
    } catch {
        // Draft cleanup is best-effort.
    }
}
