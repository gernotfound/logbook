import TrainingSession from './TrainingSession';
import TrainingPlanning from './planning/TrainingPlanning';
import TrainingRoutines from './TrainingRoutines';
import TrainingExercises from './TrainingExercises';
import TrainingHistory from './TrainingHistory';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import type { WorkoutSession, TrainingSubTab } from '../../types';
import SubNav from '../UI/SubNav';
import './training.css';

const TRAINING_TABS = [{ id: 'session', label: 'Sessione' }, { id: 'planning', label: 'Pianificazione' }, { id: 'routines', label: 'Schede' }, { id: 'exercises', label: 'Esercizi' }, { id: 'history', label: 'Storico' }];

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

    return (
        <div id="view-training" className="view-section active">
            <SubNav id="training" label="Sotto-menu Allenamento" items={TRAINING_TABS} value={subTab} onChange={value => setSubTab?.(value as TrainingSubTab)} />
            <div id={`training-panel-${subTab}`} role="tabpanel" aria-labelledby={`training-tab-${subTab}`}>
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
        </div>
    );
};

export default TrainingView;
