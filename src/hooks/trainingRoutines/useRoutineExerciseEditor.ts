import { useState } from 'react';
import type { RoutineExercise } from '../../types';
import { routineExerciseEditorActions } from './routineExerciseEditorActions';

export function useRoutineExerciseEditor(initialExercises?: RoutineExercise[]) {
    const [routineExercises, setRoutineExercises] = useState<RoutineExercise[]>(() =>
        Array.isArray(initialExercises) ? initialExercises : [],
    );
    return { routineExercises, setRoutineExercises, ...routineExerciseEditorActions(setRoutineExercises) };
}
