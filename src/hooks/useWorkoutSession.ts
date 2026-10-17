import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { useWorkoutSetMutations } from './workout/useWorkoutSetMutations';
import { useWorkoutStart } from './workout/useWorkoutStart';
import { useWorkoutHistoryEditor } from './workout/useWorkoutHistoryEditor';
import { useWorkoutFinalization } from './workout/useWorkoutFinalization';
import type { WorkoutSession, WorkoutRoutine, Exercise } from '../types';

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

    const { endWorkout, deleteWorkout } = useWorkoutFinalization({
        setLocalWorkout, dispatchDomainOperation, showAlert, showConfirm,
    });

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
