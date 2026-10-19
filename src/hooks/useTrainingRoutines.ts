import { MAX_ROUTINE_SEGMENTS, MAX_ROUTINE_SETS, previewRoutineSets } from '../lib/routineSessionLimits';
import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { readWorkoutRecoveryDraft, writeWorkoutRecoveryDraft } from '../lib/sync/workoutRecoveryDraft';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { PlannedSetTechnique, ProgressionContract, RoutineExercise, SetTechnique, WorkoutRoutine } from '../types';

const EMPTY_ROUTINES: WorkoutRoutine[] = [];
const EMPTY_LIBRARY: any[] = [];
const ROUTINE_DRAFT_KEY = 'draft_routine';

function blockRoutineDraft(error: unknown): void {
    console.error('Persistenza bozza scheda non disponibile:', error);
    useAppStore.setState({
        localPersistenceBlocked: true,
        syncHealth: 'failed',
        syncPresentation: 'normal',
        saveError: 'Bozza scheda non verificabile o non salvata: originale conservato. Riapri TheLogBook per verificare il recupero.',
    });
}

export function useTrainingRoutines() {
    const routines = useAppStore(state => state.userData?.routines || EMPTY_ROUTINES);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const setSaveError = useAppStore(state => state.setSaveError);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [draftSession] = useState(() => captureSession());
    const draftOwner = draftSession.owner;
    const [initialRecovery] = useState(() => {
        try {
            const draft = readWorkoutRecoveryDraft(ROUTINE_DRAFT_KEY, draftOwner);
            return { draft: draft as { name?: string; exercises?: RoutineExercise[] } | null, error: null as unknown };
        } catch (error) {
            return { draft: null, error };
        }
    });
    const initialDraft = initialRecovery.draft;
    const localPersistenceBlocked = useAppStore(state => state.localPersistenceBlocked);
    const assertCurrentDraft = useCallback(() => {
        if (initialRecovery.error || localPersistenceBlocked || !isCurrentSession(draftSession)) {
            throw new Error('Sessione, consenso o bozza scheda non più verificabili.');
        }
        readWorkoutRecoveryDraft(ROUTINE_DRAFT_KEY, draftOwner);
    }, [draftOwner, draftSession, initialRecovery.error, localPersistenceBlocked]);
    useEffect(() => {
        if (initialRecovery.error) blockRoutineDraft(initialRecovery.error);
    }, [initialRecovery.error]);
    const [routineName, setRoutineName] = useState(() => initialDraft?.name || '');
    const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
    const [routineExercises, setRoutineExercises] = useState<RoutineExercise[]>(() => Array.isArray(initialDraft?.exercises) ? initialDraft.exercises : []);
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);

    useEffect(() => {
        if (editingRoutineId || initialRecovery.error || localPersistenceBlocked) return;
        try {
            assertCurrentDraft();
            writeWorkoutRecoveryDraft(ROUTINE_DRAFT_KEY, draftOwner,
                routineName.trim() !== '' || routineExercises.length > 0
                    ? { name: routineName, exercises: routineExercises } : null, draftSession.consentGeneration);
        } catch (error) {
            blockRoutineDraft(error);
        }
    }, [routineName, routineExercises, editingRoutineId, draftOwner, draftSession,
        initialRecovery.error, localPersistenceBlocked, assertCurrentDraft]);

    const clearRoutineDraft = () => {
        try {
            assertCurrentDraft();
            writeWorkoutRecoveryDraft(ROUTINE_DRAFT_KEY, draftOwner, null, draftSession.consentGeneration);
        } catch (error) {
            blockRoutineDraft(error);
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
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'routine.upsert', routine: duplicated });
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

        if (routineExercises.some(ex => {
            const count = Number(ex.setsCount || 3);
            return !Number.isSafeInteger(count) || count < 1 || count > MAX_ROUTINE_SETS;
        })) {
            await showAlert('Ogni esercizio può contenere da 1 a 20 serie. Correggi il valore prima di salvare la scheda.');
            return false;
        }
        if (routineExercises.some(ex => ex.setPlans?.some(plan => plan.segmentCount !== undefined
            && (!Number.isSafeInteger(plan.segmentCount) || plan.segmentCount < 2 || plan.segmentCount > MAX_ROUTINE_SEGMENTS)))) {
            await showAlert('Ogni serie avanzata può avere da 2 a 20 segmenti. Correggi il valore prima di salvare la scheda.');
            return false;
        }

        try {
            assertCurrentDraft();
            const sanitizedExercises: RoutineExercise[] = routineExercises.map(ex => {
                const num = typeof ex.setsCount === 'number' ? ex.setsCount : parseInt(String(ex.setsCount), 10);
                return {
                    ...ex,
                    setsCount: !isNaN(num) && num >= 1 ? Math.min(MAX_ROUTINE_SETS, Math.floor(num)) : 3
                };
            });

            if (editingRoutineId) {
                const existing = routines.find(r => r.id === editingRoutineId);
                if (!existing) throw new Error('Routine non trovata');
                await dispatchDurableOperation(dispatchDomainOperation, {
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
                await dispatchDurableOperation(dispatchDomainOperation, [
                    { type: 'routine.upsert', routine: newRoutine },
                    { type: 'routine.reorder', ids: orderIds },
                ]);
            }

            setRoutineName('');
            setRoutineExercises([]);
            setEditingRoutineId(null);
            clearRoutineDraft();
            return true;
        } catch (error) {
            blockRoutineDraft(error);
            await showAlert("Errore durante il salvataggio della scheda.");
            return false;
        }
    };

    const handleDelete = async (id: string, e: any) => {
        e.stopPropagation();
        if (!(await showConfirm("Sei sicuro di voler eliminare questa scheda?"))) return;
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'routine.delete', id });
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
            const currentExercise = newExs[index];

            if (count === '' || count === undefined || count === null) {
                newExs[index] = { ...currentExercise, setsCount: '' };
                return newExs;
            }

            const parsed = parseInt(count.toString(), 10);
            if (isNaN(parsed)) {
                newExs[index] = { ...currentExercise, setsCount: '' };
                return newExs;
            }

            const normalizedCount = Math.max(1, Math.min(MAX_ROUTINE_SETS, parsed));
            const currentPlans = Array.isArray(currentExercise.setPlans) ? currentExercise.setPlans : [];
            const setPlans: PlannedSetTechnique[] = Array.from({ length: normalizedCount }, (_, setIndex) => ({
                ...(currentPlans[setIndex] || { technique: 'straight' as const }),
            }));

            newExs[index] = {
                ...currentExercise,
                setsCount: normalizedCount,
                setPlans,
            };
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
            const count = previewRoutineSets(exercise.setsCount);
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
            const count = previewRoutineSets(exercise.setsCount);
            const plans: PlannedSetTechnique[] = Array.from({ length: count }, (_, index) => ({
                ...(exercise.setPlans?.[index] || { technique: 'straight' as const }),
            }));
            const plan = { ...plans[setIndex] };
            const parsed = value.trim() === '' ? undefined
                : field === 'segmentCount' ? Number(value) : Number.parseInt(value, 10);

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
