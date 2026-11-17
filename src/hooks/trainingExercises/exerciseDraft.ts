import type { MuscleDef } from '../../lib/constants/muscles';
import { readWorkoutRecoveryDraftImage, writeWorkoutRecoveryDraft } from '../../lib/sync/workoutRecoveryDraft';
import { z } from '../../lib/zod';
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

const muscleDraftSchema = z.object({ id: z.string().min(1), name: z.string() }).passthrough();
const recoveredExerciseDraftSchema = z.object({
    name: z.string().optional(),
    notes: z.string().optional(),
    trackingType: z.enum(['weight_reps', 'time', 'cardio']).optional(),
    selectedMuscles: z.array(muscleDraftSchema).optional(),
    secondaryMuscles: z.array(muscleDraftSchema).optional(),
    isBodyweight: z.boolean().optional(),
    equipmentWeight: z.string().optional(),
}).passthrough();

function parseRecoveredExerciseDraft(value: unknown | null): Partial<ExerciseDraft> | null {
    if (value === null) return null;
    const parsed = recoveredExerciseDraftSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error('Bozza esercizio non valida: originale cifrato conservato.');
    }
    return parsed.data;
}

export function readExerciseDraft(owner = storageOwner()): Partial<ExerciseDraft> | null {
    return readExerciseDraftImage(owner).draft;
}

export function readExerciseDraftImage(owner = storageOwner()): {
    draft: Partial<ExerciseDraft> | null; raw: string | null;
} {
    // Invalid typed fields cannot be silently promoted to a new draft.
    // Preserve the original ciphertext for explicit recovery.
    const image = readWorkoutRecoveryDraftImage(EXERCISE_DRAFT_KEY, owner);
    return { draft: parseRecoveredExerciseDraft(image.value), raw: image.raw };
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

    // A malformed existing ciphertext is not an empty draft; a same-owner
    // writer must not overwrite it simply because consent still matches.
    readExerciseDraftImage(owner);
    return writeWorkoutRecoveryDraft(EXERCISE_DRAFT_KEY, owner, hasContent ? draft : null,
        expectedConsentGeneration, expectedRaw);
}

export function clearExerciseDraft(
    owner = storageOwner(), expectedConsentGeneration?: string | null,
    expectedRaw?: string | null,
): string | null {
    readExerciseDraftImage(owner);
    return writeWorkoutRecoveryDraft(EXERCISE_DRAFT_KEY, owner, null, expectedConsentGeneration, expectedRaw);
}
