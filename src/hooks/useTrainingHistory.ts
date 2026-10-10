import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import type { WorkoutSession, Exercise } from '../types';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { isHistorySavePending, restoreSessionAfterHistoryEdit } from './workout/historyEditorContext';

const EMPTY_HISTORY: WorkoutSession[] = [];
const EMPTY_LIBRARY: Exercise[] = [];

export function useTrainingHistory() {
    const history = useAppStore(state => state.userData?.history || EMPTY_HISTORY);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);

    const deleteWorkout = async (id: string) => {
        const session = captureSession();
        if (isHistorySavePending(session.owner)) return;
        if (!(await showConfirm("Eliminare definitivamente questo allenamento dallo storico?"))) return;
        if (!isCurrentSession(session) || isHistorySavePending(session.owner)) return;
        try {
            const result = await dispatchDomainOperation({ type: 'history.delete', id });
            if (!result.ok && result.status !== 'local-pending') throw new Error('Cancellazione non confermata');
            if (!isCurrentSession(session)) return;
            const editor = useAppStore.getState().localWorkout;
            if (editor?.isEditingHistory && (editor.originalHistoryId || editor.id) === id) {
                await restoreSessionAfterHistoryEdit(String(editor.id));
            } else if (editor?.id === id) {
                // Legacy matching device snapshot: retain the existing deletion
                // contract without discarding a separate suspended live workout.
                useAppStore.getState().setLocalWorkout(null);
            }
        } catch (error) {
            console.error('Eliminazione storico non completata:', error);
            await showAlert("Errore durante l'eliminazione dell'allenamento.");
        }
    };

    return {
        userData: { history, library },
        history,
        library,
        deleteWorkout
    };
}
