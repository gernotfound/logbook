import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { Exercise, WorkoutRoutine } from '../types';
import type { MuscleDef } from '../lib/constants/muscles';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { getInMemoryCatalog } from '../lib/catalog/catalogService';
import {
    filterMuscles,
    getExpandedMuscleIds,
    toggleSmartMuscleSelection
} from './trainingExercises/muscleSelection';
import {
    clearExerciseDraft,
    persistExerciseDraft,
    readExerciseDraftImage,
    type ExerciseTrackingType
} from './trainingExercises/exerciseDraft';

const EMPTY_LIBRARY: Exercise[] = [];
const EMPTY_ROUTINES: WorkoutRoutine[] = [];

function blockExerciseDraft(error: unknown, session: ReturnType<typeof captureSession>): void {
    if (!isCurrentSession(session)) return;
    console.error('Persistenza bozza esercizio non disponibile:', error);
    useAppStore.setState({
        localPersistenceBlocked: true,
        syncHealth: 'failed',
        syncPresentation: 'normal',
        saveError: 'Bozza esercizio non verificabile o non salvata: originale conservato. Riapri TheLogBook per verificare il recupero.',
    });
}

export function useTrainingExercises() {
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const routines = useAppStore(state => state.userData?.routines || EMPTY_ROUTINES);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const persistExercise = async (operation: Parameters<typeof dispatchDomainOperation>[0]) => {
        const result = await dispatchDomainOperation(operation);
        if (!result.ok && result.status !== 'local-pending') {
            throw result.error instanceof Error ? result.error : new Error('Operazione esercizio non completata');
        }
    };
    const [draftSession] = useState(() => captureSession());
    const draftOwner = draftSession.owner;
    const [initialRecovery] = useState(() => {
        try { return { ...readExerciseDraftImage(draftOwner), error: null as unknown }; }
        catch (error) { return { draft: null, raw: null, error }; }
    });
    const initialDraft = initialRecovery.draft;
    const draftRaw = useRef<string | null>(initialRecovery.raw);
    const localPersistenceBlocked = useAppStore(state => state.localPersistenceBlocked);
    const assertCurrentDraft = useCallback(() => {
        if (initialRecovery.error || localPersistenceBlocked || !isCurrentSession(draftSession)) {
            throw new Error('Sessione, consenso o bozza esercizio non più verificabili.');
        }
        // Owner and consent can match even when a second editor has replaced
        // the canonical draft. Keep the exact image observed by this form.
        if (readExerciseDraftImage(draftOwner).raw !== draftRaw.current) {
            throw new Error('Bozza esercizio modificata da un’altra scheda: originale conservato.');
        }
    }, [draftOwner, draftSession, initialRecovery.error, localPersistenceBlocked]);
    useEffect(() => {
        if (initialRecovery.error) blockExerciseDraft(initialRecovery.error, draftSession);
    }, [initialRecovery.error, draftSession]);
    const [editingExId, setEditingExId] = useState<string | null>(null);
    const [exName, setExName] = useState(() => initialDraft?.name || '');
    const [exNotes, setExNotes] = useState(() => initialDraft?.notes || '');
    const [muscleSearch, setMuscleSearch] = useState('');
    const [selectedMuscles, setSelectedMuscles] = useState<MuscleDef[]>(() => initialDraft?.selectedMuscles || []);
    const [secondaryMuscles, setSecondaryMuscles] = useState<MuscleDef[]>(() => initialDraft?.secondaryMuscles || []);
    const [selectionMode, setSelectionMode] = useState<'primary' | 'secondary'>('primary');
    const [trackingType, setTrackingType] = useState<ExerciseTrackingType>(() => initialDraft?.trackingType || 'weight_reps');
    const [isBodyweight, setIsBodyweight] = useState(() => Boolean(initialDraft?.isBodyweight));
    const [equipmentWeight, setEquipmentWeight] = useState(() => initialDraft?.equipmentWeight == null ? '' : String(initialDraft.equipmentWeight));

    // Save draft on change
    useEffect(() => {
        if (editingExId || initialRecovery.error || localPersistenceBlocked) return;
        try {
            assertCurrentDraft();
            draftRaw.current = persistExerciseDraft({
                name: exName,
                notes: exNotes,
                trackingType,
                selectedMuscles,
                secondaryMuscles,
                isBodyweight,
                equipmentWeight,
            }, draftOwner, draftSession.consentGeneration, draftRaw.current);
        } catch (error) {
            blockExerciseDraft(error, draftSession);
        }
    }, [exName, exNotes, trackingType, selectedMuscles, secondaryMuscles, isBodyweight,
        equipmentWeight, editingExId, draftOwner, draftSession, initialRecovery.error,
        localPersistenceBlocked, assertCurrentDraft]);

    const filteredMuscles = useMemo(() => filterMuscles(muscleSearch), [muscleSearch]);

    const toggleMuscle = (muscle: MuscleDef) => {
        if (!muscle || !muscle.id) return;
        if (selectionMode === 'primary') {
            const newSelection = toggleSmartMuscleSelection(selectedMuscles, muscle);
            setSelectedMuscles(newSelection);

            // Remove toggled muscle from secondary if present
            const toggledIds = getExpandedMuscleIds([muscle]);
            const secExpanded = getExpandedMuscleIds(secondaryMuscles);
            toggledIds.forEach(id => secExpanded.delete(id));
            const remainingSecList = Array.from(secExpanded).map(id => ({ id }));
            setSecondaryMuscles(toggleSmartMuscleSelection(remainingSecList));
        } else {
            const newSelection = toggleSmartMuscleSelection(secondaryMuscles, muscle);
            setSecondaryMuscles(newSelection);

            // Remove toggled muscle from primary if present
            const toggledIds = getExpandedMuscleIds([muscle]);
            const primExpanded = getExpandedMuscleIds(selectedMuscles);
            toggledIds.forEach(id => primExpanded.delete(id));
            const remainingPrimList = Array.from(primExpanded).map(id => ({ id }));
            setSelectedMuscles(toggleSmartMuscleSelection(remainingPrimList));
        }
    };

    const handleToggleMuscleById = (muscleId: string) => {
        const m = Logic.MUSCLES.find(mu => mu.id === muscleId);
        if (m) {
            toggleMuscle(m);
        }
    };

    const removeMuscleById = (muscleId: string) => {
        const muscle = Logic.MUSCLES.find(candidate => candidate.id === muscleId);
        if (!muscle) return;

        const idsToRemove = getExpandedMuscleIds([muscle]);
        const removeFromSelection = (selection: MuscleDef[]) => {
            const expanded = getExpandedMuscleIds(selection);
            idsToRemove.forEach(id => expanded.delete(id));
            return toggleSmartMuscleSelection(Array.from(expanded).map(id => ({ id })));
        };

        setSelectedMuscles(current => removeFromSelection(current));
        setSecondaryMuscles(current => removeFromSelection(current));
    };

    const handleDuplicate = async (ex: Exercise) => {
        if (!isCurrentSession(draftSession)) return;
        const newName = Logic.generateUniqueName(ex.name, library.map(l => l.name));
        const duplicated = {
            ...ex,
            id: Logic.generateId('ex'),
            name: newName,
            isDefault: false
        };
        try {
            await persistExercise({ type: 'exercise.upsert', exercise: duplicated });
        } catch (err) {
            console.error(err);
        }
    };

    const handleEditClick = (ex: Exercise) => {
        setEditingExId(ex.id);
        setExName(ex.name || '');
        setExNotes(ex.notes || '');

        // Populate selected muscles
        const exMuscles: MuscleDef[] = [];
        (ex.muscles || []).forEach((mId: string) => {
            const m = Logic.MUSCLES.find(mu => mu.id === mId);
            if (m) exMuscles.push(m);
        });
        setSelectedMuscles(exMuscles);

        // Populate secondary muscles
        const exSecMuscles: MuscleDef[] = [];
        (ex.secondaryMuscles || []).forEach((mId: string) => {
            const m = Logic.MUSCLES.find(mu => mu.id === mId);
            if (m) exSecMuscles.push(m);
        });
        setSecondaryMuscles(exSecMuscles);

        setTrackingType(ex.trackingType || 'weight_reps');
        setIsBodyweight(Boolean(ex.isBodyweight));
        setEquipmentWeight(
            ex.equipmentWeight !== undefined && ex.equipmentWeight !== null
                ? String(ex.equipmentWeight)
                : ''
        );
        setSelectionMode('primary');

        // Scroll to top to see the form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        try {
            assertCurrentDraft();
            draftRaw.current = clearExerciseDraft(draftOwner, draftSession.consentGeneration, draftRaw.current);
        } catch (error) {
            blockExerciseDraft(error, draftSession);
            return false;
        }
        setEditingExId(null);
        setExName('');
        setExNotes('');
        setSelectedMuscles([]);
        setSecondaryMuscles([]);
        setMuscleSearch('');
        setSelectionMode('primary');
        setTrackingType('weight_reps');
        setIsBodyweight(false);
        setEquipmentWeight('');
        return true;
    };

    const isDuplicateName = useMemo(() => {
        const trimmed = exName.trim().toLowerCase();
        if (!trimmed) return false;
        return library.some(ex => ex.id !== editingExId && ex.name.trim().toLowerCase() === trimmed);
    }, [exName, library, editingExId]);

    const handleSaveExercise = async () => {
        const trimmedName = exName.trim();
        if (!trimmedName) {
            await showAlert("Inserisci un nome per l'esercizio.");
            return false;
        }

        const isDuplicate = library.some(ex =>
            ex.id !== editingExId &&
            ex.name.trim().toLowerCase() === trimmedName.toLowerCase()
        );

        if (isDuplicate) {
            await showAlert("Esiste già un esercizio con questo nome nell'archivio.");
            return false;
        }

        const parsedEqWeight = equipmentWeight
            ? parseFloat(String(equipmentWeight).replace(',', '.'))
            : undefined;
        const validEqWeight = (
            parsedEqWeight !== undefined &&
            !isNaN(parsedEqWeight) &&
            parsedEqWeight > 0
        ) ? parsedEqWeight : undefined;

        let updatedLibrary;

        if (editingExId) {
            // Update existing
            updatedLibrary = library.map(ex => {
                if (ex.id === editingExId) {
                    return {
                        ...ex,
                        name: trimmedName,
                        notes: exNotes.trim(),
                        muscles: selectedMuscles.map(m => m.id),
                        secondaryMuscles: secondaryMuscles.map(m => m.id),
                        trackingType,
                        isBodyweight: isBodyweight || undefined,
                        equipmentWeight: validEqWeight
                    };
                }
                return ex;
            });
            updatedLibrary.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            // Create new
            const newEx = {
                id: Logic.generateId('ex'),
                name: trimmedName,
                notes: exNotes.trim(),
                muscles: selectedMuscles.map(m => m.id),
                secondaryMuscles: secondaryMuscles.map(m => m.id),
                trackingType,
                setsCount: 3,
                sets: [],
                isBodyweight: isBodyweight || undefined,
                equipmentWeight: validEqWeight
            };
            updatedLibrary = [...library, newEx].sort((a, b) => a.name.localeCompare(b.name));
        }

        try {
            assertCurrentDraft();
        } catch (error) {
            blockExerciseDraft(error, draftSession);
            if (isCurrentSession(draftSession)) void showAlert("Errore durante il salvataggio dell\x27esercizio.");
            return false;
        }

        // A later edit in this same form must outlive an earlier business commit.
        const submittedDraftRaw = draftRaw.current;
        try {
            const savedExercise = editingExId
                ? updatedLibrary.find(ex => ex.id === editingExId)
                : updatedLibrary.find(ex => !library.some(current => current.id === ex.id));
            if (!savedExercise) throw new Error('Esercizio non trovato dopo la modifica');
            await persistExercise({ type: 'exercise.upsert', exercise: savedExercise });
            if (!isCurrentSession(draftSession)) return false;
            if (draftRaw.current !== submittedDraftRaw) {
                await showAlert('Una versione dell’esercizio è stata salvata, ma ci sono modifiche successive ancora da salvare.');
                return false;
            }
            const cleared = handleCancelEdit();
            if (!isCurrentSession(draftSession)) return false;
            if (!cleared) {
                await showAlert('Esercizio salvato, ma la bozza cifrata non è stata ripulita. Verifica il recupero locale.');
            }
            return true;
        } catch {
            if (isCurrentSession(draftSession)) void showAlert("Errore durante il salvataggio dell'esercizio.");
            return false;
        }
    };

    const handleDelete = async (id: string, e: any) => {
        e.stopPropagation();
        if (!isCurrentSession(draftSession)) return false;

        const exercise = library.find(item => item.id === id);
        if (exercise?.isDefault) {
            await showAlert("Gli esercizi del catalogo non possono essere eliminati.");
            return false;
        }

        const usedInRoutines = routines.filter(rtn =>
            (rtn.exercises || []).some(ex => ex.exId === id)
        );

        let confirmMsg = "Sei sicuro di voler eliminare questo esercizio dall'archivio?";
        if (usedInRoutines.length > 0) {
            confirmMsg = `Attenzione: questo esercizio è usato in ${usedInRoutines.length} scheda/e. Se lo elimini scomparirà da quelle schede. Procedere comunque?`;
        }

        if (!(await showConfirm(confirmMsg))) return false;
        // The same exercise ID in a later Auth epoch does not authorize the old deletion.
        if (!isCurrentSession(draftSession)) return false;

        try {
            await persistExercise({ type: 'exercise.delete', id });
            if (!isCurrentSession(draftSession)) return false;
            if (editingExId === id) handleCancelEdit();
            return true;
        } catch {
            if (isCurrentSession(draftSession)) await showAlert("Errore durante l'eliminazione dell'esercizio.");
            return false;
        }
    };

    const handleRestoreExercise = async (id: string) => {
        if (!isCurrentSession(draftSession)) return;
        const catalog = getInMemoryCatalog(true);
        const originalEx = catalog.exercises.find(e => e.id === id);
        if (!originalEx) {
            void showAlert("Errore: esercizio originale non trovato.");
            return;
        }

        if (await showConfirm("Vuoi ripristinare questo esercizio ai valori originali? Le tue modifiche andranno perse.")) {
            if (!isCurrentSession(draftSession)) return;
            try {
                const restoredExercise: Exercise = {
                    ...originalEx,
                    setsCount: originalEx.setsCount ?? 3,
                    sets: [],
                };
                await persistExercise({ type: 'exercise.upsert', exercise: restoredExercise });
                // Show the same typed exercise that was actually committed.
                if (!isCurrentSession(draftSession)) return;
                if (editingExId === id) {
                    handleEditClick(restoredExercise);
                }
            } catch {
                if (isCurrentSession(draftSession)) void showAlert("Errore durante il ripristino dell'esercizio.");
            }
        }
    };

    return {
        editingExId, exName, setExName, exNotes, setExNotes,
        muscleSearch, setMuscleSearch, selectedMuscles, secondaryMuscles,
        selectionMode, setSelectionMode, isDuplicateName,
        library, routines, filteredMuscles, trackingType, setTrackingType,
        isBodyweight, setIsBodyweight, equipmentWeight, setEquipmentWeight,
        toggleMuscle, handleToggleMuscleById, removeMuscleById, handleEditClick, handleCancelEdit,
        handleSaveExercise, handleDelete, handleRestoreExercise, handleDuplicate
    };
}
