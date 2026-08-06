import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { resetGlobalWorkoutTimer } from '../components/Training/WorkoutTimer';
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
    const [manualDuration, setManualDuration] = useState('00:00');

    // Sincronizza i campi quando activeWorkout cambia (es. caricamento o avvio)
    useEffect(() => {
        if (activeWorkout) {
            setMood(activeWorkout.moodRating !== undefined && activeWorkout.moodRating !== null ? activeWorkout.moodRating.toString() : '');
            setPump(activeWorkout.pumpRating !== undefined && activeWorkout.pumpRating !== null ? activeWorkout.pumpRating.toString() : '');
            setFatigue(activeWorkout.fatigueRating !== undefined && activeWorkout.fatigueRating !== null ? activeWorkout.fatigueRating.toString() : '');
            setWater(activeWorkout.waterLiters !== undefined && activeWorkout.waterLiters !== null ? activeWorkout.waterLiters.toString() : '');
            setManualDuration(activeWorkout.manualDurationStr || activeWorkout.globalDurationStr || '00:00');
        } else {
            setMood('');
            setPump('');
            setFatigue('');
            setWater('');
            setManualDuration('00:00');
        }
    }, [activeWorkout?.id, activeWorkout?.originalHistoryId, activeWorkout?.isEditingHistory]);

    const startWorkout = async () => {
        if (!selectedRoutine) {
            await showAlert("Seleziona una scheda per iniziare!");
            return;
        }
        if (activeWorkout) {
            await showAlert("Hai già un allenamento in corso!");
            return;
        }

        const routine = routines.find(r => r.id === selectedRoutine);
        if (!routine) return;
        
        resetGlobalWorkoutTimer();

        const newActiveWorkout: WorkoutSession = {
            id: Logic.generateId('w'),
            routineId: routine.id,
            routineName: routine.name,
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
    };

    const startEditHistoricalWorkout = async (workout: WorkoutSession) => {
        if (activeWorkout && !activeWorkout.isEditingHistory) {
            const ok = await showConfirm("Hai già una sessione attiva in corso. Vuoi sostituirla per modificare questo allenamento passato?");
            if (!ok) return false;
        }

        resetGlobalWorkoutTimer();

        let durationStr = workout.globalDurationStr || workout.manualDurationStr;
        if (!durationStr && workout.globalStartTime && workout.globalEndTime) {
            const diff = Math.max(0, Math.floor((workout.globalEndTime - workout.globalStartTime) / 1000));
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            durationStr = h > 0 
                ? `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
                : `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        }
        if (!durationStr) durationStr = '00:00';

        const editingWorkout: WorkoutSession = {
            ...workout,
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
    };

    const saveHistoryEdit = async () => {
        if (!activeWorkout) return false;
        const targetId = activeWorkout.originalHistoryId || activeWorkout.id;
        if (!targetId) return false;

        const valRes = Logic.validateWorkoutRatings(
            mood ? parseInt(mood) : null,
            pump ? parseInt(pump) : null,
            fatigue ? parseInt(fatigue) : null
        );

        const durationStr = manualDuration?.trim() || activeWorkout.manualDurationStr || activeWorkout.globalDurationStr || '00:00';

        const updatedWorkout: WorkoutSession = {
            ...activeWorkout,
            id: targetId,
            globalDurationStr: durationStr,
            manualDurationStr: durationStr,
            moodRating: valRes.mood,
            pumpRating: valRes.pump,
            fatigueRating: valRes.fatigue,
            waterLiters: water ? parseFloat(water) : 0,
            date: activeWorkout.date || Logic.getLocalDateString()
        };

        delete updatedWorkout.isEditingHistory;
        delete updatedWorkout.originalHistoryId;

        const updatedHistory = history.map(w => (w.id === targetId ? updatedWorkout : w));

        try {
            await saveUserData({ ...userData, history: updatedHistory, activeWorkout: null });
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            setMood(''); setPump(''); setFatigue(''); setWater('');
            setManualDuration('00:00');
            await showAlert("Modifiche salvate con successo!");
            return true;
        } catch {
            showAlert("Errore durante il salvataggio delle modifiche.");
            return false;
        }
    };

    const cancelHistoryEdit = async () => {
        if (await showConfirm("Annullare le modifiche a questo allenamento?")) {
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            setMood(''); setPump(''); setFatigue(''); setWater('');
            setManualDuration('00:00');
            return true;
        }
        return false;
    };

    const endWorkout = async () => {
        if (!activeWorkout || !(await showConfirm("Terminare l'allenamento?"))) return;

        const valRes = Logic.validateWorkoutRatings(
            mood ? parseInt(mood) : null,
            pump ? parseInt(pump) : null,
            fatigue ? parseInt(fatigue) : null
        );

        const endTime = new Date().getTime();
        const startTime = activeWorkout.globalStartTime || endTime;
        const diff = Math.floor((endTime - startTime) / 1000);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        const durationStr = h > 0 
            ? `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
            : `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;

        const finishedWorkout: WorkoutSession = {
            ...activeWorkout,
            globalEndTime: endTime,
            globalDurationStr: durationStr,
            moodRating: valRes.mood,
            pumpRating: valRes.pump,
            fatigueRating: valRes.fatigue,
            waterLiters: water ? parseFloat(water) : 0,
            date: activeWorkout.date || Logic.getLocalDateString()
        };

        delete finishedWorkout.isEditingHistory;
        delete finishedWorkout.originalHistoryId;

        const updatedHistory = [finishedWorkout, ...history];
        
        try {
            await saveUserData({ ...userData, history: updatedHistory, activeWorkout: null });
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            setMood(''); setPump(''); setFatigue(''); setWater('');
        } catch {
            showAlert("Errore durante il salvataggio della sessione.");
        }
    };

    const deleteWorkout = async () => {
        if (!(await showConfirm("Sei sicuro di voler eliminare questa sessione in corso? Non verrà salvata."))) return;
        try {
            await saveUserData({ ...userData, activeWorkout: null });
            setLocalWorkout(null);
            resetGlobalWorkoutTimer();
            setMood(''); setPump(''); setFatigue(''); setWater('');
        } catch {
            showAlert("Errore durante l'eliminazione della sessione.");
        }
    };

    const addExtraExercise = (exInput: string | { exId: string }) => {
        const exId = typeof exInput === 'string' ? exInput : exInput?.exId;
        if (!activeWorkout || !exId) return;
        const updatedActive = {
            ...activeWorkout,
            exercises: [
                ...activeWorkout.exercises,
                { exId, sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }], sessionNote: '' }
            ]
        };
        setLocalWorkout(updatedActive);
    };

    const addSpecialSet = (exIndex: number, setId: string, type: string, closePanelsCallback: any) => {
        if (!activeWorkout) return;
        const updatedExercises = activeWorkout.exercises.map((ex: any, i: number) => {
            if (i !== exIndex) return ex;
            return {
                ...ex,
                sets: ex.sets.map((s: any) => {
                    if (s.id !== setId) return s;
                    if (type === 'dropset') {
                        return { ...s, dropsets: [...(s.dropsets || []), { id: Logic.generateId('ds'), kg: '', reps: '' }] };
                    } else if (type === 'isometry') {
                        return { ...s, isometrics: [...(s.isometrics || []), { id: Logic.generateId('iso'), kg: '', time: '' }] };
                    }
                    return s;
                })
            };
        });
        if (closePanelsCallback) closePanelsCallback();
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const reorderExercises = (fromIndex: number, toIndex: number) => {
        if (!activeWorkout) return;
        const newExercises = [...activeWorkout.exercises];
        const [removed] = newExercises.splice(fromIndex, 1);
        newExercises.splice(toIndex, 0, removed);
        setLocalWorkout({ ...activeWorkout, exercises: newExercises });
    };

    const removeActiveExercise = async (exIndex: number, closePanelsCallback: (index: number) => void) => {
        if (!activeWorkout || !(await showConfirm("Rimuovere questo esercizio dalla sessione corrente?"))) return;
        const updatedExercises = [...activeWorkout.exercises];
        updatedExercises.splice(exIndex, 1);
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
        if (closePanelsCallback) closePanelsCallback(exIndex);
    };

    // Sets Management
    const addSet = (exIndex: number) => {
        if (!activeWorkout) return;
        const updatedExercises = activeWorkout.exercises.map((ex: any, i: number) => {
            if (i !== exIndex) return ex;
            const newSet: any = { id: Logic.generateId('s'), kg: '', reps: '' };
            if (ex.defaultTechnique === 'dropset') {
                newSet.dropsets = [{ id: Logic.generateId('ds'), kg: '', reps: '' }];
            } else if (ex.defaultTechnique === 'isometrics') {
                newSet.isometrics = [{ id: Logic.generateId('iso'), kg: '', time: '' }];
            }
            return { ...ex, sets: [...ex.sets, newSet] };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const removeSet = (exIndex: number, setIndex: number) => {
        if (!activeWorkout) return;
        const updatedExercises = activeWorkout.exercises.map((ex: any, i: number) => {
            if (i !== exIndex) return ex;
            return { ...ex, sets: ex.sets.filter((_: any, si: number) => si !== setIndex) };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };
    const updateSet = (exIndex: number, setId: string, field: string, value: any) => {
        if (!activeWorkout) return;
        const updatedExercises = activeWorkout.exercises.map((ex: any, i: number) => {
            if (i !== exIndex) return ex;
            return {
                ...ex,
                sets: ex.sets.map((s: any) => s.id === setId ? { ...s, [field]: value } : s)
            };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    // Special Sets

    const updateSpecialSet = (exIndex: number, setId: string, collection: string, specIndex: number, field: string, value: any) => {
        if (!activeWorkout) return;
        const updatedExercises = activeWorkout.exercises.map((ex: any, i: number) => {
            if (i !== exIndex) return ex;
            return {
                ...ex,
                sets: ex.sets.map((s: any) => {
                    if (s.id !== setId || !s[collection]) return s;
                    const newColl = s[collection].map((item: any, idx: number) => idx === specIndex ? { ...item, [field]: value } : item);
                    return { ...s, [collection]: newColl };
                })
            };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const removeSpecialSet = (exIndex: number, setId: string, collection: string, specIndex: number) => {
        if (!activeWorkout) return;
        const updatedExercises = activeWorkout.exercises.map((ex: any, i: number) => {
            if (i !== exIndex) return ex;
            return {
                ...ex,
                sets: ex.sets.map((s: any) => {
                    if (s.id !== setId || !s[collection]) return s;
                    return { ...s, [collection]: s[collection].filter((_: any, idx: number) => idx !== specIndex) };
                })
            };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const updateSessionNote = (exIndex: number, note: string) => {
        if (!activeWorkout) return;
        const updatedExercises = activeWorkout.exercises.map((ex: any, i: number) => {
            if (i !== exIndex) return ex;
            return { ...ex, sessionNote: note };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const updateSetupNote = async (exId: string, note: string) => {
        const updatedLibrary = library.map((l: any) => l.id === exId ? { ...l, notes: note } : l);
        try {
            await saveUserData({ ...userData, library: updatedLibrary });
        } catch {
            showAlert("Errore durante il salvataggio della nota.");
        }
    };

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
        addExtraExercise, reorderExercises, removeActiveExercise,
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
