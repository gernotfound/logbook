import { lazy, Suspense } from 'react';
import TrainingSession from './TrainingSession';
import SubNav from '../UI/SubNav';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import type { WorkoutSession, TrainingSubTab } from '../../types';
import './training.css';

// The active workout must remain immediately available. Secondary panels are
// loaded only on demand; the PWA precache still covers their chunks offline.
const TrainingPlanning = lazy(() => import('./planning/TrainingPlanning'));
const TrainingRoutines = lazy(() => import('./TrainingRoutines'));
const TrainingExercises = lazy(() => import('./TrainingExercises'));
const TrainingHistory = lazy(() => import('./TrainingHistory'));

const SUBTAB_LOADING = <p role="status" className="text-muted">Caricamento sottosezione in corso…</p>;

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
            {subTab === 'planning' && (
                <div id="training-panel-planning" role="tabpanel" aria-labelledby="training-tab-planning">
                    <Suspense fallback={SUBTAB_LOADING}>
                        <TrainingPlanning onOpenSession={() => setSubTab?.('session')} />
                    </Suspense>
                </div>
            )}
            {subTab === 'routines' && <div id="training-panel-routines" role="tabpanel" aria-labelledby="training-tab-routines"><Suspense fallback={SUBTAB_LOADING}><TrainingRoutines /></Suspense></div>}
            {subTab === 'exercises' && <div id="training-panel-exercises" role="tabpanel" aria-labelledby="training-tab-exercises"><Suspense fallback={SUBTAB_LOADING}><TrainingExercises /></Suspense></div>}
            {subTab === 'history' && <div id="training-panel-history" role="tabpanel" aria-labelledby="training-tab-history"><Suspense fallback={SUBTAB_LOADING}><TrainingHistory onEditWorkout={handleEditWorkout} /></Suspense></div>}
        </div>
    );
};

export default TrainingView;
