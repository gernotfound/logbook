import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Logic } from '../lib/logic';

export function useWorkoutSession(onFinish) {
    const { userData, saveUserData, localWorkout, setLocalWorkout } = useAppStore();

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

    const startWorkout = () => {
        if (!selectedRoutine) {
            alert("Seleziona una scheda per iniziare!");
            return;
        }
        if (activeWorkout) {
            alert("Hai già un allenamento in corso!");
            return;
        }

        const routine = routines.find(r => r.id === selectedRoutine);
        if (!routine) return;
        
        const newActiveWorkout = {
            id: Logic.generateId('w'),
            routineId: routine.id,
            routineName: routine.name,
            date: new Date().toISOString().split('T')[0],
            globalStartTime: new Date().getTime(),
            exercises: (routine.exercises || []).map(ex => {
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

    const endWorkout = () => {
        if (!confirm("Terminare l'allenamento?")) return;

        const valRes = Logic.validateWorkoutRatings(
            mood ? parseInt(mood) : null,
            pump ? parseInt(pump) : null,
            fatigue ? parseInt(fatigue) : null
        );

        const endTime = new Date().getTime();
        const diff = Math.floor((endTime - activeWorkout.globalStartTime) / 1000);
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
            date: activeWorkout.date || new Date().toISOString().split('T')[0]
        };

        const updatedHistory = [finishedWorkout, ...history];
        
        saveUserData({ ...userData, history: updatedHistory });
        setLocalWorkout(null);
        setMood(''); setPump(''); setFatigue(''); setWater('');
    };

    const deleteWorkout = () => {
        if (!confirm("Sei sicuro di voler eliminare questa sessione in corso? Non verrà salvata.")) return;
        setLocalWorkout(null);
        setMood(''); setPump(''); setFatigue(''); setWater('');
    };

    const addExtraExercise = (exId) => {
        if (!exId) return;
        const updatedActive = {
            ...activeWorkout,
            exercises: [
                ...activeWorkout.exercises,
                { exId, sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }], sessionNote: '' }
            ]
        };
        setLocalWorkout(updatedActive);
    };

    const removeActiveExercise = (exIndex, closePanelsCallback) => {
        if (!confirm("Rimuovere questo esercizio dalla sessione corrente?")) return;
        const updatedExercises = [...activeWorkout.exercises];
        updatedExercises.splice(exIndex, 1);
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
        if (closePanelsCallback) closePanelsCallback(exIndex);
    };

    // Sets Management
    const addSet = (exIndex) => {
        const updatedExercises = activeWorkout.exercises.map((ex, i) => {
            if (i !== exIndex) return ex;
            return { ...ex, sets: [...ex.sets, { id: Logic.generateId('s'), kg: '', reps: '' }] };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const removeSet = (exIndex, setIndex) => {
        const updatedExercises = activeWorkout.exercises.map((ex, i) => {
            if (i !== exIndex) return ex;
            return { ...ex, sets: ex.sets.filter((_, si) => si !== setIndex) };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const updateSet = (exIndex, setId, field, value) => {
        const updatedExercises = activeWorkout.exercises.map((ex, i) => {
            if (i !== exIndex) return ex;
            return {
                ...ex,
                sets: ex.sets.map(s => s.id === setId ? { ...s, [field]: value } : s)
            };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    // Special Sets
    const addSpecialSet = (exIndex, setId, type, closeMenuCallback) => {
        const updatedExercises = activeWorkout.exercises.map((ex, i) => {
            if (i !== exIndex) return ex;
            return {
                ...ex,
                sets: ex.sets.map(s => {
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
        if (closeMenuCallback) closeMenuCallback();
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const updateSpecialSet = (exIndex, setId, collection, specIndex, field, value) => {
        const updatedExercises = activeWorkout.exercises.map((ex, i) => {
            if (i !== exIndex) return ex;
            return {
                ...ex,
                sets: ex.sets.map(s => {
                    if (s.id !== setId || !s[collection]) return s;
                    const newColl = s[collection].map((item, idx) => idx === specIndex ? { ...item, [field]: value } : item);
                    return { ...s, [collection]: newColl };
                })
            };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const removeSpecialSet = (exIndex, setId, collection, specIndex) => {
        const updatedExercises = activeWorkout.exercises.map((ex, i) => {
            if (i !== exIndex) return ex;
            return {
                ...ex,
                sets: ex.sets.map(s => {
                    if (s.id !== setId || !s[collection]) return s;
                    return { ...s, [collection]: s[collection].filter((_, idx) => idx !== specIndex) };
                })
            };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const updateSessionNote = (exIndex, note) => {
        const updatedExercises = activeWorkout.exercises.map((ex, i) => {
            if (i !== exIndex) return ex;
            return { ...ex, sessionNote: note };
        });
        setLocalWorkout({ ...activeWorkout, exercises: updatedExercises });
    };

    const updateSetupNote = (exId, note) => {
        const updatedLibrary = library.map(l => l.id === exId ? { ...l, notes: note } : l);
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
        addExtraExercise,
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
