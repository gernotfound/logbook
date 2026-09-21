import TrainingSession from './TrainingSession';
import TrainingPlanning from './planning/TrainingPlanning';
import TrainingRoutines from './TrainingRoutines';
import TrainingExercises from './TrainingExercises';
import TrainingHistory from './TrainingHistory';
import SubNav from '../UI/SubNav';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import type { WorkoutSession, TrainingSubTab } from '../../types';
import './training.css';

const TRAINING_TABS: ReadonlyArray<{ id: TrainingSubTab; label: string }> = [
    { id: 'session', label: 'Sessione' },
    { id: 'planning', label: 'Pianificazione' },
    { id: 'routines', label: 'Schede' },
    { id: 'exercises', label: 'Esercizi' },
    { id: 'history', label: 'Storico' }
];

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
            <SubNav
                id="training"
                label="Sotto-menu Allenamento"
                items={TRAINING_TABS}
                value={subTab}
                onChange={tab => setSubTab?.(tab)}
            />

            {subTab === 'session' && (
                <div id="training-panel-session" role="tabpanel" aria-labelledby="training-tab-session">
                    <TrainingSession
                        onNavigateToHistory={() => setSubTab?.('history')}
                        onNavigateToPlanning={() => setSubTab?.('planning')}
                    />
                </div>
            )}
            {subTab === 'planning' && <div id="training-panel-planning" role="tabpanel" aria-labelledby="training-tab-planning"><TrainingPlanning /></div>}
            {subTab === 'routines' && <div id="training-panel-routines" role="tabpanel" aria-labelledby="training-tab-routines"><TrainingRoutines /></div>}
            {subTab === 'exercises' && <div id="training-panel-exercises" role="tabpanel" aria-labelledby="training-tab-exercises"><TrainingExercises /></div>}
            {subTab === 'history' && <div id="training-panel-history" role="tabpanel" aria-labelledby="training-tab-history"><TrainingHistory onEditWorkout={handleEditWorkout} /></div>}
        </div>
    );
};

export default TrainingView;
