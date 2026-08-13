import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { RoutineExercise, WorkoutRoutine } from '../types';

const EMPTY_ROUTINES: WorkoutRoutine[] = [];
const EMPTY_LIBRARY: any[] = [];

export function useTrainingRoutines() {
    const routines = useAppStore(state => state.userData?.routines || EMPTY_ROUTINES);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
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
                if (parsed.exercises && Array.isArray(parsed.exercises)) setRoutineExercises(parsed.exercises);
            } catch {
                // Ignore parse error on invalid draft
            }
        }
    }, []);

    // Salva la bozza solo se non stiamo modificando una scheda esistente
    useEffect(() => {
        if (!editingRoutineId) {
            if (routineName.trim() !== '' || routineExercises.length > 0) {
                localStorage.setItem('draft_routine', JSON.stringify({ name: routineName, exercises: routineExercises }));
            } else {
                localStorage.removeItem('draft_routine');
            }
        }
    }, [routineName, routineExercises, editingRoutineId]);

    const handleRoutineClick = (id: string) => {
        setExpandedRoutineId(prev => prev === id ? null : id);
    };

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

    const handleSave = async (e?: any) => {
        if (e) e.preventDefault();
        if (!routineName.trim()) {
            await showAlert("Inserisci il nome della scheda");
            return;
        }

        try {
            const sanitizedExercises: RoutineExercise[] = routineExercises.map(ex => {
                const num = typeof ex.setsCount === 'number' ? ex.setsCount : parseInt(String(ex.setsCount), 10);
                return {
                    ...ex,
                    setsCount: !isNaN(num) && num >= 1 ? Math.min(20, Math.floor(num)) : 3
                };
            });

            if (editingRoutineId) {
                const updatedRoutines = routines.map(r => 
                    r.id === editingRoutineId ? { ...r, name: routineName.trim(), exercises: sanitizedExercises } : r
                );
                await saveUserData(prev => ({ ...prev, routines: updatedRoutines } as any));
            } else {
                const newRoutine = {
                    id: Logic.generateId('rtn'),
                    name: routineName.trim(),
                    exercises: sanitizedExercises
                };
                const updatedRoutines = [...routines, newRoutine].sort((a,b) => a.name.localeCompare(b.name));
                await saveUserData(prev => ({ ...prev, routines: updatedRoutines } as any));
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
            await saveUserData(prev => ({ ...prev, routines: updatedRoutines } as any));
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

    const handleUpdateSetsCount = (index: number, count: string | number) => {
        setRoutineExercises(prev => {
            const newExs = [...prev];
            if (count === '' || count === undefined || count === null) {
                newExs[index] = { ...newExs[index], setsCount: '' };
            } else {
                const parsed = parseInt(count.toString(), 10);
                newExs[index] = { ...newExs[index], setsCount: isNaN(parsed) ? '' : parsed };
            }
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

    const handleUpdateTechnique = (index: number, technique: 'dropset' | 'isometrics' | 'none') => {
        setRoutineExercises(prev => {
            const newExs = [...prev];
            const current = newExs[index]?.defaultTechnique;
            const updated = current === technique ? 'none' : technique;
            newExs[index] = { ...newExs[index], defaultTechnique: updated === 'none' ? undefined : updated };
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
        handleUpdateTechnique,
        handleRemoveExerciseFromRoutine, moveExercise
    };
}
