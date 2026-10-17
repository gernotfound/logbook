import { canRepresentSetAsRoutinePlan, getContinuationTechnique, getRoutineSetPlan, getSetSegments } from '../advancedSets';
import type { RoutineExercise, WorkoutRoutine, WorkoutSession } from '../../types';

/** Convert observed sets into a reusable plan without modifying the completed workout. */
export function routineFromWorkout(workout: WorkoutSession, routineId: string, name: string): WorkoutRoutine {
    const routineExercises: RoutineExercise[] = workout.exercises.map(ex => {
        let minReps = Infinity;
        let maxReps = -Infinity;
        let validSetsCount = 0;

        ex.sets.forEach(set => {
            const reps = parseInt(set.reps, 10);
            if (!isNaN(reps)) {
                if (reps < minReps) minReps = reps;
                if (reps > maxReps) maxReps = reps;
            }
            validSetsCount++;
        });

        const finalMinReps = minReps !== Infinity ? minReps : undefined;
        const finalMaxReps = maxReps !== -Infinity ? maxReps : undefined;

        const hasOnlyIsometry = ex.sets.length > 0 && ex.sets.every(set => {
            const segments = getSetSegments(set);
            return segments.length > 0 && segments.every(segment => getContinuationTechnique(set, segment) === 'isometry');
        });
        const hasMixedTechniqueChain = ex.sets.some(s => !canRepresentSetAsRoutinePlan(s));
        const setPlans = hasOnlyIsometry || hasMixedTechniqueChain ? undefined : ex.sets.map(getRoutineSetPlan);

        const result: RoutineExercise = {
            exId: ex.exId,
            setsCount: Math.max(1, validSetsCount)
        };
        if (finalMinReps !== undefined) result.minReps = finalMinReps;
        if (finalMaxReps !== undefined) result.maxReps = finalMaxReps;
        if (hasOnlyIsometry) result.defaultTechnique = 'isometrics';
        else if (setPlans?.some(plan => plan.technique !== 'straight')) result.setPlans = setPlans;

        return result;
    });

    return { id: routineId, name, exercises: routineExercises };
}
