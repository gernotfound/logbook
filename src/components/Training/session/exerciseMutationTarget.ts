import { useAppStore } from '../../../store/useAppStore';

/** A buffered callback can outlive a reorder; only its captured exercise may receive it. */
export function isCurrentExerciseMutationTarget(
    workoutId: string, index: number, exerciseId: string | undefined,
): boolean {
    const current = useAppStore.getState().localWorkout;
    return typeof exerciseId === 'string' && exerciseId.length > 0
        && current?.id === workoutId && current.exercises[index]?.id === exerciseId;
}
