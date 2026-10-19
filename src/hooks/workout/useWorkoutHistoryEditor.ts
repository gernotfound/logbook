import { useCallback, useState } from 'react';
import { Logic } from '../../lib/logic';
import { readLocal } from '../../lib/sync/localRepository';
import { readDeviceValueStrict, writeDeviceValue } from '../../lib/sync/deviceStorage';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { readDeviceConsentRevision, readWorkoutDeviceIntent, recoverWorkoutDeviceIntent } from '../../lib/sync/workoutDeviceIntent';
import type { WorkoutSession } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { assertHistoryEditorContextEpoch, claimHistorySave, HISTORY_EDITOR_CONTEXT, isHistorySavePending, releaseHistorySave, restoreSessionAfterHistoryEdit } from './historyEditorContext';
import { prepareHistoricalWorkoutForEditing, prepareHistoricalWorkoutForSave } from './workoutSessionPreparation';

type EditorDependencies = {
    setLocalWorkout: ReturnType<typeof useAppStore.getState>['setLocalWorkout'];
    dispatchDomainOperation: ReturnType<typeof useAppStore.getState>['dispatchDomainOperation'];
    showAlert: ReturnType<typeof useDialogStore.getState>['showAlert'];
    showConfirm: ReturnType<typeof useDialogStore.getState>['showConfirm'];
};

