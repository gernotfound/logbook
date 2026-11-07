import type { MuscleDef } from '../../lib/constants/muscles';
import { readWorkoutRecoveryDraft, readWorkoutRecoveryDraftImage, writeWorkoutRecoveryDraft } from '../../lib/sync/workoutRecoveryDraft';
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
    return readWorkoutRecoveryDraft(EXERCISE_DRAFT_KEY, owner) as Record<string, any> | null;
}

export function readExerciseDraftImage(owner = storageOwner()): {
    draft: Record<string, any> | null; raw: string | null;
} {
    // The authenticated owner, consent revision and observed document image
    // must all remain unchanged before a mounted editor may write or commit.
    const image = readWorkoutRecoveryDraftImage(EXERCISE_DRAFT_KEY, owner);
    return { draft: image.value as Record<string, any> | null, raw: image.raw };
}

export function persistExerciseDraft(
    draft: ExerciseDraft, owner = storageOwner(),
    expectedConsentGeneration?: string | null, expectedRaw?: string | null,
): string | null {
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
    return writeWorkoutRecoveryDraft(EXERCISE_DRAFT_KEY, owner, hasContent ? draft : null,
        expectedConsentGeneration, expectedRaw);
}

export function clearExerciseDraft(
    owner = storageOwner(), expectedConsentGeneration?: string | null,
    expectedRaw?: string | null,
): string | null {
    return writeWorkoutRecoveryDraft(EXERCISE_DRAFT_KEY, owner, null, expectedConsentGeneration, expectedRaw);
}
