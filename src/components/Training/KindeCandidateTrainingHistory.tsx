import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { TrainingHistoryView } from './history/TrainingHistoryView';
import { WorkoutReportView } from './report/WorkoutReportView';
import './training-history.css';
import './training-overview.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/** Only the ready owner-scoped snapshot may supply report inputs; no legacy writer. */
export function KindeCandidateTrainingHistory({ realm }: { realm: Realm }) {
    if (realm.state.phase !== 'ready') return null;
    const { history = [], library = [], nutrition } = realm.state.snapshot.data;
    return (
        <TrainingHistoryView
            history={history}
            renderReport={(workout, onClose) => (
                <WorkoutReportView
                    workout={workout}
                    history={history}
                    library={library}
                    nutrition={nutrition}
                    onClose={onClose}
                />
            )}
        />
    );
}
