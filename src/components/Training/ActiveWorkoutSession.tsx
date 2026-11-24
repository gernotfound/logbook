import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { isCurrentExerciseMutationTarget } from './session/exerciseMutationTarget';
import { WorkoutSessionEditor, type ActiveWorkoutSessionProps } from './WorkoutSessionEditor';

export { GlobalTimer } from './session/GlobalTimer';
export type { ActiveWorkoutSessionProps } from './WorkoutSessionEditor';

export function ActiveWorkoutSession(props: ActiveWorkoutSessionProps) {
    const session = useWorkoutSession();
    return <WorkoutSessionEditor {...props} session={session} historyEditor={session}
        isCurrentTarget={isCurrentExerciseMutationTarget} />;
}
