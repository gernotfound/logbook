import { useState, useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { resetGlobalWorkoutTimer } from '../lib/utils/timer';
import { useWorkoutSetMutations } from './workout/useWorkoutSetMutations';
import { mapFirebaseErrorCode } from '../lib/errorHandler';
import { telemetryHub } from '../lib/telemetryHub';
import type { WorkoutSession, WorkoutRoutine, Exercise } from '../types';
import { auth } from '../lib/firebase';
import { draftRegistry } from '../lib/utils/draftRegistry';

const EMPTY_ROUTINES: WorkoutRoutine[] = [];
const EMPTY_LIBRARY: Exercise[] = [];
const EMPTY_HISTORY: WorkoutSession[] = [];

export function useWorkoutSession() {
    const routines = useAppStore(state => state.userData?.routines || EMPTY_ROUTINES);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const history = useAppStore(state => state.userData?.history || EMPTY_HISTORY);
    const saveUserData = useAppStore(state => state.saveUserData);
    const localWorkout = useAppStore(state => state.localWorkout);
    const setLocalWorkout = useAppStore(state => state.setLocalWorkout);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

    const activeWorkout = localWorkout;

    const [selectedRoutine, setSelectedRoutine] = useState('');
    const endingRef = useRef(false);
    
    // Rating states derivati direttamente da activeWorkout per prevenire perdita di dati
    const mood = activeWorkout?.moodRating !== undefined && activeWorkout.moodRating !== null ? activeWorkout.moodRating.toString() : '';
    const pump = activeWorkout?.pumpRating !== undefined && activeWorkout.pumpRating !== null ? activeWorkout.pumpRating.toString() : '';
    const fatigue = activeWorkout?.fatigueRating !== undefined && activeWorkout.fatigueRating !== null ? activeWorkout.fatigueRating.toString() : '';
    const water = activeWorkout?.waterLiters !== undefined && activeWorkout.waterLiters !== null ? activeWorkout.waterLiters.toString() : '';
    const manualDuration = activeWorkout ? Logic.normalizeDuration(activeWorkout.manualDurationStr || activeWorkout.globalDurationStr || '00:00:00') : '00:00:00';
    const pains = (activeWorkout?.pains && Array.isArray(activeWorkout.pains)) ? activeWorkout.pains : [];

    const setMood = useCallback((val: string) => {
        setLocalWorkout(prev => prev ? { ...prev, moodRating: val as any } : null);
    }, [setLocalWorkout]);

    const setPump = useCallback((val: string) => {
        setLocalWorkout(prev => prev ? { ...prev, pumpRating: val as any } : null);
    }, [setLocalWorkout]);

    const setFatigue = useCallback((val: string) => {
        setLocalWorkout(prev => prev ? { ...prev, fatigueRating: val as any } : null);
    }, [setLocalWorkout]);

    const setWater = useCallback((val: string) => {
        setLocalWorkout(prev => prev ? { ...prev, waterLiters: val as any } : null);
    }, [setLocalWorkout]);

    const setManualDuration = useCallback((val: string) => {
        setLocalWorkout(prev => prev ? { ...prev, manualDurationStr: val } : null);
    }, [setLocalWorkout]);

    const setPains = useCallback((newPains: string[]) => {
        setLocalWorkout(prev => prev ? { ...prev, pains: newPains } : null);
    }, [setLocalWorkout]);

    const togglePain = useCallback((muscleId: string) => {
        if (!muscleId || typeof muscleId !== 'string') return;
        setLocalWorkout(prev => {
            if (!prev) return null;
            const currentPains = Array.isArray(prev.pains) ? prev.pains : [];
            const nextPains = currentPains.includes(muscleId)
                ? currentPains.filter(p => p !== muscleId)
                : [...currentPains, muscleId];
            return { ...prev, pains: nextPains };
        });
    }, [setLocalWorkout]);

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
        let newActiveWorkout: WorkoutSession;

        if (targetId === 'free') {
            resetGlobalWorkoutTimer();
            newActiveWorkout = {
                id: Logic.generateId('w'),
                routineId: Logic.generateId('free'),
                routineName: 'Allenamento libero',
                date: Logic.getLocalDateString(),
                globalStartTime: new Date().getTime(),
                exercises: []
            };
        } else {
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

            newActiveWorkout = {
                id: Logic.generateId('w'),
                routineId: routine.id,
                routineName: routine.name,
                cycleId: assignedCycleId,
                cycleName: assignedCycleName,
                date: Logic.getLocalDateString(),
                globalStartTime: new Date().getTime(),
                exercises: (routine.exercises || []).map((ex: any) => {
                    const libDef = (userData?.library || []).find(l => l.id === ex.exId);
                    const isCardio = libDef?.trackingType === 'cardio';
                    const setsCount = isCardio ? 1 : (ex.setsCount || 3);
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
                    const result: any = { id: Logic.generateId('se'), exId: ex.exId, sets, sessionNote: '' };
                    if (ex.defaultTechnique) result.defaultTechnique = ex.defaultTechnique;
                    if (ex.minReps) result.minReps = ex.minReps;
                    if (ex.maxReps) result.maxReps = ex.maxReps;
                    return result;
                })
            };
        }

        setLocalWorkout(newActiveWorkout);

        // Telemetry: Non-blocking tracking of workout start
        try {
            const isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
            telemetryHub.trackEvent('workout_started', {
                offline: isOffline,
                routineId: newActiveWorkout.routineId || null,
                routineName: newActiveWorkout.routineName || null
            });
        } catch {
            // Fail-safe non-blocking telemetry
        }
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
            id: ex.id || Logic.generateId('se'),
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
        return true;
    }, [showConfirm, setLocalWorkout]);

    const saveHistoryEdit = useCallback(async () => {
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout) return false;
        const targetId = currentWorkout.originalHistoryId || currentWorkout.id;
        if (!targetId) return false;

        const valRes = Logic.validateWorkoutRatings(mood, pump, fatigue);

        const durationStr = Logic.normalizeDuration(manualDuration?.trim() || currentWorkout.manualDurationStr || currentWorkout.globalDurationStr || '00:00:00');

        const updatedWorkout: WorkoutSession = {
            ...currentWorkout,
            id: targetId,
            globalDurationStr: durationStr,
            manualDurationStr: durationStr,
            moodRating: valRes.mood,
            pumpRating: valRes.pump,
            fatigueRating: valRes.fatigue,
            waterLiters: water ? parseFloat(String(water).replace(',', '.')) : 0,
            pains: Array.isArray(currentWorkout.pains) ? currentWorkout.pains : [],
            date: currentWorkout.date || Logic.getLocalDateString()
        };

        delete updatedWorkout.isEditingHistory;
        delete updatedWorkout.originalHistoryId;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const isMostRecent = prev.history && prev.history.length > 0 && prev.history[0].id === targetId;
                const updatedHistory = (prev.history || []).map(w => (w.id === targetId ? updatedWorkout : w));
                
                let finalActivePains = prev.activePains || [];
                if (isMostRecent) {
                    finalActivePains = Logic.autoHealPains(
                        prev.activePains || [],
                        updatedWorkout.exercises || [],
                        prev.library || [],
                        updatedWorkout.pains || []
                    );
                }

                return { 
                    ...prev, 
                    history: updatedHistory, 
                    activeWorkout: null,
                    ...(isMostRecent && { activePains: finalActivePains })
                };
            });
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
    }, [mood, pump, fatigue, water, manualDuration, saveUserData, setLocalWorkout, showAlert]);

    const cancelHistoryEdit = useCallback(async () => {
        if (await showConfirm("Annullare le modifiche a questo allenamento?")) {
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            return true;
        }
        return false;
    }, [showConfirm, setLocalWorkout]);

    const endWorkout = useCallback(async (): Promise<WorkoutSession | null> => {
        if (endingRef.current) return null;
        endingRef.current = true;
        const expectedUid = auth.currentUser?.uid;
        const expectedId = useAppStore.getState().localWorkout?.id;
        try {
        if (!expectedId || !(await showConfirm("Terminare l'allenamento?"))) return null;
        draftRegistry.flushAll();
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout || currentWorkout.id !== expectedId || auth.currentUser?.uid !== expectedUid) return null;

        const valRes = Logic.validateWorkoutRatings(String(currentWorkout.moodRating ?? ''), String(currentWorkout.pumpRating ?? ''), String(currentWorkout.fatigueRating ?? ''));

        const endTime = new Date().getTime();
        const startTime = currentWorkout.globalStartTime || endTime;
        const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
        const durationStr = Logic.formatDuration(diff);

        const sessionPains = Array.isArray(currentWorkout.pains) ? currentWorkout.pains : [];

        const finishedWorkout: WorkoutSession = {
            ...currentWorkout,
            globalEndTime: endTime,
            globalDurationStr: durationStr,
            moodRating: valRes.mood,
            pumpRating: valRes.pump,
            fatigueRating: valRes.fatigue,
            waterLiters: currentWorkout.waterLiters ? parseFloat(String(currentWorkout.waterLiters).replace(',', '.')) : 0,
            pains: sessionPains,
            date: currentWorkout.date || Logic.getLocalDateString()
        };

        delete finishedWorkout.isEditingHistory;
        delete finishedWorkout.originalHistoryId;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const currentActivePains = prev.activePains || [];
                const finalActivePains = Logic.autoHealPains(
                    currentActivePains,
                    finishedWorkout.exercises || [],
                    prev.library || [],
                    sessionPains
                );

                return {
                    ...prev,
                    history: [finishedWorkout, ...(prev.history || []).filter(item => item.id !== finishedWorkout.id)],
                    activeWorkout: null,
                    activePains: finalActivePains
                };
            });
            if (auth.currentUser?.uid !== expectedUid || useAppStore.getState().localWorkout?.id !== expectedId) return null;
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            try {
                const isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
                const durationVal = finishedWorkout.globalDurationStr || finishedWorkout.manualDurationStr || durationStr;
                telemetryHub.trackEvent('workout_saved', {
                    offline: isOffline,
                    duration: durationVal,
                    durationMinutes: Math.round(diff / 60),
                    exerciseCount: (finishedWorkout.exercises || []).length,
                    exercisesCount: (finishedWorkout.exercises || []).length
                });
            } catch {
                // Fail-safe non-blocking telemetry
            }
            return finishedWorkout;
        } catch {
            if (auth.currentUser?.uid === expectedUid) await showAlert("Errore durante il salvataggio della sessione.");
            return null;
        }
        } finally {
            endingRef.current = false;
        }
    }, [showConfirm, saveUserData, setLocalWorkout, showAlert]);

    const deleteWorkout = useCallback(async () => {
        if (!(await showConfirm("Sei sicuro di voler eliminare questa sessione in corso? Non verrà salvata."))) return;
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                return { ...prev, activeWorkout: null };
            });
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
        pains, setPains, togglePain,
        startWorkout,
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
