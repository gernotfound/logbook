import type { Exercise } from '../types';
import type { ExerciseDraft } from './exerciseEditorDraft';
import type { ExerciseEditableFields } from './sync/domainOperations/contracts';

export function hasDuplicateExerciseName(
    library: readonly Exercise[],
    editingExId: string | null,
    name: string,
): boolean {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return false;
    return library.some(ex => ex.id !== editingExId && ex.name.trim().toLowerCase() === trimmed);
}

export function exerciseDraftProblem(library: readonly Exercise[], editingId: string | null, draft: ExerciseDraft): string | null {
    if (!draft.name.trim()) return 'Inserisci un nome per l’esercizio.';
    if (hasDuplicateExerciseName(library, editingId, draft.name)) {
        return 'Esiste già un esercizio con questo nome nell’archivio.';
    }
    const weight = draft.equipmentWeight.trim();
    const parsedWeight = Number(weight.replace(',', '.'));
    if (weight && (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(weight)
        || !Number.isFinite(parsedWeight) || parsedWeight < 0)) return 'Inserisci un peso attrezzo valido.';
    return null;
}

export function buildExerciseEditorFields(draft: ExerciseDraft): ExerciseEditableFields {
    const parsedEqWeight = draft.equipmentWeight
        ? parseFloat(String(draft.equipmentWeight).replace(',', '.'))
        : undefined;
    const validEqWeight = (
        parsedEqWeight !== undefined &&
        !isNaN(parsedEqWeight) &&
        parsedEqWeight > 0
    ) ? parsedEqWeight : undefined;

    return {
        name: draft.name.trim(),
        notes: draft.notes.trim(),
        muscles: draft.selectedMuscles.map(muscle => muscle.id),
        secondaryMuscles: draft.secondaryMuscles.map(muscle => muscle.id),
        trackingType: draft.trackingType,
        isBodyweight: draft.isBodyweight || undefined,
        equipmentWeight: validEqWeight,
    };
}

export function buildExerciseSavePayload(
    library: readonly Exercise[],
    editingExId: string | null,
    draft: ExerciseDraft,
    createId: () => string,
): Exercise | undefined {
    const editedFields = buildExerciseEditorFields(draft);
    if (editingExId) {
        const existing = library.find(ex => ex.id === editingExId);
        return existing ? { ...existing, ...editedFields } : undefined;
    }

    const id = createId();
    // A generated identity collision must never silently select a different exercise.
    if (library.some(ex => ex.id === id)) return undefined;
    return { id, ...editedFields, setsCount: 3, sets: [] };
}
