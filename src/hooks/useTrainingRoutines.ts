import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Logic } from '../lib/logic';

export function useTrainingRoutines(setSubTab?: any) {
    const { userData, saveUserData } = useAppStore();
    const [routineName, setRoutineName] = useState('');
    const [editingRoutineId, setEditingRoutineId] = useState(null);

    const routines = userData?.routines || [];
    const library = userData?.library || [];

    const handleCreate = () => {
        if (!routineName.trim()) {
            alert("Inserisci il nome della scheda");
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

    const handleDelete = (id, e) => {
        e.stopPropagation();
        if (confirm("Vuoi davvero eliminare questa scheda?")) {
            const updatedRoutines = routines.filter(r => r.id !== id);
            saveUserData({ ...userData, routines: updatedRoutines });
            if (editingRoutineId === id) setEditingRoutineId(null);
        }
    };

    const handleAddExerciseToRoutine = (routineId, exId) => {
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

    const handleUpdateSetsCount = (routineId, index, count) => {
        const updatedRoutines = routines.map(r => {
            if (r.id === routineId) {
                const newExs = [...(r.exercises || [])];
                newExs[index] = { ...newExs[index], setsCount: parseInt(count) || 1 };
                return { ...r, exercises: newExs };
            }
            return r;
        });
        saveUserData({ ...userData, routines: updatedRoutines });
    };

    const handleRemoveExerciseFromRoutine = (routineId, indexToRemove) => {
        const updatedRoutines = routines.map(r => {
            if (r.id === routineId) {
                return {
                    ...r,
                    exercises: (r.exercises || []).filter((_, idx) => idx !== indexToRemove)
                };
            }
            return r;
        });
        saveUserData({ ...userData, routines: updatedRoutines });
    };

    const moveExercise = (routineId, index, direction) => {
        const routine = routines.find(r => r.id === routineId);
        if (!routine) return;
        
        const newExercises = [...(routine.exercises || [])];
        if (direction === 'up' && index > 0) {
            [newExercises[index], newExercises[index - 1]] = [newExercises[index - 1], newExercises[index]];
        } else if (direction === 'down' && index < newExercises.length - 1) {
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
