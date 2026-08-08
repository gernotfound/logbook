
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import type { WorkoutSession, Exercise } from '../types';

const EMPTY_HISTORY: WorkoutSession[] = [];
const EMPTY_LIBRARY: Exercise[] = [];

export function useTrainingHistory() {
    const history = useAppStore(state => state.userData?.history || EMPTY_HISTORY);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);

    const deleteWorkout = async (id: string) => {
        if (await showConfirm("Eliminare definitivamente questo allenamento dallo storico?")) {
            try {
                await saveUserData(prev => {
                    if (!prev) return prev;
                    const updatedHistory = (prev.history || []).filter((w: any) => w.id !== id);
                    return { ...prev, history: updatedHistory };
                });
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
