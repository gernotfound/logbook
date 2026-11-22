import { useRef } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useDialogStore } from '../../store/useDialogStore';
import { TrainingHistoryView } from './history/TrainingHistoryView';
import { WorkoutReportView } from './report/WorkoutReportView';
import './training-history.css';
import './training-overview.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/** Only the ready owner-scoped snapshot may supply reports or deletion intents; never the legacy writer. */
export function KindeCandidateTrainingHistory({ realm }: { realm: Realm }) {
    const operationInFlight = useRef(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    if (realm.state.phase !== 'ready') return null;
    const { history = [], library = [], nutrition } = realm.state.snapshot.data;

    const remove = async (id: string) => {
        if (operationInFlight.current || !history.some(workout => workout.id === id)) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        operationInFlight.current = true;
        try {
            const confirmed = await showConfirm('Eliminare definitivamente questo allenamento dallo storico?');
            // The dialog may resolve after logout, consent revocation or a different owner takes over.
            if (!confirmed || !witness.isCurrent()) return;
            await realm.submit({ type: 'history.delete', id });
            // Pending D1 receipts are owned by the realm; do not replay or claim cloud success here.
        } catch {
            if (witness.isCurrent()) await showAlert("Errore durante l'eliminazione dell'allenamento.");
        } finally {
            operationInFlight.current = false;
        }
    };

    return (
        <TrainingHistoryView
            history={history}
            onDeleteWorkout={remove}
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
