import { buildRoutineDuplicateOperation, buildRoutineSaveOperations, routineDraftValidationError } from '../lib/routineSaveIntent';
import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { parseRoutineRecovery } from '../lib/routineRecoverySchema';
import { readWorkoutRecoveryDraftImage, writeWorkoutRecoveryDraft } from '../lib/sync/workoutRecoveryDraft';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import type { Exercise, WorkoutRoutine } from '../types';
import { useRoutineExerciseEditor } from './trainingRoutines/useRoutineExerciseEditor';

const EMPTY_ROUTINES: WorkoutRoutine[] = [];
const EMPTY_LIBRARY: Exercise[] = [];
const ROUTINE_DRAFT_KEY = 'draft_routine';

function blockRoutineDraft(error: unknown, session: ReturnType<typeof captureSession>): void {
    if (!isCurrentSession(session)) return;
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
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [draftSession] = useState(() => captureSession());
    const draftOwner = draftSession.owner;
    const [initialRecovery] = useState(() => {
        try {
            const image = readWorkoutRecoveryDraftImage(ROUTINE_DRAFT_KEY, draftOwner);
            return { draft: parseRoutineRecovery(image.value), raw: image.raw, error: null as unknown };
        } catch (error) {
            return { draft: null, raw: null, error };
        }
    });
    const initialDraft = initialRecovery.draft;
    const draftRaw = useRef<string | null>(initialRecovery.raw);
    const localPersistenceBlocked = useAppStore(state => state.localPersistenceBlocked);
    const assertCurrentDraft = useCallback(() => {
        if (initialRecovery.error || localPersistenceBlocked || !isCurrentSession(draftSession)) {
            throw new Error('Sessione, consenso o bozza scheda non più verificabili.');
        }
        if (readWorkoutRecoveryDraftImage(ROUTINE_DRAFT_KEY, draftOwner).raw !== draftRaw.current) {
            throw new Error('Bozza scheda modificata da un’altra scheda: originale conservato.');
        }
    }, [draftOwner, draftSession, initialRecovery.error, localPersistenceBlocked]);
    useEffect(() => {
        if (initialRecovery.error) blockRoutineDraft(initialRecovery.error, draftSession);
    }, [initialRecovery.error, draftSession]);
    const [routineName, setRoutineName] = useState(() => initialDraft?.name || '');
    const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
    const {
        routineExercises, setRoutineExercises,
        handleAddExerciseToRoutine, handleUpdateSetsCount, handleUpdateReps,
        handleUpdateSetPlan, handleUpdateSetPlanField,
        handleUpdateExerciseMetadata, handleRemoveExerciseFromRoutine, moveExercise,
    } = useRoutineExerciseEditor(initialDraft?.exercises);
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);

    useEffect(() => {
        if (editingRoutineId || initialRecovery.error || localPersistenceBlocked) return;
        try {
            assertCurrentDraft();
            draftRaw.current = writeWorkoutRecoveryDraft(ROUTINE_DRAFT_KEY, draftOwner,
                routineName.trim() !== '' || routineExercises.length > 0
                    ? { name: routineName, exercises: routineExercises } : null,
                draftSession.consentGeneration, draftRaw.current);
        } catch (error) {
            blockRoutineDraft(error, draftSession);
        }
    }, [routineName, routineExercises, editingRoutineId, draftOwner, draftSession,
        initialRecovery.error, localPersistenceBlocked, assertCurrentDraft]);

    const clearRoutineDraft = (): boolean => {
        try {
            assertCurrentDraft();
            draftRaw.current = writeWorkoutRecoveryDraft(ROUTINE_DRAFT_KEY, draftOwner, null, draftSession.consentGeneration, draftRaw.current);
            return true;
        } catch (error) {
            blockRoutineDraft(error, draftSession);
            return false;
        }
    };

    const handleRoutineClick = (id: string) => {
        setExpandedRoutineId(prev => prev === id ? null : id);
    };

    const handleDuplicate = async (rtn: WorkoutRoutine) => {
        if (!isCurrentSession(draftSession)) return;
        try {
            const operation = buildRoutineDuplicateOperation(rtn, routines, Logic.generateId('rtn'));
            await dispatchDurableOperation(dispatchDomainOperation, operation);
        } catch (err) {
            console.error(err);
            if (isCurrentSession(draftSession)) await showAlert('Errore durante la duplicazione della scheda.');
        }
    };

    const handleEditClick = (rtn: WorkoutRoutine) => {
        setEditingRoutineId(rtn.id);
        setRoutineName(rtn.name);
        setRoutineExercises(rtn.exercises || []);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        if (!clearRoutineDraft()) return false;
        setEditingRoutineId(null);
        setRoutineName('');
        setRoutineExercises([]);
        return true;
    };

    const handleSave = async (e?: { preventDefault: () => void }) => {
        if (e) e.preventDefault();
        const validationError = routineDraftValidationError(routineName, routineExercises);
        if (validationError) {
            await showAlert(validationError);
            return false;
        }

        try {
            assertCurrentDraft();
        } catch {
            await showAlert("Errore durante il salvataggio della scheda.");
            return false;
        }

        // A durable commit can finish after this form receives a newer edit.
        // Its cleanup may only consume the exact draft submitted with this save.
        const submittedDraftRaw = draftRaw.current;
        try {
            const operations = buildRoutineSaveOperations({
                name: routineName,
                exercises: routineExercises,
                routines,
                editingRoutineId,
                createId: editingRoutineId ? undefined : Logic.generateId('rtn'),
            });
            await dispatchDurableOperation(dispatchDomainOperation, operations);

            if (!isCurrentSession(draftSession)) return false;
            if (draftRaw.current !== submittedDraftRaw) {
                await showAlert('Una versione della scheda è stata salvata, ma ci sono modifiche successive ancora da salvare.');
                return false;
            }
            const cleared = clearRoutineDraft();
            if (!isCurrentSession(draftSession)) return false;
            setRoutineName('');
            setRoutineExercises([]);
            setEditingRoutineId(null);
            if (!cleared) {
                await showAlert('Scheda salvata, ma la bozza cifrata non è stata ripulita. Verifica il recupero locale.');
            }
            return true;
        } catch {
            // A rejected business commit does not mean the encrypted recovery draft failed.
            // Preserve it for retry without fencing unrelated local persistence.
            if (isCurrentSession(draftSession)) await showAlert("Errore durante il salvataggio della scheda.");
            return false;
        }
    };

    const handleDelete = async (id: string, e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        if (!isCurrentSession(draftSession)) return;
        if (!(await showConfirm("Sei sicuro di voler eliminare questa scheda?"))) return;
        // The confirmed action cannot be transferred to a replacement Auth epoch.
        if (!isCurrentSession(draftSession)) return;
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'routine.delete', id });
            if (!isCurrentSession(draftSession)) return;
            if (editingRoutineId === id) handleCancelEdit();
        } catch {
            if (isCurrentSession(draftSession)) await showAlert("Errore durante l'eliminazione della scheda.");
        }
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
