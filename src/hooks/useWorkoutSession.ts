import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { resetGlobalWorkoutTimer } from '../lib/utils/timer';
import { useWorkoutSetMutations } from './workout/useWorkoutSetMutations';
import { useWorkoutStart } from './workout/useWorkoutStart';
import { useWorkoutHistoryEditor } from './workout/useWorkoutHistoryEditor';
import {
    applyWorkoutCompletionDraft,
    prepareCompletedWorkout,
    type WorkoutCompletionDraft,
} from './workout/workoutSessionPreparation';
import type { WorkoutSession, WorkoutRoutine, Exercise } from '../types';
import { auth } from '../lib/firebase';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { writeDeviceValue } from '../lib/sync/deviceStorage';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { isWorkoutClockAnomalyError, resetWorkoutClockGuard } from '../lib/workoutClockGuard';

const EMPTY_ROUTINES: WorkoutRoutine[] = [];
const EMPTY_LIBRARY: Exercise[] = [];
const EMPTY_HISTORY: WorkoutSession[] = [];
export function useWorkoutSession() {
    const routines = useAppStore(state => state.userData?.routines || EMPTY_ROUTINES);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const history = useAppStore(state => state.userData?.history || EMPTY_HISTORY);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const localWorkout = useAppStore(state => state.localWorkout);
    const setLocalWorkout = useAppStore(state => state.setLocalWorkout);
    const setSyncedLocalWorkout = useAppStore(state => state.setSyncedLocalWorkout);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

    const activeWorkout = localWorkout;

    const endingRef = useRef(false);

    const mutateActiveWorkout = useCallback((
        workoutOrUpdater: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)
    ) => {
        const current = useAppStore.getState().localWorkout;
        if (current?.isEditingHistory) {
            setLocalWorkout(workoutOrUpdater);
            return;
        }
        // Input-level mutations remain non-blocking, but device-critical failures
        // are converted by the workout slice into a persistent fail-closed UI state.
        void setSyncedLocalWorkout(workoutOrUpdater).catch(error => {
            console.error('Mutazione workout non persistita sul dispositivo:', error);
        });
    }, [setLocalWorkout, setSyncedLocalWorkout]);
    
    // Rating states derivati direttamente da activeWorkout per prevenire perdita di dati
    const mood = activeWorkout?.moodRating !== undefined && activeWorkout.moodRating !== null ? activeWorkout.moodRating.toString() : '';
    const pump = activeWorkout?.pumpRating !== undefined && activeWorkout.pumpRating !== null ? activeWorkout.pumpRating.toString() : '';
    const fatigue = activeWorkout?.fatigueRating !== undefined && activeWorkout.fatigueRating !== null ? activeWorkout.fatigueRating.toString() : '';
    const water = activeWorkout?.waterLiters !== undefined && activeWorkout.waterLiters !== null ? activeWorkout.waterLiters.toString() : '';
    const manualDuration = activeWorkout ? Logic.normalizeDuration(activeWorkout.manualDurationStr || activeWorkout.globalDurationStr || '00:00:00') : '00:00:00';
    const pains = (activeWorkout?.pains && Array.isArray(activeWorkout.pains)) ? activeWorkout.pains : [];

    const setMood = useCallback((val: string) => {
        mutateActiveWorkout(prev => prev ? { ...prev, moodRating: val as any } : null);
    }, [mutateActiveWorkout]);

    const setPump = useCallback((val: string) => {
        mutateActiveWorkout(prev => prev ? { ...prev, pumpRating: val as any } : null);
    }, [mutateActiveWorkout]);

    const setFatigue = useCallback((val: string) => {
        mutateActiveWorkout(prev => prev ? { ...prev, fatigueRating: val as any } : null);
    }, [mutateActiveWorkout]);

    const setWater = useCallback((val: string) => {
        mutateActiveWorkout(prev => prev ? { ...prev, waterLiters: val as any } : null);
    }, [mutateActiveWorkout]);

    const setManualDuration = useCallback((val: string) => {
        mutateActiveWorkout(prev => prev ? { ...prev, manualDurationStr: val } : null);
    }, [mutateActiveWorkout]);

    const setPains = useCallback((newPains: string[]) => {
        mutateActiveWorkout(prev => prev ? { ...prev, pains: newPains } : null);
    }, [mutateActiveWorkout]);

    const togglePain = useCallback((muscleId: string) => {
        if (!muscleId || typeof muscleId !== 'string') return;
        mutateActiveWorkout(prev => {
            if (!prev) return null;
            const currentPains = Array.isArray(prev.pains) ? prev.pains : [];
            const nextPains = currentPains.includes(muscleId)
                ? currentPains.filter(p => p !== muscleId)
                : [...currentPains, muscleId];
            return { ...prev, pains: nextPains };
        });
    }, [mutateActiveWorkout]);

    // Sub-hook per la manipolazione granulare delle serie ed esercizi
    const {
        addExtraExercise,
        addSpecialSet,
        reorderExercises,
        moveExercise,
        removeActiveExercise,
        addSet,
        removeSet,
        removeLastSet,
        updateSet,
        updateSpecialSet,
        removeSpecialSet,
        updateSetTarget,
        updateSessionNote,
        updateTechnicalStandard
    } = useWorkoutSetMutations({ setLocalWorkout: mutateActiveWorkout, showConfirm });

    const { selectedRoutine, setSelectedRoutine, startWorkout, startFreeWorkout, confirmWorkoutStart } = useWorkoutStart({
        mutateActiveWorkout, setSyncedLocalWorkout, showAlert,
    });

    const { historySaving, startEditHistoricalWorkout, saveHistoryEdit, cancelHistoryEdit } = useWorkoutHistoryEditor({
        setLocalWorkout, dispatchDomainOperation, showAlert, showConfirm,
    });

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

    const updateSetupNote = useCallback(async (exId: string, note: string) => {
        try {
            const exercise = useAppStore.getState().userData?.library?.find(item => item.id === exId);
            if (!exercise) throw new Error('Esercizio non trovato');
            const result = await dispatchDomainOperation({ type: 'exercise.upsert', exercise: { ...exercise, notes: note } });
            if (!result.ok && result.status !== 'local-pending') throw result.error instanceof Error ? result.error : new Error('Nota non salvata');
        } catch {
            void showAlert("Errore durante il salvataggio della nota.");
        }
    }, [dispatchDomainOperation, showAlert]);

    return {
        activeWorkout,
        historySaving,
        routines,
        library,
        history,
        selectedRoutine,
        setSelectedRoutine,
        mood, setMood,
        pump, setPump,
        fatigue, setFatigue,
        water, setWater,
        manualDuration, setManualDuration,
        pains, setPains, togglePain,
        startWorkout,
        startFreeWorkout,
        confirmWorkoutStart,
        endWorkout,
        deleteWorkout,
        startEditHistoricalWorkout,
        saveHistoryEdit,
        cancelHistoryEdit,
        addExtraExercise,
        reorderExercises,
        moveExercise,
        removeActiveExercise,
        addSet,
        removeSet,
        removeLastSet,
        updateSet,
        addSpecialSet,
        updateSpecialSet,
        removeSpecialSet,
        updateSetTarget,
        updateSessionNote,
        updateTechnicalStandard,
        updateSetupNote
    };
}
