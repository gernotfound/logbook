import type { Exercise } from '../../types';
import type { ExerciseDraft } from './exerciseDraft';

export function hasDuplicateExerciseName(
    library: readonly Exercise[],
    editingExId: string | null,
    name: string,
): boolean {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return false;
    return library.some(ex => ex.id !== editingExId && ex.name.trim().toLowerCase() === trimmed);
}

export function buildExerciseSavePayload(
    library: readonly Exercise[],
    editingExId: string | null,
    draft: ExerciseDraft,
    createId: () => string,
): Exercise | undefined {
    const parsedEqWeight = draft.equipmentWeight
        ? parseFloat(String(draft.equipmentWeight).replace(',', '.'))
        : undefined;
    const validEqWeight = (
        parsedEqWeight !== undefined &&
        !isNaN(parsedEqWeight) &&
        parsedEqWeight > 0
    ) ? parsedEqWeight : undefined;

    const editedFields = {
        name: draft.name.trim(),
        notes: draft.notes.trim(),
        muscles: draft.selectedMuscles.map(muscle => muscle.id),
        secondaryMuscles: draft.secondaryMuscles.map(muscle => muscle.id),
        trackingType: draft.trackingType,
        isBodyweight: draft.isBodyweight || undefined,
        equipmentWeight: validEqWeight,
    };

    if (editingExId) {
        const existing = library.find(ex => ex.id === editingExId);
        return existing ? { ...existing, ...editedFields } : undefined;
    }

    const id = createId();
    // A generated identity collision must never silently select a different exercise.
    if (library.some(ex => ex.id === id)) return undefined;
    return { id, ...editedFields, setsCount: 3, sets: [] };
}
