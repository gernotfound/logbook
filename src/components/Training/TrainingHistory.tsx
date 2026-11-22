import { useTrainingHistory } from '../../hooks/useTrainingHistory';
import type { WorkoutSession } from '../../types';
import WorkoutReportModal from './WorkoutReportModal';
import { TrainingHistoryView } from './history/TrainingHistoryView';

interface TrainingHistoryProps {
    onEditWorkout?: (workout: WorkoutSession) => void;
}

const TrainingHistory = ({ onEditWorkout }: TrainingHistoryProps) => {
    const { history, library, deleteWorkout } = useTrainingHistory();
    return (
        <TrainingHistoryView
            history={history}
            onEditWorkout={onEditWorkout}
            onDeleteWorkout={deleteWorkout}
            renderReport={(workout, onClose) => (
                <WorkoutReportModal
                    workout={workout}
                    history={history}
                    library={library}
                    onClose={onClose}
                    fromEndWorkout={false}
                />
            )}
        />
    );
};

export default TrainingHistory;
