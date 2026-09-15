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
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [routineName, setRoutineName] = useState('');
    const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
    const [routineExercises, setRoutineExercises] = useState<RoutineExercise[]>([]);
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);

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

    const handleDuplicate = async (rtn: WorkoutRoutine) => {
        const newName = Logic.generateUniqueName(rtn.name, routines.map(r => r.name));
        const duplicated: WorkoutRoutine = {
            ...rtn,
            id: Logic.generateId('rtn'),
            name: newName
        };
        try {
            await dispatchDomainOperation({ type: 'routine.upsert', routine: duplicated });
        } catch (err) {
            console.error(err);
        }
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
            return false;
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
                const existing = routines.find(r => r.id === editingRoutineId);
                if (!existing) throw new Error('Routine non trovata');
                await dispatchDomainOperation({
                    type: 'routine.upsert',
                    routine: { ...existing, name: routineName.trim(), exercises: sanitizedExercises },
                });
            } else {
                const newRoutine: WorkoutRoutine = {
                    id: Logic.generateId('rtn'),
                    name: routineName.trim(),
                    exercises: sanitizedExercises
                };
                const orderIds = [...routines, newRoutine]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(routine => routine.id);
                await dispatchDomainOperation([
                    { type: 'routine.upsert', routine: newRoutine },
                    { type: 'routine.reorder', ids: orderIds },
                ]);
            }

            setRoutineName('');
            setRoutineExercises([]);
            setEditingRoutineId(null);
            localStorage.removeItem('draft_routine');
            return true;
        } catch {
            showAlert("Errore durante il salvataggio della scheda.");
            return false;
        }
    };

    const handleDelete = async (id: string, e: any) => {
        e.stopPropagation();
        if (!(await showConfirm("Sei sicuro di voler eliminare questa scheda?"))) return;
        try {
            await dispatchDomainOperation({ type: 'routine.delete', id });
            if (editingRoutineId === id) handleCancelEdit();
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
        handleSave, handleCancelEdit, handleEditClick, handleDelete, handleDuplicate,
        handleAddExerciseToRoutine, handleUpdateSetsCount, handleUpdateReps,
        handleUpdateTechnique,
        handleRemoveExerciseFromRoutine, moveExercise
    };
}
