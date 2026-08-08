import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { resetGlobalWorkoutTimer } from '../components/Training/WorkoutTimer';
import { useWorkoutSetMutations } from './workout/useWorkoutSetMutations';
import type { WorkoutSession } from '../types';

export function useWorkoutSession() {
    const userData = useAppStore(state => state.userData);
    const saveUserData = useAppStore(state => state.saveUserData);
    const localWorkout = useAppStore(state => state.localWorkout);
    const setLocalWorkout = useAppStore(state => state.setLocalWorkout);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

    const activeWorkout = localWorkout;
    const routines = userData?.routines || [];
    const library = userData?.library || [];
    const history = userData?.history || [];

    const [selectedRoutine, setSelectedRoutine] = useState('');
    
    // Rating states
    const [mood, setMood] = useState('');
    const [pump, setPump] = useState('');
    const [fatigue, setFatigue] = useState('');
    const [water, setWater] = useState('');
    const [manualDuration, setManualDuration] = useState('00:00:00');

    // Sincronizza i campi quando activeWorkout cambia (es. caricamento o avvio)
    useEffect(() => {
        if (activeWorkout) {
            setMood(activeWorkout.moodRating !== undefined && activeWorkout.moodRating !== null ? activeWorkout.moodRating.toString() : '');
            setPump(activeWorkout.pumpRating !== undefined && activeWorkout.pumpRating !== null ? activeWorkout.pumpRating.toString() : '');
            setFatigue(activeWorkout.fatigueRating !== undefined && activeWorkout.fatigueRating !== null ? activeWorkout.fatigueRating.toString() : '');
            setWater(activeWorkout.waterLiters !== undefined && activeWorkout.waterLiters !== null ? activeWorkout.waterLiters.toString() : '');
            setManualDuration(Logic.normalizeDuration(activeWorkout.manualDurationStr || activeWorkout.globalDurationStr || '00:00:00'));
        } else {
            setMood('');
            setPump('');
            setFatigue('');
            setWater('');
            setManualDuration('00:00:00');
        }
    }, [activeWorkout?.id, activeWorkout?.originalHistoryId, activeWorkout?.isEditingHistory]);

    // Sub-hook per la manipolazione granulare delle serie ed esercizi
    const {
        addExtraExercise,
        addSpecialSet,
        reorderExercises,
        removeActiveExercise,
        addSet,
        removeSet,
        updateSet,
        updateSpecialSet,
        removeSpecialSet,
        updateSessionNote
    } = useWorkoutSetMutations({ setLocalWorkout, showConfirm });

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
        
        resetGlobalWorkoutTimer();

        const activeCycleId = userData?.activeCycleId;
        const activeCycle = activeCycleId ? (userData?.trainingCycles || []).find(c => c.id === activeCycleId) : null;
        const belongsToActiveCycle = activeCycle && (activeCycle.routines || []).some(r => r.routineId === routine.id);

        const assignedCycleId = cycleInfo?.cycleId || (belongsToActiveCycle ? activeCycle.id : undefined);
        const assignedCycleName = cycleInfo?.cycleName || (belongsToActiveCycle ? activeCycle.name : undefined);

        const newActiveWorkout: WorkoutSession = {
            id: Logic.generateId('w'),
            routineId: routine.id,
            routineName: routine.name,
            cycleId: assignedCycleId,
            cycleName: assignedCycleName,
            date: Logic.getLocalDateString(),
            globalStartTime: new Date().getTime(),
            exercises: (routine.exercises || []).map((ex: any) => {
                const setsCount = ex.setsCount || 3;
                const sets = [];
                for (let i = 0; i < setsCount; i++) {
                    const setObj: any = { id: Logic.generateId('s'), kg: '', reps: '' };
                    if (ex.defaultTechnique === 'dropset') {
                        setObj.dropsets = [{ id: Logic.generateId('ds'), kg: '', reps: '' }];
                    } else if (ex.defaultTechnique === 'isometrics') {
                        setObj.isometrics = [{ id: Logic.generateId('iso'), kg: '', time: '' }];
                    }
                    sets.push(setObj);
                }
                const result: any = { exId: ex.exId, sets, sessionNote: '' };
                if (ex.defaultTechnique) result.defaultTechnique = ex.defaultTechnique;
                if (ex.minReps) result.minReps = ex.minReps;
                if (ex.maxReps) result.maxReps = ex.maxReps;
                return result;
            })
        };

        setLocalWorkout(newActiveWorkout);
    }, [selectedRoutine, showAlert, setLocalWorkout]);

    const startEditHistoricalWorkout = useCallback(async (workout: WorkoutSession) => {
        const currentLocal = useAppStore.getState().localWorkout;
        if (currentLocal && !currentLocal.isEditingHistory) {
            const ok = await showConfirm("Hai già una sessione attiva in corso. Vuoi sostituirla per modificare questo allenamento passato?");
            if (!ok) return false;
        }

        resetGlobalWorkoutTimer();

        let durationStr = workout.globalDurationStr || workout.manualDurationStr;
        if (!durationStr && workout.globalStartTime && workout.globalEndTime) {
            const diff = Math.max(0, Math.floor((workout.globalEndTime - workout.globalStartTime) / 1000));
            durationStr = Logic.formatDuration(diff);
        } else {
            durationStr = Logic.normalizeDuration(durationStr);
        }

        const sanitizedExercises = (workout.exercises || []).map((ex: any) => ({
            ...ex,
            sets: (ex.sets || []).map((s: any) => ({
                ...s,
                id: s.id || Logic.generateId('s'),
                kg: s.kg !== undefined && s.kg !== null ? String(s.kg) : '',
                reps: s.reps !== undefined && s.reps !== null ? String(s.reps) : '',
                time: s.time !== undefined && s.time !== null ? String(s.time) : '',
                dropsets: (s.dropsets || []).map((ds: any) => ({
                    ...ds,
                    id: ds.id || Logic.generateId('ds'),
                    kg: ds.kg !== undefined && ds.kg !== null ? String(ds.kg) : '',
                    reps: ds.reps !== undefined && ds.reps !== null ? String(ds.reps) : ''
                })),
                isometrics: (s.isometrics || []).map((iso: any) => ({
                    ...iso,
                    id: iso.id || Logic.generateId('iso'),
                    kg: iso.kg !== undefined && iso.kg !== null ? String(iso.kg) : '',
                    time: iso.time !== undefined && iso.time !== null ? String(iso.time) : ''
                }))
            }))
        }));

        const editingWorkout: WorkoutSession = {
            ...workout,
            exercises: sanitizedExercises,
            isEditingHistory: true,
            originalHistoryId: workout.id,
            manualDurationStr: durationStr
        };

        setLocalWorkout(editingWorkout);
        setMood(workout.moodRating !== undefined && workout.moodRating !== null ? workout.moodRating.toString() : '');
        setPump(workout.pumpRating !== undefined && workout.pumpRating !== null ? workout.pumpRating.toString() : '');
        setFatigue(workout.fatigueRating !== undefined && workout.fatigueRating !== null ? workout.fatigueRating.toString() : '');
        setWater(workout.waterLiters !== undefined && workout.waterLiters !== null ? workout.waterLiters.toString() : '');
        setManualDuration(durationStr);
        return true;
    }, [showConfirm, setLocalWorkout]);

    const saveHistoryEdit = useCallback(async () => {
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout) return false;
        const targetId = currentWorkout.originalHistoryId || currentWorkout.id;
        if (!targetId) return false;

        const valRes = Logic.validateWorkoutRatings(
            mood ? parseInt(mood) : null,
            pump ? parseInt(pump) : null,
            fatigue ? parseInt(fatigue) : null
        );

        const durationStr = Logic.normalizeDuration(manualDuration?.trim() || currentWorkout.manualDurationStr || currentWorkout.globalDurationStr || '00:00:00');

        const updatedWorkout: WorkoutSession = {
            ...currentWorkout,
            id: targetId,
            globalDurationStr: durationStr,
            manualDurationStr: durationStr,
            moodRating: valRes.mood,
            pumpRating: valRes.pump,
            fatigueRating: valRes.fatigue,
            waterLiters: water ? parseFloat(water) : 0,
            date: currentWorkout.date || Logic.getLocalDateString()
        };

        delete updatedWorkout.isEditingHistory;
        delete updatedWorkout.originalHistoryId;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const updatedHistory = (prev.history || []).map(w => (w.id === targetId ? updatedWorkout : w));
                return { ...prev, history: updatedHistory, activeWorkout: null };
            });
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            setMood(''); setPump(''); setFatigue(''); setWater('');
            setManualDuration('00:00:00');
            await showAlert("Modifiche salvate con successo!");
            return true;
        } catch {
            showAlert("Errore durante il salvataggio delle modifiche.");
            return false;
        }
    }, [mood, pump, fatigue, water, manualDuration, saveUserData, setLocalWorkout, showAlert]);

    const cancelHistoryEdit = useCallback(async () => {
        if (await showConfirm("Annullare le modifiche a questo allenamento?")) {
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            setMood(''); setPump(''); setFatigue(''); setWater('');
            setManualDuration('00:00:00');
            return true;
        }
        return false;
    }, [showConfirm, setLocalWorkout]);

    const endWorkout = useCallback(async () => {
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout || !(await showConfirm("Terminare l'allenamento?"))) return;

        const valRes = Logic.validateWorkoutRatings(
            mood ? parseInt(mood) : null,
            pump ? parseInt(pump) : null,
            fatigue ? parseInt(fatigue) : null
        );

        const endTime = new Date().getTime();
        const startTime = currentWorkout.globalStartTime || endTime;
        const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
        const durationStr = Logic.formatDuration(diff);

        const finishedWorkout: WorkoutSession = {
            ...currentWorkout,
            globalEndTime: endTime,
            globalDurationStr: durationStr,
            moodRating: valRes.mood,
            pumpRating: valRes.pump,
            fatigueRating: valRes.fatigue,
            waterLiters: water ? parseFloat(water) : 0,
            date: currentWorkout.date || Logic.getLocalDateString()
        };

        delete finishedWorkout.isEditingHistory;
        delete finishedWorkout.originalHistoryId;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                return { ...prev, history: [finishedWorkout, ...(prev.history || [])], activeWorkout: null };
            });
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            setMood(''); setPump(''); setFatigue(''); setWater('');
        } catch {
            showAlert("Errore durante il salvataggio della sessione.");
        }
    }, [mood, pump, fatigue, water, showConfirm, saveUserData, setLocalWorkout, showAlert]);

    const deleteWorkout = useCallback(async () => {
        if (!(await showConfirm("Sei sicuro di voler eliminare questa sessione in corso? Non verrà salvata."))) return;
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                return { ...prev, activeWorkout: null };
            });
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            setMood(''); setPump(''); setFatigue(''); setWater('');
        } catch {
            showAlert("Errore durante l'eliminazione della sessione.");
        }
    }, [showConfirm, saveUserData, setLocalWorkout, showAlert]);

    const updateSetupNote = useCallback(async (exId: string, note: string) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const updatedLibrary = (prev.library || []).map((l: any) => l.id === exId ? { ...l, notes: note } : l);
                return { ...prev, library: updatedLibrary };
            });
        } catch {
            showAlert("Errore durante il salvataggio della nota.");
        }
    }, [saveUserData, showAlert]);

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
        startWorkout,
        endWorkout,
        deleteWorkout,
        startEditHistoricalWorkout,
        saveHistoryEdit,
        cancelHistoryEdit,
        addExtraExercise,
        reorderExercises,
        removeActiveExercise,
        addSet,
        removeSet,
        updateSet,
        addSpecialSet,
        updateSpecialSet,
        removeSpecialSet,
        updateSessionNote,
        updateSetupNote
    };
}
