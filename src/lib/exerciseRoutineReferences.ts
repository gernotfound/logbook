import type { WorkoutRoutine } from '../types';

export function exerciseRoutineReferences(routines: readonly WorkoutRoutine[], id: string): string[] {
    return routines.filter(routine => (routine.exercises ?? []).some(exercise => exercise.exId === id))
        .map(routine => routine.id).sort();
}
