import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useNutritionPlanningEditor } from '../../hooks/useNutritionPlanningEditor';
import { useDialogStore } from '../../store/useDialogStore';
import { NutritionPlanningForm } from './NutritionPlanningForm';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/** Candidate-only view. The parent owns opening and reconciling the Kinde realm. */
export function KindeCandidateNutritionPlanning({ realm }: { realm: Realm }) {
    const showAlert = useDialogStore(state => state.showAlert);
    const snapshot = realm.state.phase === 'ready' ? realm.state.snapshot : null;
    const editor = useNutritionPlanningEditor({
        owner: snapshot?.owner ?? null,
        data: snapshot?.data,
        capture: realm.captureEditWitness,
        dispatch: async operation => {
            const result = await realm.submit(operation);
            return result.kind === 'local-pending' ? 'local-pending' : 'durable';
        },
    }, showAlert);

    if (realm.state.phase === 'recheck-required') {
        return <p role="status">Modifiche salvate sul dispositivo. Conferma cloud in attesa.</p>;
    }
    return snapshot ? <NutritionPlanningForm editor={editor} /> : null;
}
