import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { TrainingSessionSetup } from './TrainingSessionSetup';
import { ActiveWorkoutSession } from './ActiveWorkoutSession';

interface TrainingSessionProps {
    onNavigateToHistory?: () => void;
    onNavigateToPlanning?: () => void;
}

const TrainingSession = ({ onNavigateToHistory, onNavigateToPlanning }: TrainingSessionProps) => {
    const { activeWorkout } = useWorkoutSession();

    if (!activeWorkout) {
        return <TrainingSessionSetup onNavigateToPlanning={onNavigateToPlanning} />;
    }

    return <ActiveWorkoutSession onNavigateToHistory={onNavigateToHistory} />;
};

export default TrainingSession;
