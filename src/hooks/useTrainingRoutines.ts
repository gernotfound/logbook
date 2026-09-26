import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { readBrowserValue, tryRemoveBrowserValue, writeBrowserJson } from '../lib/sync/browserStorage';
import { PlannedSetTechnique, ProgressionContract, RoutineExercise, SetTechnique, WorkoutRoutine } from '../types';

const EMPTY_ROUTINES: WorkoutRoutine[] = [];
const EMPTY_LIBRARY: any[] = [];
const ROUTINE_DRAFT_KEY = 'draft_routine';

export function useTrainingRoutines() {
    const routines = useAppStore(state => state.userData?.routines || EMPTY_ROUTINES);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const setSaveError = useAppStore(state => state.setSaveError);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [routineName, setRoutineName] = useState('');
    const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
    const [routineExercises, setRoutineExercises] = useState<RoutineExercise[]>([]);
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);

    useEffect(() => {
        const draft = readBrowserValue(ROUTINE_DRAFT_KEY);
        if (draft) {
            try {
                const parsed = JSON.parse(draft);
                if (parsed.name) setRoutineName(parsed.name);
                if (parsed.exercises && Array.isArray(parsed.exercises)) setRoutineExercises(parsed.exercises);
            } catch {
                // Invalid drafts remain non-authoritative and are ignored.
            }
        }
    }, []);

    useEffect(() => {
        if (editingRoutineId) return;
        if (routineName.trim() !== '' || routineExercises.length > 0) {
            try {
                writeBrowserJson(ROUTINE_DRAFT_KEY, { name: routineName, exercises: routineExercises });
            } catch {
                setSaveError('Bozza scheda conservata solo in memoria: archivio del dispositivo non disponibile.');
            }
        } else if (!tryRemoveBrowserValue(ROUTINE_DRAFT_KEY)) {
            setSaveError('Impossibile rimuovere la bozza della scheda dal dispositivo.');
        }
    }, [routineName, routineExercises, editingRoutineId, setSaveError]);

    const clearRoutineDraft = () => {
        if (!tryRemoveBrowserValue(ROUTINE_DRAFT_KEY)) {
            setSaveError('Impossibile rimuovere la bozza della scheda dal dispositivo.');
        }
    };

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
            await showAlert('Errore durante la duplicazione della scheda.');
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
        clearRoutineDraft();
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
            clearRoutineDraft();
            return true;
        } catch {
            await showAlert("Errore durante il salvataggio della scheda.");
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
            await showAlert("Errore durante l'eliminazione della scheda.");
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

    const handleUpdateSetPlan = (
        exerciseIndex: number,
        setIndex: number,
        technique: SetTechnique,
    ) => {
        setRoutineExercises(prev => {
            const exercises = [...prev];
            const exercise = { ...exercises[exerciseIndex] };
            const count = Math.max(1, Number.parseInt(String(exercise.setsCount || 3), 10) || 3);
            const plans: PlannedSetTechnique[] = Array.from({ length: count }, (_, index) => ({
                ...(exercise.setPlans?.[index] || { technique: 'straight' as const }),
            }));
            plans[setIndex] = { technique };
            exercise.setPlans = plans;
            exercises[exerciseIndex] = exercise;
            return exercises;
        });
    };

    const handleUpdateSetPlanField = (
        exerciseIndex: number,
        setIndex: number,
        field: 'restSeconds' | 'segmentCount' | 'targetReps',
        value: string,
    ) => {
        setRoutineExercises(prev => {
            const exercises = [...prev];
            const exercise = { ...exercises[exerciseIndex] };
            const count = Math.max(1, Number.parseInt(String(exercise.setsCount || 3), 10) || 3);
            const plans: PlannedSetTechnique[] = Array.from({ length: count }, (_, index) => ({
                ...(exercise.setPlans?.[index] || { technique: 'straight' as const }),
            }));
            const plan = { ...plans[setIndex] };
            const parsed = value.trim() === '' ? undefined : Number.parseInt(value, 10);

            if (field === 'targetReps') {
                if (parsed === undefined || !Number.isFinite(parsed) || parsed < 1) delete plan.target;
                else plan.target = { type: 'reps', reps: parsed };
            } else if (parsed === undefined || !Number.isFinite(parsed) || parsed < (field === 'restSeconds' ? 0 : 2)) {
                delete plan[field];
            } else {
                plan[field] = parsed;
            }
            plans[setIndex] = plan;
            exercise.setPlans = plans;
            exercises[exerciseIndex] = exercise;
            return exercises;
        });
    };

    const handleUpdateExerciseMetadata = (
        index: number,
        field: 'technicalStandard' | keyof ProgressionContract,
        value: string,
    ) => {
        setRoutineExercises(prev => {
            const exercises = [...prev];
            const exercise = { ...exercises[index] };
            if (field === 'technicalStandard') {
                const normalized = value.trim();
                if (normalized) exercise.technicalStandard = value;
                else delete exercise.technicalStandard;
            } else {
                const contract: ProgressionContract = { ...(exercise.progressionContract || {}) };
                const normalized = value.trim();
                if (normalized) (contract as Record<string, unknown>)[field] = value;
                else delete (contract as Record<string, unknown>)[field];
                exercise.progressionContract = Object.keys(contract).length ? contract : undefined;
            }
            exercises[index] = exercise;
            return exercises;
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
        handleUpdateSetPlan, handleUpdateSetPlanField,
        handleUpdateExerciseMetadata,
        handleRemoveExerciseFromRoutine, moveExercise
    };
}
