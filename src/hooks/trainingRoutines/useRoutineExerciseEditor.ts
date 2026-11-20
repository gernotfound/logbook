import { useState } from 'react';
import { parseRoutineSetCount, previewRoutineSets } from '../../lib/routineSessionLimits';
import type { PlannedSetTechnique, ProgressionContract, RoutineExercise, SetTechnique } from '../../types';

function validIndex(index: number, length: number): boolean {
    return Number.isSafeInteger(index) && index >= 0 && index < length;
}

export function useRoutineExerciseEditor(initialExercises?: RoutineExercise[]) {
    const [routineExercises, setRoutineExercises] = useState<RoutineExercise[]>(() =>
        Array.isArray(initialExercises) ? initialExercises : []
    );

    const handleAddExerciseToRoutine = (exId: string) => {
        if (!exId) return;
        setRoutineExercises(prev => [...prev, { exId, setsCount: 3 }]);
    };

    const handleUpdateSetsCount = (index: number, count: string | number) => {
        setRoutineExercises(prev => {
            if (!validIndex(index, prev.length)) return prev;
            const newExs = [...prev];
            const currentExercise = newExs[index];

            if (count === '' || count === undefined || count === null) {
                newExs[index] = { ...currentExercise, setsCount: '' };
                return newExs;
            }

            const parsed = parseRoutineSetCount(count);
            if (parsed === null) {
                // Keep the uncommitted input and set plans intact until the user
                // corrects it; truncating it would silently change the workout.
                newExs[index] = { ...currentExercise, setsCount: String(count) };
                return newExs;
            }

            const normalizedCount = parsed;
            const currentPlans = Array.isArray(currentExercise.setPlans) ? currentExercise.setPlans : [];
            const setPlans: PlannedSetTechnique[] = Array.from({ length: normalizedCount }, (_, setIndex) => ({
                ...(currentPlans[setIndex] || { technique: 'straight' as const }),
            }));

            newExs[index] = {
                ...currentExercise,
                setsCount: normalizedCount,
                setPlans,
            };
            return newExs;
        });
    };

    const handleUpdateReps = (index: number, field: 'minReps' | 'maxReps', value: string) => {
        setRoutineExercises(prev => {
            if (!validIndex(index, prev.length)) return prev;
            const newExs = [...prev];
            const parsed = parseInt(value);
            if (isNaN(parsed)) {
                const ex = { ...newExs[index] };
                delete ex[field];
                newExs[index] = ex;
            } else {
                newExs[index] = { ...newExs[index], [field]: parsed };
            }
            return newExs;
        });
    };

    const handleUpdateSetPlan = (
        exerciseIndex: number,
        setIndex: number,
        technique: SetTechnique,
    ) => {
        setRoutineExercises(prev => {
            if (!validIndex(exerciseIndex, prev.length)) return prev;
            const exercises = [...prev];
            const exercise = { ...exercises[exerciseIndex] };
            const count = previewRoutineSets(exercise.setsCount, exercise.setPlans ?? []);
            if (setIndex < 0 || setIndex >= count) return prev;
            const plans: PlannedSetTechnique[] = Array.from({ length: count }, (_, index) => ({
                ...(exercise.setPlans?.[index] || { technique: 'straight' as const }),
            }));
            plans[setIndex] = { technique };
            exercise.setPlans = plans;
            exercises[exerciseIndex] = exercise;
            return exercises;
        });
    };

    const handleUpdateSetPlanField = (
        exerciseIndex: number,
        setIndex: number,
        field: 'restSeconds' | 'segmentCount' | 'targetReps',
        value: string,
    ) => {
        setRoutineExercises(prev => {
            if (!validIndex(exerciseIndex, prev.length)) return prev;
            const exercises = [...prev];
            const exercise = { ...exercises[exerciseIndex] };
            const count = previewRoutineSets(exercise.setsCount, exercise.setPlans ?? []);
            if (setIndex < 0 || setIndex >= count) return prev;
            const plans: PlannedSetTechnique[] = Array.from({ length: count }, (_, index) => ({
                ...(exercise.setPlans?.[index] || { technique: 'straight' as const }),
            }));
            const plan = { ...plans[setIndex] };
            const parsed = value.trim() === '' ? undefined
                : field === 'segmentCount' ? Number(value) : Number.parseInt(value, 10);

            if (field === 'targetReps') {
                if (parsed === undefined || !Number.isFinite(parsed) || parsed < 1) delete plan.target;
                else plan.target = { type: 'reps', reps: parsed };
            } else if (parsed === undefined || !Number.isFinite(parsed) || parsed < (field === 'restSeconds' ? 0 : 2)) {
                delete plan[field];
            } else {
                plan[field] = parsed;
            }
            plans[setIndex] = plan;
            exercise.setPlans = plans;
            exercises[exerciseIndex] = exercise;
            return exercises;
        });
    };

    const handleUpdateExerciseMetadata = (
        index: number,
        field: 'technicalStandard' | keyof ProgressionContract,
        value: string,
    ) => {
        setRoutineExercises(prev => {
            if (!validIndex(index, prev.length)) return prev;
            const exercises = [...prev];
            const exercise = { ...exercises[index] };
            if (field === 'technicalStandard') {
                const normalized = value.trim();
                if (normalized) exercise.technicalStandard = value;
                else delete exercise.technicalStandard;
            } else {
                const contract: ProgressionContract = { ...(exercise.progressionContract || {}) };
                const normalized = value.trim();
                if (normalized) (contract as Record<string, unknown>)[field] = value;
                else delete (contract as Record<string, unknown>)[field];
                exercise.progressionContract = Object.keys(contract).length ? contract : undefined;
            }
            exercises[index] = exercise;
            return exercises;
        });
    };

    const handleRemoveExerciseFromRoutine = (indexToRemove: number, expected?: RoutineExercise) => {
        setRoutineExercises(prev => {
            let resolvedIndex = indexToRemove;
            if (expected) {
                // A dialog can settle after reorder or edit: identify the exact
                // draft snapshot shown when it was opened, not the old index.
                resolvedIndex = prev.indexOf(expected);
                if (resolvedIndex === -1 || prev.lastIndexOf(expected) !== resolvedIndex) return prev;
            }
            if (!validIndex(resolvedIndex, prev.length)) return prev;
            return prev.filter((_, idx) => idx !== resolvedIndex);
        });
    };

    const moveExercise = (index: number, direction: number) => {
        setRoutineExercises(prev => {
            if (!validIndex(index, prev.length) || !validIndex(index + direction, prev.length)
                || (direction !== -1 && direction !== 1)) return prev;
            const newExs = [...prev];
            if (direction === -1 && index > 0) {
                [newExs[index], newExs[index - 1]] = [newExs[index - 1], newExs[index]];
            } else if (direction === 1 && index < newExs.length - 1) {
                [newExs[index], newExs[index + 1]] = [newExs[index + 1], newExs[index]];
            }
            return newExs;
        });
    };

    return {
        routineExercises, setRoutineExercises,
        handleAddExerciseToRoutine, handleUpdateSetsCount, handleUpdateReps, handleUpdateSetPlan,
        handleUpdateSetPlanField, handleUpdateExerciseMetadata,
        handleRemoveExerciseFromRoutine, moveExercise,
    };
}
