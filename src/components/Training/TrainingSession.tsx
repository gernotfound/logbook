import { useCallback, useState } from 'react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { TrainingSessionSetup } from './TrainingSessionSetup';
import { ActiveWorkoutSession } from './ActiveWorkoutSession';
import PreSessionCheckIn from './PreSessionCheckIn';
import WorkoutReportModal from './WorkoutReportModal';
import type { WorkoutSession } from '../../types';

interface TrainingSessionProps {
    onNavigateToHistory?: () => void;
    onNavigateToPlanning?: () => void;
}

const TrainingSession = ({ onNavigateToHistory, onNavigateToPlanning }: TrainingSessionProps) => {
    const { activeWorkout, history, library, confirmWorkoutStart } = useWorkoutSession();
    const [reportWorkout, setReportWorkout] = useState<WorkoutSession | null>(null);
    const handleCloseReport = useCallback(() => {
        setReportWorkout(null);
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'home' }));
    }, []);

    // Il report appartiene al contenitore della sessione: deve sopravvivere alla
    // cancellazione del workout locale che segue un salvataggio riuscito.
    if (reportWorkout) {
        return (
            <WorkoutReportModal
                workout={reportWorkout}
                history={history}
                library={library}
                fromEndWorkout
                onClose={handleCloseReport}
            />
        );
    }

    if (activeWorkout && !activeWorkout.isEditingHistory && !activeWorkout.globalStartTime) {
        return (
            <PreSessionCheckIn
                routineName={activeWorkout.routineName}
                date={activeWorkout.date}
                onStart={confirmWorkoutStart}
            />
        );
    }

    if (!activeWorkout) {
        return <TrainingSessionSetup onNavigateToPlanning={onNavigateToPlanning} />;
    }

    return (
        <ActiveWorkoutSession
            onNavigateToHistory={onNavigateToHistory}
            onWorkoutCompleted={setReportWorkout}
        />
    );
};

export default TrainingSession;
