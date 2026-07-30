import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { RoutineExercise, WorkoutRoutine } from '../types';

export function useTrainingRoutines() {
    const userData = useAppStore(state => state.userData);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [routineName, setRoutineName] = useState('');
    const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
    const [routineExercises, setRoutineExercises] = useState<RoutineExercise[]>([]);
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);

    // Restore draft on mount
    useEffect(() => {
        const draft = localStorage.getItem('draft_routine');
        if (draft) {
            try {
                const parsed = JSON.parse(draft);
                if (parsed.name) setRoutineName(parsed.name);
                if (parsed.exercises) setRoutineExercises(parsed.exercises);
            } catch (e) {}
        }
    }, []);

    // Save draft on change
    useEffect(() => {
        if (!editingRoutineId) {
            localStorage.setItem('draft_routine', JSON.stringify({ name: routineName, exercises: routineExercises }));
        }
    }, [routineName, routineExercises, editingRoutineId]);

    const handleRoutineClick = (id: string) => {
        setExpandedRoutineId(prev => prev === id ? null : id);
    };

    const routines = userData?.routines || [];
    const library = userData?.library || [];

    const handleEditClick = (rtn: WorkoutRoutine) => {
        setEditingRoutineId(rtn.id);
        setRoutineName(rtn.name);
        setRoutineExercises(rtn.exercises || []);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingRoutineId(null);
        setRoutineName('');
        setRoutineExercises([]);
        localStorage.removeItem('draft_routine');
    };

    const handleSave = async () => {
        if (!routineName.trim()) {
            await showAlert("Inserisci il nome della scheda");
            return;
        }

        try {
            if (editingRoutineId) {
                const updatedRoutines = routines.map(r => 
                    r.id === editingRoutineId ? { ...r, name: routineName.trim(), exercises: routineExercises } : r
                );
                await saveUserData({ ...userData, routines: updatedRoutines });
            } else {
                const newRoutine = {
                    id: Logic.generateId('rtn'),
                    name: routineName.trim(),
                    exercises: routineExercises
                };
                const updatedRoutines = [...routines, newRoutine].sort((a,b) => a.name.localeCompare(b.name));
                await saveUserData({ ...userData, routines: updatedRoutines });
            }
            
            setRoutineName('');
            setRoutineExercises([]);
            setEditingRoutineId(null);
            localStorage.removeItem('draft_routine');
        } catch {
            showAlert("Errore durante il salvataggio della scheda.");
        }
    };

    const handleDelete = async (id: string, e: any) => {
        e.stopPropagation();
        if (!(await showConfirm("Sei sicuro di voler eliminare questa scheda?"))) return;
        const updatedRoutines = routines.filter(r => r.id !== id);
        try {
            await saveUserData({ ...userData, routines: updatedRoutines });
            if (editingRoutineId === id) {
                handleCancelEdit();
            }
        } catch {
            showAlert("Errore durante l'eliminazione della scheda.");
        }
    };

    const handleAddExerciseToRoutine = (exId: string) => {
        if (!exId) return;
        setRoutineExercises(prev => [...prev, { exId, setsCount: 3 }]);
    };

    const handleUpdateSetsCount = (index: number, count: number) => {
        setRoutineExercises(prev => {
            const newExs = [...prev];
            newExs[index] = { ...newExs[index], setsCount: Math.max(1, count) };
            return newExs;
        });
    };

    const handleUpdateReps = (index: number, field: 'minReps' | 'maxReps', value: string) => {
        setRoutineExercises(prev => {
            const newExs = [...prev];
            const parsed = parseInt(value);
            if (isNaN(parsed)) {
                const ex = { ...newExs[index] };
                delete ex[field];
                newExs[index] = ex;
            } else {
                newExs[index] = { ...newExs[index], [field]: parsed };
            }
            return newExs;
        });
    };

    const handleRemoveExerciseFromRoutine = (indexToRemove: number) => {
        setRoutineExercises(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const moveExercise = (index: number, direction: number) => {
        setRoutineExercises(prev => {
            const newExs = [...prev];
            if (direction === -1 && index > 0) {
                [newExs[index], newExs[index - 1]] = [newExs[index - 1], newExs[index]];
            } else if (direction === 1 && index < newExs.length - 1) {
                [newExs[index], newExs[index + 1]] = [newExs[index + 1], newExs[index]];
            }
            return newExs;
        });
    };

    return {
        routineName, setRoutineName,
        editingRoutineId,
        expandedRoutineId, handleRoutineClick,
        routineExercises,
        routines, library,
        handleSave, handleCancelEdit, handleEditClick, handleDelete,
        handleAddExerciseToRoutine, handleUpdateSetsCount, handleUpdateReps,
        handleRemoveExerciseFromRoutine, moveExercise
    };
}
