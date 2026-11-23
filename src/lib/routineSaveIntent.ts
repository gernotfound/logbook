import { normalizeBusinessId } from './businessIdentity';
import { MAX_ROUTINE_SEGMENTS, parseRoutineSetCount } from './routineSessionLimits';
import { generateUniqueName } from './utils/string';
import type { DomainOperation, DomainOperationBatch } from './sync/domainOperations';
import type { RoutineExercise, WorkoutRoutine } from '../types';

export function routineDraftValidationError(name: string, exercises: readonly RoutineExercise[]): string | null {
    if (!name.trim()) return 'Inserisci il nome della scheda';

    const ids = new Set<string>();
    for (const exercise of exercises) {
        const id = normalizeBusinessId(exercise.exId);
        if (!id) return 'La scheda contiene un esercizio con identificativo non valido.';
        if (ids.has(id)) {
            // Each routine exercise is keyed by exId in Domain Operations.
            return 'Lo stesso esercizio è presente due volte nella scheda. Rimuovi una voce prima di salvare.';
        }
        ids.add(id);
    }

    if (exercises.some(exercise => parseRoutineSetCount(exercise.setsCount) === null)) {
        return 'Ogni esercizio può contenere da 1 a 20 serie. Correggi il valore prima di salvare la scheda.';
    }
    if (exercises.some(exercise => exercise.setPlans?.some(plan => plan.segmentCount !== undefined
        && (!Number.isSafeInteger(plan.segmentCount) || plan.segmentCount < 2 || plan.segmentCount > MAX_ROUTINE_SEGMENTS)))) {
        return 'Ogni serie avanzata può avere da 2 a 20 segmenti. Correggi il valore prima di salvare la scheda.';
    }
    return null;
}

export function buildRoutineSaveOperations({
    name, exercises, routines, editingRoutineId, createId,
}: {
    name: string;
    exercises: readonly RoutineExercise[];
    routines: readonly WorkoutRoutine[];
    editingRoutineId?: string | null;
    createId?: string;
}): DomainOperationBatch {
    const validation = routineDraftValidationError(name, exercises);
    if (validation) throw new Error(validation);

    const savedExercises: RoutineExercise[] = exercises.map(exercise => ({
        ...exercise,
        setsCount: Number(exercise.setsCount),
    }));
    const savedName = name.trim();

    if (editingRoutineId) {
        if (!routines.some(routine => routine.id === editingRoutineId)) throw new Error('Routine non trovata');
        return { type: 'routine.edit', id: editingRoutineId, name: savedName, exercises: savedExercises };
    }

    const id = normalizeBusinessId(createId);
    if (!id || id !== createId || routines.some(routine => routine.id === id)) {
        throw new Error('Identificativo nuova scheda non valido o già presente');
    }
    const created: WorkoutRoutine = { id, name: savedName, exercises: savedExercises };
    const orderIds = [...routines, created].sort((a, b) => a.name.localeCompare(b.name)).map(routine => routine.id);
    return [
        { type: 'routine.upsert', routine: created },
        { type: 'routine.reorder', ids: orderIds },
    ];
}

export function buildRoutineDuplicateOperation(
    routine: WorkoutRoutine, routines: readonly WorkoutRoutine[], createId: string,
): DomainOperation {
    const id = normalizeBusinessId(createId);
    if (!id || id !== createId || routines.some(item => item.id === id)) {
        throw new Error('Identificativo duplicazione non valido o già presente');
    }
    return {
        type: 'routine.upsert',
        routine: {
            ...structuredClone(routine),
            id,
            name: generateUniqueName(routine.name, routines.map(item => item.name)),
        },
    };
}
