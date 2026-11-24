import { useRef, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useDialogStore } from '../../store/useDialogStore';
import { TrainingHistoryView } from './history/TrainingHistoryView';
import { WorkoutReportView } from './report/WorkoutReportView';
import type { KindeHistoryWorkoutDraft } from '../../lib/auth/kindeCandidateHistoryWorkoutDraft';
import { KindeHistoryWorkoutEditor } from './KindeHistoryWorkoutEditor';
import './training-history.css';
import './training-overview.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/** Only the ready owner-scoped snapshot may supply reports or deletion intents; never the legacy writer. */
export function KindeCandidateTrainingHistory({ realm }: { realm: Realm }) {
    const operationInFlight = useRef(false);
    const [editor, setEditor] = useState<{ draft: KindeHistoryWorkoutDraft; isCurrent: () => boolean } | null>(null);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    if (realm.state.phase !== 'ready') return null;
    const { history = [], library = [], nutrition } = realm.state.snapshot.data;

    const openEditor = async (id?: string) => {
        if (operationInFlight.current || editor) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        operationInFlight.current = true;
        let draft: KindeHistoryWorkoutDraft | undefined;
        try {
            draft = await realm.openHistoryWorkoutDraft(id);
            if (!witness.isCurrent()) { draft.close(); return; }
            if (!draft.initial.stale && !draft.initial.submitted) draft.write(draft.initial);
            setEditor({ draft, isCurrent: witness.isCurrent });
        } catch {
            draft?.close();
            if (witness.isCurrent()) await showAlert('Impossibile aprire la seduta. Verifica se esiste già una bozza dello storico.');
        } finally { operationInFlight.current = false; }
    };

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

    if (editor?.isCurrent()) return <KindeHistoryWorkoutEditor
        key={editor.draft.initial.workout.id} draft={editor.draft} isCurrent={editor.isCurrent}
        realm={realm} onClose={() => setEditor(null)} />;

    return (<>
        <button type="button" className="btn" onClick={() => { void openEditor(); }}>Riprendi bozza dello storico</button>
        <TrainingHistoryView
            history={history}
            onEditWorkout={workout => { if (workout.id) void openEditor(workout.id); }}
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
    </>);
}