// Keep the owner-scoped save guard and suspended device session in one
// lifecycle boundary, even when multiple UI surfaces mount this hook.
export function useWorkoutHistoryEditor({
    setLocalWorkout, dispatchDomainOperation, showAlert, showConfirm,
}: EditorDependencies) {
    const [historySaving, setHistorySaving] = useState(false);

    const startEditHistoricalWorkout = useCallback(async (workout: WorkoutSession) => {
        const state = useAppStore.getState();
        const currentLocal = state.localWorkout;
        const session = captureSession();
        if (isHistorySavePending(session.owner)) return false;
        if (currentLocal?.isEditingHistory) {
            await showAlert('Termina prima la modifica dello storico già aperta.');
            return false;
        }
        const suspended = currentLocal ?? state.userData?.activeWorkout ?? null;
        if (suspended) {
            const ok = await showConfirm("Hai già una sessione in corso. Vuoi modificare lo storico mantenendo la sessione attiva? Potrai riprenderla quando esci dall'editor.");
            if (!ok) return false;
        }
        const latest = useAppStore.getState();
        if (!isCurrentSession(session) || latest.localWorkout !== currentLocal
            || latest.userData?.activeWorkout !== state.userData?.activeWorkout
            || isHistorySavePending(session.owner)) return false;
        const selectedHistory = state.userData?.history?.find(item => item.id === workout.id);
        if (!selectedHistory || latest.userData?.history?.find(item => item.id === workout.id) !== selectedHistory) return false;

        const editingWorkout = prepareHistoricalWorkoutForEditing(workout);
        try {
            // The history editor temporarily takes over the same device workout
            // key. First durably journal any outstanding authenticated intent;
            // otherwise opening the editor would erase its only recovery proof.
            if (session.owner.startsWith('user:') && readWorkoutDeviceIntent(session.owner)) {
                await recoverWorkoutDeviceIntent(session.owner, () => isCurrentSession(session));
                if (!isCurrentSession(session)) return false;
                const afterRecovery = await readLocal(session.owner);
                const latestIntent = readWorkoutDeviceIntent(session.owner);
                if (!afterRecovery || !latestIntent
                    || afterRecovery.lastWorkoutDeviceIntent?.generation !== latestIntent.generation
                    || afterRecovery.lastWorkoutDeviceIntent.sequence < latestIntent.sequence) {
                    throw new Error('Recupero sessione corrente non ancora durevole.');
                }
            }
            // Preserve the device's authoritative session (including unsynced sets)
            // before replacing the visible snapshot with a history editor.
            const previousContext = readDeviceValueStrict(HISTORY_EDITOR_CONTEXT, session.owner);
            // An abandoned editor context can outlive a consent withdrawal.
            // Never replace an unproven suspended session with a current-epoch one.
            assertHistoryEditorContextEpoch(previousContext, session.owner);
            const sourceRevision = readDeviceConsentRevision(session.owner);
            const nextContext = JSON.stringify({
                version: 1,
                editorId: editingWorkout.id,
                ...(sourceRevision !== undefined ? { consentRevision: sourceRevision } : {}),
                suspended,
            });
            writeDeviceValue(HISTORY_EDITOR_CONTEXT, nextContext, session.owner);
            try {
                setLocalWorkout(editingWorkout);
            } catch (error) {
                // Context and device workout are separate Web Storage keys.
                // Roll back only our own context; do not discard a newer tab's copy.
                if (isCurrentSession(session)
                    && readDeviceValueStrict(HISTORY_EDITOR_CONTEXT, session.owner) === nextContext) {
                    writeDeviceValue(HISTORY_EDITOR_CONTEXT, previousContext, session.owner);
                }
                throw error;
            }
            // The live timer belongs to the suspended session, not to the editor.
            return true;
        } catch (error) {
            await showAlert('Impossibile aprire lo storico: il dispositivo non ha salvato il contesto della sessione attiva.');
            console.error('Apertura editor storico non durevole:', error);
            return false;
        }
    }, [showConfirm, showAlert, setLocalWorkout]);

    const saveHistoryEdit = useCallback(async () => {
        const session = captureSession();
        if (!claimHistorySave(session.owner)) return false;
        setHistorySaving(true);
        try {
            const editor = useAppStore.getState().localWorkout;
            if (!editor?.isEditingHistory) return false;
            const targetId = editor.originalHistoryId || editor.id;
            if (!targetId) return false;
            const snapshot = JSON.stringify(editor);
            const updatedWorkout = prepareHistoricalWorkoutForSave(
                editor, targetId,
                {
                    mood: editor.moodRating == null ? '' : String(editor.moodRating),
                    pump: editor.pumpRating == null ? '' : String(editor.pumpRating),
                    fatigue: editor.fatigueRating == null ? '' : String(editor.fatigueRating),
                },
                editor.waterLiters == null ? '' : String(editor.waterLiters),
                Logic.normalizeDuration(editor.manualDurationStr || editor.globalDurationStr || '00:00:00'),
            );
            if (!isCurrentSession(session) || !useAppStore.getState().userData) return false;
            const result = await dispatchDomainOperation({ type: 'history.upsert', workout: updatedWorkout });
            if (!result.ok && result.status !== 'local-pending') {
                await showAlert('Errore durante il salvataggio delle modifiche.');
                return false;
            }
            if (!isCurrentSession(session)) return false;
            const latest = useAppStore.getState().localWorkout;
            if (!latest?.isEditingHistory || latest.id !== editor.id) return false;
            if (JSON.stringify(latest) !== snapshot) {
                await showAlert('Una versione dello storico è stata salvata, ma ci sono altre modifiche da salvare.');
                return false;
            }
            await restoreSessionAfterHistoryEdit(String(editor.id));
            return true;
        } catch (error) {
            console.error('Salvataggio editor storico non completato:', error);
            if (isCurrentSession(session)) {
                await showAlert('Impossibile completare il salvataggio dello storico. La modifica resta disponibile.');
            }
            return false;
        } finally {
            releaseHistorySave(session.owner);
            setHistorySaving(false);
        }
    }, [dispatchDomainOperation, showAlert]);

    const cancelHistoryEdit = useCallback(async () => {
        const session = captureSession();
        if (isHistorySavePending(session.owner)) return false;
        const editor = useAppStore.getState().localWorkout;
        if (!editor?.isEditingHistory) return false;
        if (!(await showConfirm("Annullare le modifiche a questo allenamento?"))) return false;
        if (!isCurrentSession(session) || isHistorySavePending(session.owner)
            || useAppStore.getState().localWorkout !== editor) return false;
        try {
            await restoreSessionAfterHistoryEdit(String(editor.id));
            return true;
        } catch (error) {
            console.error('Ripristino sessione sospesa fallito:', error);
            await showAlert('Impossibile recuperare la sessione sospesa. Le modifiche restano disponibili.');
            return false;
        }
    }, [showConfirm, showAlert]);

    return { historySaving, startEditHistoricalWorkout, saveHistoryEdit, cancelHistoryEdit };
}
