import { useState, useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { resetGlobalWorkoutTimer } from '../lib/utils/timer';
import { useWorkoutSetMutations } from './workout/useWorkoutSetMutations';
import {
    applyWorkoutCompletionDraft,
    buildFreeWorkout,
    buildRoutineWorkout,
    prepareCompletedWorkout,
    prepareHistoricalWorkoutForEditing,
    prepareHistoricalWorkoutForSave,
    type WorkoutCompletionDraft,
} from './workout/workoutSessionPreparation';
import type { WorkoutSession, WorkoutRoutine, Exercise, WorkoutReadiness } from '../types';
import { auth } from '../lib/firebase';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { readDeviceValueStrict, writeDeviceValue } from '../lib/sync/deviceStorage';
import { captureSession } from '../lib/sync/session';
import { DomainParsers } from '../lib/schema';
import { isWorkoutClockAnomalyError, resetWorkoutClockGuard } from '../lib/workoutClockGuard';

const EMPTY_ROUTINES: WorkoutRoutine[] = [];
const EMPTY_LIBRARY: Exercise[] = [];
const EMPTY_HISTORY: WorkoutSession[] = [];
const HISTORY_EDITOR_CONTEXT = 'history-editor-context';

function readSuspendedWorkout(editorId: string): WorkoutSession | null {
    const raw = readDeviceValueStrict(HISTORY_EDITOR_CONTEXT);
    if (raw === null) {
        // An editor already open before this release has no dedicated context.
        return useAppStore.getState().userData?.activeWorkout ?? null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('Contesto editor storico non valido.');
    const saved = parsed as { version?: unknown; editorId?: unknown; suspended?: unknown };
    if (saved.version !== 1 || saved.editorId !== editorId) throw new Error('Contesto editor storico non corrispondente.');
    if (saved.suspended === null) return null;
    const previous = DomainParsers.parseActiveWorkout(saved.suspended);
    if (!previous || previous.isEditingHistory) throw new Error('Sessione sospesa non valida.');
    return previous as WorkoutSession;
}

function restoreSessionAfterHistoryEdit(editorId: string, setLocalWorkout: (workout: WorkoutSession | null) => void): void {
    const previous = readSuspendedWorkout(editorId);
    // Recover the active workout before clearing the owner-scoped editor marker.
    setLocalWorkout(previous);
    try {
        writeDeviceValue(HISTORY_EDITOR_CONTEXT, null);
    } catch (error) {
        // An orphaned marker cannot affect the restored active workout; the next
        // history edit overwrites it with a newly scoped context.
        console.warn('Sessione ripristinata; impossibile pulire il contesto storico:', error);
    }
}

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

    const [selectedRoutine, setSelectedRoutine] = useState('');
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

    const startWorkout = useCallback(async (routineIdToStart?: string, cycleInfo?: { cycleId?: string; cycleName?: string }) => {
        const currentLocal = useAppStore.getState().localWorkout;
        const targetId = (typeof routineIdToStart === 'string' && routineIdToStart) ? routineIdToStart : selectedRoutine;
        if (!targetId) {
            await showAlert("Seleziona una scheda per iniziare!");
            return;
        }
        if (currentLocal) {
            await showAlert("Hai già un allenamento in corso!");
            return;
        }

        const userData = useAppStore.getState().userData;
        const currentRoutines = userData?.routines || [];
        const routine = currentRoutines.find(r => r.id === targetId);
        if (!routine) {
            await showAlert("Scheda non trovata.");
            return;
        }
        
        const newActiveWorkout = buildRoutineWorkout(userData, routine, cycleInfo);
        mutateActiveWorkout(newActiveWorkout);
    }, [selectedRoutine, showAlert, mutateActiveWorkout]);

    const startFreeWorkout = useCallback(async () => {
        const currentLocal = useAppStore.getState().localWorkout;
        if (currentLocal) {
            await showAlert("Hai già un allenamento in corso!");
            return;
        }

        const newActiveWorkout = buildFreeWorkout();
        mutateActiveWorkout(newActiveWorkout);
    }, [showAlert, mutateActiveWorkout]);

    const confirmWorkoutStart = useCallback(async (readiness?: Omit<WorkoutReadiness, 'capturedAt'>) => {
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout || currentWorkout.isEditingHistory) return false;
        if (currentWorkout.globalStartTime) return true;

        const startedAt = Date.now();
        const hasReadiness = readiness && Object.values(readiness).some(value => value !== undefined);
        const startedWorkout: WorkoutSession = {
            ...currentWorkout,
            date: Logic.getLocalDateString(startedAt),
            globalStartTime: startedAt,
            ...(hasReadiness ? { readiness: { capturedAt: startedAt, ...readiness } } : {}),
        };

        if (!resetGlobalWorkoutTimer()) {
            useAppStore.setState({
                localPersistenceBlocked: true,
                syncHealth: 'failed',
                syncPresentation: 'normal',
                saveError: 'Impossibile inizializzare il timer sul dispositivo. La sessione non verrà avviata.',
            });
            await showAlert('Impossibile iniziare la sessione: il timer locale non può essere salvato sul dispositivo.');
            return false;
        }
        try {
            const result = await setSyncedLocalWorkout(startedWorkout);
            return result.ok;
        } catch {
            await showAlert('Impossibile iniziare la sessione: i dati non sono stati salvati.');
            return false;
        }
    }, [setSyncedLocalWorkout, showAlert]);

    const startEditHistoricalWorkout = useCallback(async (workout: WorkoutSession) => {
        const state = useAppStore.getState();
        const currentLocal = state.localWorkout;
        if (currentLocal?.isEditingHistory) {
            await showAlert('Termina prima la modifica dello storico già aperta.');
            return false;
        }
        const suspended = currentLocal ?? state.userData?.activeWorkout ?? null;
        if (suspended) {
            const ok = await showConfirm("Hai già una sessione in corso. Vuoi modificare lo storico mantenendo la sessione attiva? Potrai riprenderla quando esci dall'editor.");
            if (!ok) return false;
        }

        const editingWorkout = prepareHistoricalWorkoutForEditing(workout);
        try {
            // Preserve the device's authoritative session (including unsynced sets)
            // before replacing the visible snapshot with a history editor.
            writeDeviceValue(HISTORY_EDITOR_CONTEXT, JSON.stringify({
                version: 1,
                editorId: editingWorkout.id,
                suspended,
            }), captureSession().owner);
            setLocalWorkout(editingWorkout);
            // The live timer belongs to the suspended session, not to the editor.
            return true;
        } catch (error) {
            await showAlert('Impossibile aprire lo storico: il dispositivo non ha salvato il contesto della sessione attiva.');
            console.error('Apertura editor storico non durevole:', error);
            return false;
        }
    }, [showConfirm, showAlert, setLocalWorkout]);

    const saveHistoryEdit = useCallback(async () => {
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout) return false;
        const targetId = currentWorkout.originalHistoryId || currentWorkout.id;
        if (!targetId) return false;

        const updatedWorkout = prepareHistoricalWorkoutForSave(
            currentWorkout,
            targetId,
            { mood, pump, fatigue },
            water,
            manualDuration,
        );

        try {
            const currentData = useAppStore.getState().userData;
            if (!currentData) throw new Error('Dati utente non caricati');
            const result = await dispatchDomainOperation({ type: 'history.upsert', workout: updatedWorkout });
            if (!result.ok && result.status !== 'local-pending') {
                await showAlert('Errore durante il salvataggio delle modifiche.');
                return false;
            }
            restoreSessionAfterHistoryEdit(String(currentWorkout.id), setLocalWorkout);
            return true;
        } catch (error) {
            console.error('Salvataggio editor storico non completato:', error);
            await showAlert('Impossibile completare il salvataggio dello storico. La modifica resta disponibile per il recupero.');
            return false;
        }
    }, [mood, pump, fatigue, water, manualDuration, dispatchDomainOperation, setLocalWorkout, showAlert]);

    const cancelHistoryEdit = useCallback(async () => {
        if (await showConfirm("Annullare le modifiche a questo allenamento?")) {
            const editor = useAppStore.getState().localWorkout;
            if (!editor?.isEditingHistory) return false;
            try {
                restoreSessionAfterHistoryEdit(String(editor.id), setLocalWorkout);
                return true;
            } catch (error) {
                console.error('Ripristino sessione sospesa fallito:', error);
                await showAlert('Impossibile recuperare la sessione sospesa. Le modifiche restano disponibili.');
                return false;
            }
        }
        return false;
    }, [showConfirm, showAlert, setLocalWorkout]);

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
        } catch (error) {
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
                await showAlert('Allenamento salvato nello storico, ma non è stato possibile rimuovere la copia temporanea. Riapri TheLogBook per recuperare lo stato aggiornato.');
                return null;
            }
            if (!resetGlobalWorkoutTimer()) {
                useAppStore.setState({ localPersistenceBlocked: true, syncHealth: 'failed',
                    saveError: 'Allenamento completato; impossibile azzerare il timer locale.' });
            }
            resetWorkoutClockGuard(expectedId);
            return finishedWorkout;
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
        if (!(await showConfirm("Sei sicuro di voler eliminare questa sessione in corso? Non verrà salvata."))) return false;
        const deletedWorkoutId = useAppStore.getState().localWorkout?.id;
        try {
            if (!deletedWorkoutId) return false;
            const result = await dispatchDomainOperation({ type: 'active-workout.set', workout: null, deletedWorkoutId: String(deletedWorkoutId) });
            if (!result.ok && result.status !== 'local-pending') return false;
            try {
                setLocalWorkout(null);
            } catch (error) {
                console.error('Workout eliminato ma cleanup device-local non riuscito:', error);
                await showAlert('Sessione eliminata dall’archivio locale, ma la copia temporanea non è stata rimossa. Riapri TheLogBook per completare il recupero.');
                return false;
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
            await dispatchDomainOperation({ type: 'exercise.upsert', exercise: { ...exercise, notes: note } });
        } catch {
            showAlert("Errore durante il salvataggio della nota.");
        }
    }, [dispatchDomainOperation, showAlert]);

    return {
        activeWorkout,
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
