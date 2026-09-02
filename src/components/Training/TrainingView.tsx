import TrainingSession from './TrainingSession';
import TrainingPlanning from './planning/TrainingPlanning';
import TrainingRoutines from './TrainingRoutines';
import TrainingExercises from './TrainingExercises';
import TrainingHistory from './TrainingHistory';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import type { WorkoutSession, TrainingSubTab } from '../../types';

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

    const handleWheel = (e: any) => {
        if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
        }
    };

    return (
        <div id="view-training" className="view-section active">
            <div className="sub-nav" onWheel={handleWheel}>
                <div className={`sub-nav-btn ${subTab === 'session' ? 'active' : ''}`} onClick={() => setSubTab?.('session')}>Sessione</div>
                <div className={`sub-nav-btn ${subTab === 'planning' ? 'active' : ''}`} onClick={() => setSubTab?.('planning')}>Pianificazione</div>
                <div className={`sub-nav-btn ${subTab === 'routines' ? 'active' : ''}`} onClick={() => setSubTab?.('routines')}>Schede</div>
                <div className={`sub-nav-btn ${subTab === 'exercises' ? 'active' : ''}`} onClick={() => setSubTab?.('exercises')}>Esercizi</div>
                <div className={`sub-nav-btn ${subTab === 'history' ? 'active' : ''}`} onClick={() => setSubTab?.('history')}>Storico</div>
            </div>

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
