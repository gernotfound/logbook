import { useState, useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { resetGlobalWorkoutTimer } from '../lib/utils/timer';
import { useWorkoutSetMutations } from './workout/useWorkoutSetMutations';
import {
    buildFreeWorkout,
    buildRoutineWorkout,
    prepareCompletedWorkout,
    prepareHistoricalWorkoutForEditing,
    prepareHistoricalWorkoutForSave,
} from './workout/workoutSessionPreparation';
import { mapFirebaseErrorCode } from '../lib/errorHandler';
import type { WorkoutSession, WorkoutRoutine, Exercise, WorkoutReadiness } from '../types';
import { auth } from '../lib/firebase';
import { draftRegistry } from '../lib/utils/draftRegistry';

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
        // Input-level mutations remain non-blocking; syncHealth/saveError surface failures.
        void setSyncedLocalWorkout(workoutOrUpdater).catch(() => {});
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
        updateSessionNote
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
            globalStartTime: startedAt,
            ...(hasReadiness ? { readiness: { capturedAt: startedAt, ...readiness } } : {}),
        };

        resetGlobalWorkoutTimer();
        try {
            const result = await setSyncedLocalWorkout(startedWorkout);
            return result.ok;
        } catch {
            await showAlert('Impossibile iniziare la sessione: i dati non sono stati salvati.');
            return false;
        }
    }, [setSyncedLocalWorkout, showAlert]);

    const startEditHistoricalWorkout = useCallback(async (workout: WorkoutSession) => {
        const currentLocal = useAppStore.getState().localWorkout;
        if (currentLocal && !currentLocal.isEditingHistory) {
            const ok = await showConfirm("Hai già una sessione attiva in corso. Vuoi sostituirla per modificare questo allenamento passato?");
            if (!ok) return false;
        }

        resetGlobalWorkoutTimer();

        const editingWorkout = prepareHistoricalWorkoutForEditing(workout);
        setLocalWorkout(editingWorkout);
        return true;
    }, [showConfirm, setLocalWorkout]);

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
            const isMostRecent = Boolean(currentData.history?.length && currentData.history[0].id === targetId);
            const finalActivePains = isMostRecent
                ? Logic.autoHealPains(
                    currentData.activePains || [],
                    updatedWorkout.exercises || [],
                    currentData.library || [],
                    updatedWorkout.pains || []
                )
                : (currentData.activePains || []);
            await dispatchDomainOperation([
                { type: 'history.upsert', workout: updatedWorkout },
                { type: 'active-workout.set', workout: null },
                { type: 'active-pains.set', pains: finalActivePains },
            ]);
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            await showAlert("Modifiche salvate con successo!");
            return true;
        } catch (err: any) {
            const formatted = mapFirebaseErrorCode(err);
            if (formatted.isOfflineSafe) {
                setLocalWorkout(null);
                resetGlobalWorkoutTimer();
                await showAlert("Modifiche salvate in locale (offline).");
                return true;
            } else {
                showAlert("Errore durante il salvataggio delle modifiche.");
                return false;
            }
        }
    }, [mood, pump, fatigue, water, manualDuration, dispatchDomainOperation, setLocalWorkout, showAlert]);

    const cancelHistoryEdit = useCallback(async () => {
        if (await showConfirm("Annullare le modifiche a questo allenamento?")) {
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            return true;
        }
        return false;
    }, [showConfirm, setLocalWorkout]);

    const endWorkout = useCallback(async (confirmEnd = true): Promise<WorkoutSession | null> => {
        if (endingRef.current) return null;
        endingRef.current = true;
        const expectedUid = auth.currentUser?.uid;
        const expectedId = useAppStore.getState().localWorkout?.id;
        try {
        if (!expectedId || (confirmEnd && !(await showConfirm("Terminare l'allenamento?")))) return null;
        draftRegistry.flushAll();
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout || currentWorkout.id !== expectedId || auth.currentUser?.uid !== expectedUid) return null;

        const endTime = new Date().getTime();
        const { finishedWorkout, sessionPains } = prepareCompletedWorkout(currentWorkout, endTime);

        try {
            const currentData = useAppStore.getState().userData;
            if (!currentData) throw new Error('Dati utente non caricati');
            const finalActivePains = Logic.autoHealPains(
                currentData.activePains || [],
                finishedWorkout.exercises || [],
                currentData.library || [],
                sessionPains
            );
            await dispatchDomainOperation({
                type: 'workout.complete',
                workout: finishedWorkout,
                activePains: finalActivePains,
            });
            if (auth.currentUser?.uid !== expectedUid || useAppStore.getState().localWorkout?.id !== expectedId) return null;
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            return finishedWorkout;
        } catch {
            if (auth.currentUser?.uid === expectedUid) await showAlert("Errore durante il salvataggio della sessione.");
            return null;
        }
        } finally {
            endingRef.current = false;
        }
    }, [showConfirm, dispatchDomainOperation, setLocalWorkout, showAlert]);

    const deleteWorkout = useCallback(async () => {
        if (!(await showConfirm("Sei sicuro di voler eliminare questa sessione in corso? Non verrà salvata."))) return;
        try {
            await dispatchDomainOperation({ type: 'active-workout.set', workout: null });
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
        } catch (err: any) {
            const formatted = mapFirebaseErrorCode(err);
            if (formatted.isOfflineSafe) {
                setLocalWorkout(null);
                resetGlobalWorkoutTimer();
            } else {
                showAlert("Errore durante l'eliminazione della sessione.");
            }
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
        updateSessionNote,
        updateSetupNote
    };
}
