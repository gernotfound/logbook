import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useNutritionPlanningEditor } from '../../hooks/useNutritionPlanningEditor';
import { useDialogStore } from '../../store/useDialogStore';
import { NutritionPlanningForm } from './NutritionPlanningForm';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/** Candidate-only view. The parent owns opening and reconciling the Kinde realm. */
export function KindeCandidateNutritionPlanning({ realm }: { realm: Realm }) {
    const showAlert = useDialogStore(state => state.showAlert);
    const state = realm.state;
    const snapshot = state.phase === 'ready' ? state.snapshot : null;
    const editor = useNutritionPlanningEditor({
        owner: snapshot?.owner ?? null,
        data: snapshot?.data,
        capture: realm.captureEditWitness,
        dispatch: async operation => {
            await realm.submit(operation);
            return 'durable';
        },
    }, showAlert);

    if (state.phase === 'recheck-required') {
        return <p role="status">Modifiche salvate sul dispositivo. Conferma cloud in attesa.</p>;
    }
    if (state.phase !== 'ready') return null;
    // The realm owns the pending state. A local save result cached by the
    // editor would otherwise survive a verified recheck in the same session.
    const saveStatus = state.hasPendingJournal && editor.saveStatus === 'idle'
        ? 'local-pending' : editor.saveStatus;
    return <NutritionPlanningForm editor={{ ...editor, saveStatus }} />;
}
