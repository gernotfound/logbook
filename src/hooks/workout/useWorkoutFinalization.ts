import { useCallback, useRef } from 'react';
import { Logic } from '../../lib/logic';
import { auth } from '../../lib/firebase';
import { draftRegistry } from '../../lib/utils/draftRegistry';
import { resetGlobalWorkoutTimer } from '../../lib/utils/timer';
import { writeDeviceValue } from '../../lib/sync/deviceStorage';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { isWorkoutClockAnomalyError, resetWorkoutClockGuard } from '../../lib/workoutClockGuard';
import { applyWorkoutCompletionDraft, prepareCompletedWorkout, type WorkoutCompletionDraft } from './workoutSessionPreparation';
import type { WorkoutSession } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';

type FinalizationDependencies = {
    setLocalWorkout: ReturnType<typeof useAppStore.getState>['setLocalWorkout'];
    dispatchDomainOperation: ReturnType<typeof useAppStore.getState>['dispatchDomainOperation'];
    showAlert: ReturnType<typeof useDialogStore.getState>['showAlert'];
    showConfirm: ReturnType<typeof useDialogStore.getState>['showConfirm'];
};

// Durable workout closure must precede cleanup of device snapshots, timers and drafts.
// Preserve the existing session identity guards and fail-closed recovery paths.
export function useWorkoutFinalization({
    setLocalWorkout, dispatchDomainOperation, showAlert, showConfirm,
}: FinalizationDependencies) {
    const endingRef = useRef(false);

    const endWorkout = useCallback(async (
        confirmEnd = true,
        requestedEndTime?: number,
        completionDraft?: WorkoutCompletionDraft,
    ): Promise<WorkoutSession | null> => {
        if (endingRef.current) return null;
        endingRef.current = true;
        const expectedUid = auth.currentUser?.uid;
        const expectedId = useAppStore.getState().localWorkout?.id;
        try {
        if (!expectedId || (confirmEnd && !(await showConfirm("Terminare l'allenamento?")))) return null;
        try {
            draftRegistry.flushAll({ strict: true });
        } catch {
            useAppStore.setState({
                localPersistenceBlocked: true,
                syncHealth: 'failed',
                syncPresentation: 'normal',
                saveError: 'Impossibile mettere al sicuro le ultime modifiche del workout. La sessione non verrà terminata.',
            });
            if (auth.currentUser?.uid === expectedUid) {
                await showAlert('Le ultime modifiche non sono ancora al sicuro sul dispositivo. Riprova dopo aver risolto il problema di storage.');
            }
            return null;
        }
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout || currentWorkout.id !== expectedId || auth.currentUser?.uid !== expectedUid) return null;

        const endTime = requestedEndTime ?? new Date().getTime();
        const workoutForCompletion = completionDraft
            ? applyWorkoutCompletionDraft(currentWorkout, completionDraft)
            : currentWorkout;
        const { finishedWorkout, sessionPains } = prepareCompletedWorkout(workoutForCompletion, endTime);

        try {
            const currentData = useAppStore.getState().userData;
            if (!currentData) throw new Error('Dati utente non caricati');
            const finalActivePains = Logic.mergeActivePains(
                currentData.activePains || [],
                sessionPains
            );
            const result = await dispatchDomainOperation({
                type: 'workout.complete',
                workout: finishedWorkout,
                expectedActiveWorkoutId: expectedId,
                activePains: finalActivePains,
            });
            if (!result.ok && result.status !== 'local-pending') return null;
            if (auth.currentUser?.uid !== expectedUid || useAppStore.getState().localWorkout?.id !== expectedId) return null;
            // IndexedDB already contains the completed workout. If device cleanup
            // fails, startup reconciles the stale snapshot against durable history.
            try {
                setLocalWorkout(null);
            } catch (error) {
                console.error('Workout completato ma cleanup device-local non riuscito:', error);
                // The authoritative closure is durable in IndexedDB. Keep the
                // failure barrier and retire only the in-memory obsolete workout.
                useAppStore.setState({ localWorkout: null });
                await showAlert('Allenamento salvato nello storico, ma non è stato possibile rimuovere la copia temporanea. Riapri TheLogBook per recuperare lo stato aggiornato.');
                return finishedWorkout;
            }
            if (!resetGlobalWorkoutTimer()) {
                useAppStore.setState({ localPersistenceBlocked: true, syncHealth: 'failed',
                    saveError: 'Allenamento completato; impossibile azzerare il timer locale.' });
            }
            resetWorkoutClockGuard(expectedId);
            return useAppStore.getState().userData?.history?.find(item => item.id === expectedId) ?? finishedWorkout;
        } catch (error) {
            if (auth.currentUser?.uid === expectedUid) {
                await showAlert(
                    isWorkoutClockAnomalyError(error)
                        ? 'L’orologio del dispositivo è cambiato durante l’allenamento. Correggi data e ora, riapri TheLogBook e poi termina la sessione.'
                        : 'Errore durante il salvataggio della sessione.',
                );
            }
            return null;
        }
        } finally {
            endingRef.current = false;
        }
    }, [showConfirm, dispatchDomainOperation, setLocalWorkout, showAlert]);

    const deleteWorkout = useCallback(async (): Promise<boolean> => {
        const deletedWorkoutId = useAppStore.getState().localWorkout?.id;
        try {
            if (!deletedWorkoutId) return false;
            const expectedSession = captureSession();
            if (!(await showConfirm("Sei sicuro di voler eliminare questa sessione in corso? Non verrà salvata."))) return false;
            if (!isCurrentSession(expectedSession) || useAppStore.getState().localWorkout?.id !== deletedWorkoutId) return false;
            const result = await dispatchDomainOperation({ type: 'active-workout.set', workout: null, deletedWorkoutId: String(deletedWorkoutId) });
            if (!result.ok && result.status !== 'local-pending') return false;
            if (!isCurrentSession(expectedSession) || useAppStore.getState().localWorkout?.id !== deletedWorkoutId) return false;
            try {
                setLocalWorkout(null);
            } catch (error) {
                console.error('Workout eliminato ma cleanup device-local non riuscito:', error);
                useAppStore.setState({ localWorkout: null });
                await showAlert('Sessione eliminata dall’archivio locale, ma la copia temporanea non è stata rimossa. Riapri TheLogBook per completare il recupero.');
                return true;
            }
            // This draft belongs exclusively to the deleted session, not a new
            // workout. Failed best-effort cleanup must not undo a durable deletion.
            try {
                writeDeviceValue('draft:post-session:' + deletedWorkoutId, null, expectedSession.owner);
            } catch (error) {
                console.warn('Impossibile pulire la bozza finale di una sessione eliminata:', error);
                useAppStore.getState().setSaveError('Sessione eliminata, ma una copia locale della valutazione finale non è stata rimossa.');
            }
            if (!resetGlobalWorkoutTimer()) {
                useAppStore.setState({ localPersistenceBlocked: true, syncHealth: 'failed',
                    saveError: 'Sessione eliminata; impossibile azzerare il timer locale.' });
            }
            if (deletedWorkoutId) resetWorkoutClockGuard(String(deletedWorkoutId));
            return true;
        } catch (error) {
            console.error('Eliminazione sessione non completata:', error);
            await showAlert('Errore durante l’eliminazione della sessione.');
            return false;
        }
    }, [showConfirm, dispatchDomainOperation, setLocalWorkout, showAlert]);

    return { endWorkout, deleteWorkout };
}
