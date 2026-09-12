import TrainingSession from './TrainingSession';
import TrainingPlanning from './planning/TrainingPlanning';
import TrainingRoutines from './TrainingRoutines';
import TrainingExercises from './TrainingExercises';
import TrainingHistory from './TrainingHistory';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import type { WorkoutSession, TrainingSubTab } from '../../types';
import SectionTabs from '../UI/SectionTabs';

interface TrainingViewProps {
    subTab?: TrainingSubTab;
    setSubTab?: (tab: TrainingSubTab) => void;
}

const TrainingView = ({ subTab = 'session', setSubTab }: TrainingViewProps) => {
    const { startEditHistoricalWorkout } = useWorkoutSession();

    const handleEditWorkout = async (wo: WorkoutSession) => {
        const ok = await startEditHistoricalWorkout(wo);
        if (ok && setSubTab) {
            setSubTab('session');
        }
    };

    const TRAINING_TABS = [
        { value: 'session', label: 'Sessione' },
        { value: 'planning', label: 'Pianificazione' },
        { value: 'routines', label: 'Schede' },
        { value: 'exercises', label: 'Esercizi' },
        { value: 'history', label: 'Storico' },
    ] as const;

    return (
        <div id="view-training" className="view-section active">
            <SectionTabs
                value={subTab}
                onChange={(val) => setSubTab?.(val)}
                tabs={TRAINING_TABS}
                ariaLabel="Sotto-menu Allenamento"
            />

            {subTab === 'session' && (
                <TrainingSession
                    onNavigateToHistory={() => setSubTab?.('history')}
                    onNavigateToPlanning={() => setSubTab?.('planning')}
                />
            )}
            {subTab === 'planning' && <TrainingPlanning />}
            {subTab === 'routines' && <TrainingRoutines />}
            {subTab === 'exercises' && <TrainingExercises />}
            {subTab === 'history' && <TrainingHistory onEditWorkout={handleEditWorkout} />}
        </div>
    );
};

export default TrainingView;
