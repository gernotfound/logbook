import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

export function useTrainingRoutines() {
    const { userData, saveUserData } = useAppStore();
    const { showAlert, showConfirm } = useDialogStore();
    const [routineName, setRoutineName] = useState('');
    const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);

    const routines = userData?.routines || [];
    const library = userData?.library || [];

    const handleCreate = async () => {
        if (!routineName.trim()) {
            await showAlert("Inserisci il nome della scheda");
            return;
        }

        const newRoutine = {
            id: Logic.generateId('rtn'),
            name: routineName.trim(),
            exercises: []
        };

        const updatedRoutines = [...routines, newRoutine].sort((a,b) => a.name.localeCompare(b.name));
        saveUserData({ ...userData, routines: updatedRoutines });
        setRoutineName('');
        setEditingRoutineId(newRoutine.id); // Open it for editing immediately
    };

    const handleDelete = async (id: string, e: any) => {
        e.stopPropagation();
        if (!(await showConfirm("Sei sicuro di voler eliminare questa routine?"))) return;
        const updatedRoutines = routines.filter(r => r.id !== id);
            saveUserData({ ...userData, routines: updatedRoutines });
            if (editingRoutineId === id) setEditingRoutineId(null);
    };

    const handleAddExerciseToRoutine = (routineId: string, exId: string) => {
        if (!exId) return;
        const updatedRoutines = routines.map(r => {
            if (r.id === routineId) {
                return {
                    ...r,
                    exercises: [...(r.exercises || []), { exId, setsCount: 3 }]
                };
            }
            return r;
        });
        saveUserData({ ...userData, routines: updatedRoutines });
    };

    const handleUpdateSetsCount = (routineId: string, index: number, count: number) => {
        const updatedRoutines = routines.map(r => {
            if (r.id === routineId) {
                const newExs = [...(r.exercises || [])];
                newExs[index] = { ...newExs[index], setsCount: Math.max(1, count) };
                return { ...r, exercises: newExs };
            }
            return r;
        });
        saveUserData({ ...userData, routines: updatedRoutines });
    };

    const handleRemoveExerciseFromRoutine = (routineId: string, indexToRemove: number) => {
        const updated = routines.map(r => {
            if (r.id === routineId) {
                return {
                    ...r,
                    exercises: r.exercises.filter((_: any, idx: number) => idx !== indexToRemove)
                };
            }
            return r;
        });
        saveUserData({ ...userData, routines: updated });
    };

    const moveExercise = (routineId: string, index: number, direction: number) => {
        const routine = routines.find(r => r.id === routineId);
        if (!routine) return;
        
        const newExercises = [...(routine.exercises || [])];
        if (direction === -1 && index > 0) {
            [newExercises[index], newExercises[index - 1]] = [newExercises[index - 1], newExercises[index]];
        } else if (direction === 1 && index < newExercises.length - 1) {
            [newExercises[index], newExercises[index + 1]] = [newExercises[index + 1], newExercises[index]];
        } else {
            return;
        }

        const updatedRoutines = routines.map(r => {
            if (r.id === routineId) return { ...r, exercises: newExercises };
            return r;
        });
        saveUserData({ ...userData, routines: updatedRoutines });
    };

    return {
        routineName, setRoutineName,
        editingRoutineId, setEditingRoutineId,
        routines, library,
        handleCreate, handleDelete,
        handleAddExerciseToRoutine, handleUpdateSetsCount,
        handleRemoveExerciseFromRoutine, moveExercise
    };
}
