import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

export function useWorkoutSession() {
    const { userData, saveUserData, localWorkout, setLocalWorkout } = useAppStore();
    const { showAlert, showConfirm } = useDialogStore();

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
        
        const newActiveWorkout = {
            id: Logic.generateId('w'),
            routineId: routine.id,
            routineName: routine.name,
            date: Logic.getLocalDateString(),
            globalStartTime: new Date().getTime(),
            exercises: (routine.exercises || []).map((ex: any) => {
                const setsCount = ex.setsCount || 3;
                const sets = [];
                for (let i = 0; i < setsCount; i++) {
                    sets.push({ id: Logic.generateId('s'), kg: '', reps: '' });
                }
                return { exId: ex.exId, sets, sessionNote: '' };
            })
        };

        setLocalWorkout(newActiveWorkout);
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

        const finishedWorkout = {
            ...activeWorkout,
            globalEndTime: endTime,
            globalDurationStr: durationStr,
            moodRating: valRes.mood,
            pumpRating: valRes.pump,
            fatigueRating: valRes.fatigue,
            waterLiters: water ? parseFloat(water) : 0,
            date: activeWorkout.date || Logic.getLocalDateString()
        };

        const updatedHistory = [finishedWorkout, ...history];
        
        saveUserData({ ...userData, history: updatedHistory });
        setLocalWorkout(null);
        setMood(''); setPump(''); setFatigue(''); setWater('');
    };

    const deleteWorkout = async () => {
        if (!(await showConfirm("Sei sicuro di voler eliminare questa sessione in corso? Non verrà salvata."))) return;
        setLocalWorkout(null);
        setMood(''); setPump(''); setFatigue(''); setWater('');
    };

    const addExtraExercise = (ex: any) => {
        if (!activeWorkout || !ex.exId) return;
        const updatedActive = {
            ...activeWorkout,
            exercises: [
                ...activeWorkout.exercises,
                { exId: ex.exId, sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }], sessionNote: '' }
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
            return { ...ex, sets: [...ex.sets, { id: Logic.generateId('s'), kg: '', reps: '' }] };
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

    const updateSetupNote = (exId: string, note: string) => {
        const updatedLibrary = library.map((l: any) => l.id === exId ? { ...l, notes: note } : l);
        saveUserData({ ...userData, library: updatedLibrary });
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
        startWorkout,
        endWorkout,
        deleteWorkout,
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
