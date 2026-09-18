import { useState } from 'react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { TrainingSessionSetup } from './TrainingSessionSetup';
import { ActiveWorkoutSession } from './ActiveWorkoutSession';
import WorkoutReportModal from './WorkoutReportModal';
import type { WorkoutSession } from '../../types';

interface TrainingSessionProps {
    onNavigateToHistory?: () => void;
    onNavigateToPlanning?: () => void;
}

const TrainingSession = ({ onNavigateToHistory, onNavigateToPlanning }: TrainingSessionProps) => {
    const { activeWorkout, history, library } = useWorkoutSession();
    const [reportWorkout, setReportWorkout] = useState<WorkoutSession | null>(null);

    // This owner survives the localWorkout clear that follows a successful commit.
    if (reportWorkout) {
        return <WorkoutReportModal workout={reportWorkout} history={history} library={library} fromEndWorkout onClose={() => {
            setReportWorkout(null);
            window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'home' }));
        }} />;
    }

    if (!activeWorkout) {
        return <TrainingSessionSetup onNavigateToPlanning={onNavigateToPlanning} />;
    }

    return <ActiveWorkoutSession onNavigateToHistory={onNavigateToHistory} onWorkoutCompleted={setReportWorkout} />;
};

export default TrainingSession;
