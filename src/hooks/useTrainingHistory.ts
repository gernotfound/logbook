
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';

export function useTrainingHistory() {
    const { userData, saveUserData } = useAppStore();
    const { showConfirm } = useDialogStore();
    
    const history = userData?.history || [];

    const deleteWorkout = async (id: string) => {
        if (!userData) return;
        if (await showConfirm("Eliminare definitivamente questo allenamento dallo storico?")) {
            const updatedHistory = (userData.history || []).filter((w: any) => w.id !== id);
            saveUserData({ ...userData, history: updatedHistory });
        }
    };

    return {
        userData, history, deleteWorkout
    };
}
