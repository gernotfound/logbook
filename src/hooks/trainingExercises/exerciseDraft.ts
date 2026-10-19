import type { MuscleDef } from '../../lib/constants/muscles';
import { readWorkoutRecoveryDraft, writeWorkoutRecoveryDraft } from '../../lib/sync/workoutRecoveryDraft';
import { storageOwner } from '../../lib/sync/session';

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

export function readExerciseDraft(owner = storageOwner()): Record<string, any> | null {
    // The recovery payload cannot be promoted to a new consent generation merely
    // because its owner-scoped ciphertext is still readable.
    return readWorkoutRecoveryDraft(EXERCISE_DRAFT_KEY, owner) as Record<string, any> | null;
}

export function persistExerciseDraft(draft: ExerciseDraft, owner = storageOwner(), expectedConsentGeneration?: string | null): void {
    const hasContent = Boolean(
        draft.name.trim() ||
        draft.notes.trim() ||
        draft.selectedMuscles.length > 0 ||
        draft.secondaryMuscles.length > 0 ||
        draft.isBodyweight ||
        draft.equipmentWeight
    );

    // Propagate persistence failures: swallowing them would permit a user to
    // commit memory-only or obsolete draft values as new business data.
    writeWorkoutRecoveryDraft(EXERCISE_DRAFT_KEY, owner, hasContent ? draft : null, expectedConsentGeneration);
}

export function clearExerciseDraft(owner = storageOwner(), expectedConsentGeneration?: string | null): void {
    writeWorkoutRecoveryDraft(EXERCISE_DRAFT_KEY, owner, null, expectedConsentGeneration);
}
