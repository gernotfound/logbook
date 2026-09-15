import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import type { WorkoutSession, Exercise } from '../types';

const EMPTY_HISTORY: WorkoutSession[] = [];
const EMPTY_LIBRARY: Exercise[] = [];
const EMPTY_PAINS: string[] = [];

export function useTrainingHistory() {
    const history = useAppStore(state => state.userData?.history || EMPTY_HISTORY);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const activePains = useAppStore(state => state.userData?.activePains || EMPTY_PAINS);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);

    const deleteWorkout = async (id: string) => {
        if (await showConfirm("Eliminare definitivamente questo allenamento dallo storico?")) {
            try {
                const workoutToDelete = history.find(workout => workout.id === id);
                const nextPains = workoutToDelete?.pains?.length
                    ? activePains.filter(pain => !workoutToDelete.pains!.includes(pain))
                    : activePains;
                await dispatchDomainOperation([
                    { type: 'history.delete', id },
                    { type: 'active-pains.set', pains: nextPains },
                ]);
                const localWorkout = useAppStore.getState().localWorkout;
                if (localWorkout && (localWorkout.id === id || localWorkout.originalHistoryId === id)) {
                    useAppStore.getState().setLocalWorkout(null);
                }
            } catch {
                showAlert("Errore durante l'eliminazione dell'allenamento.");
            }
        }
    };

    return {
        userData: { history, library },
        history,
        library,
        deleteWorkout
    };
}
