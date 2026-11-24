import { useAppStore } from '../../store/useAppStore';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import type { TrainingCycle } from '../../types';
import { TrainingSessionSetupView } from './TrainingSessionSetupView';

const EMPTY_CYCLES: TrainingCycle[] = [];

export interface TrainingSessionSetupProps {
    onNavigateToPlanning?: () => void;
}

export function TrainingSessionSetup({ onNavigateToPlanning }: TrainingSessionSetupProps) {
    const trainingCycles = useAppStore(state => state.userData?.trainingCycles || EMPTY_CYCLES);
    const activeCycleId = useAppStore(state => state.userData?.activeCycleId ?? null);
    const activeCycle = activeCycleId ? trainingCycles.find(cycle => cycle.id === activeCycleId) : null;
    const { routines, history, startWorkout, startFreeWorkout } = useWorkoutSession();
    return <TrainingSessionSetupView activeCycle={activeCycle} routines={routines} history={history}
        startWorkout={startWorkout} startFreeWorkout={startFreeWorkout} onNavigateToPlanning={onNavigateToPlanning} />;
}
