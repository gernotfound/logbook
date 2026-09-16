import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { getInMemoryCatalog } from '../lib/catalog/catalogService';
import {
    filterMuscles,
    getExpandedMuscleIds,
    toggleSmartMuscleSelection
} from './trainingExercises/muscleSelection';
import {
    clearExerciseDraft,
    persistExerciseDraft,
    readExerciseDraft,
    type ExerciseTrackingType
} from './trainingExercises/exerciseDraft';

const EMPTY_ARRAY: any[] = [];

export function useTrainingExercises() {
    const library = useAppStore(state => state.userData?.library || EMPTY_ARRAY);
    const routines = useAppStore(state => state.userData?.routines || EMPTY_ARRAY);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [editingExId, setEditingExId] = useState<string | null>(null);
    const [exName, setExName] = useState('');
    const [exNotes, setExNotes] = useState('');
    const [muscleSearch, setMuscleSearch] = useState('');
    const [selectedMuscles, setSelectedMuscles] = useState<any[]>([]);
    const [secondaryMuscles, setSecondaryMuscles] = useState<any[]>([]);
    const [selectionMode, setSelectionMode] = useState<'primary' | 'secondary'>('primary');
    const [trackingType, setTrackingType] = useState<ExerciseTrackingType>('weight_reps');
    const [isBodyweight, setIsBodyweight] = useState(false);
    const [equipmentWeight, setEquipmentWeight] = useState('');

    // Restore draft on mount
    useEffect(() => {
        const parsed = readExerciseDraft();
        if (parsed) {
            if (parsed.name) setExName(parsed.name);
            if (parsed.notes) setExNotes(parsed.notes);
            if (parsed.trackingType) setTrackingType(parsed.trackingType);
            if (parsed.selectedMuscles) setSelectedMuscles(parsed.selectedMuscles);
            if (parsed.secondaryMuscles) setSecondaryMuscles(parsed.secondaryMuscles);
            if (parsed.isBodyweight !== undefined) setIsBodyweight(Boolean(parsed.isBodyweight));
            if (parsed.equipmentWeight !== undefined && parsed.equipmentWeight !== null) {
                setEquipmentWeight(String(parsed.equipmentWeight));
            }
        }
    }, []);

    // Save draft on change
    useEffect(() => {
        if (!editingExId) {
            persistExerciseDraft({
                name: exName,
                notes: exNotes,
                trackingType,
                selectedMuscles,
                secondaryMuscles,
                isBodyweight,
                equipmentWeight
            });
        }
    }, [exName, exNotes, trackingType, selectedMuscles, secondaryMuscles, isBodyweight, equipmentWeight, editingExId]);

    const filteredMuscles = useMemo(() => filterMuscles(muscleSearch), [muscleSearch]);

    const toggleMuscle = (muscle: any) => {
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

    const handleDuplicate = async (ex: any) => {
        const newName = Logic.generateUniqueName(ex.name, library.map(l => l.name));
        const duplicated = {
            ...ex,
            id: Logic.generateId('ex'),
            name: newName,
            isDefault: false
        };
        try {
            await dispatchDomainOperation({ type: 'exercise.upsert', exercise: duplicated });
        } catch (err) {
            console.error(err);
        }
    };

    const handleEditClick = (ex: any) => {
        setEditingExId(ex.id);
        setExName(ex.name || '');
        setExNotes(ex.notes || '');

        // Populate selected muscles
        const exMuscles: any[] = [];
        (ex.muscles || []).forEach((mId: string) => {
            const m = Logic.MUSCLES.find(mu => mu.id === mId);
            if (m) exMuscles.push(m);
        });
        setSelectedMuscles(exMuscles);

        // Populate secondary muscles
        const exSecMuscles: any[] = [];
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
        clearExerciseDraft();
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
                        muscles: selectedMuscles.map((m: any) => m.id),
                        secondaryMuscles: secondaryMuscles.map((m: any) => m.id),
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
                muscles: selectedMuscles.map((m: any) => m.id),
                secondaryMuscles: secondaryMuscles.map((m: any) => m.id),
                trackingType,
                setsCount: 3,
                sets: [],
                isBodyweight: isBodyweight || undefined,
                equipmentWeight: validEqWeight
            };
            updatedLibrary = [...library, newEx].sort((a, b) => a.name.localeCompare(b.name));
        }

        try {
            const savedExercise = editingExId
                ? updatedLibrary.find(ex => ex.id === editingExId)
                : updatedLibrary.find(ex => !library.some(current => current.id === ex.id));
            if (!savedExercise) throw new Error('Esercizio non trovato dopo la modifica');
            await dispatchDomainOperation({ type: 'exercise.upsert', exercise: savedExercise });
            handleCancelEdit(); // Reset form
            return true;
        } catch {
            showAlert("Errore durante il salvataggio dell'esercizio.");
            return false;
        }
    };

    const handleDelete = async (id: string, e: any) => {
        e.stopPropagation(); // prevent triggering edit when clicking delete

        // Check if exercise is used in routines
        const usedInRoutines = routines.filter(rtn =>
            (rtn.exercises || []).some((ex: any) => ex.exId === id)
        );

        let confirmMsg = "Sei sicuro di voler eliminare questo esercizio dall'archivio?";
        if (usedInRoutines.length > 0) {
            confirmMsg = `Attenzione: questo esercizio è usato in ${usedInRoutines.length} scheda/e. Se lo elimini scomparirà da quelle schede. Procedere comunque?`;
        }

        if (await showConfirm(confirmMsg)) {
            try {
                await dispatchDomainOperation({ type: 'exercise.delete', id });
                if (editingExId === id) handleCancelEdit();
            } catch {
                showAlert("Errore durante l'eliminazione dell'esercizio.");
            }
        }
    };

    const handleRestoreExercise = async (id: string) => {
        const catalog = getInMemoryCatalog(true);
        const originalEx = catalog.exercises.find(e => e.id === id);
        if (!originalEx) {
            showAlert("Errore: esercizio originale non trovato.");
            return;
        }

        if (await showConfirm("Vuoi ripristinare questo esercizio ai valori originali? Le tue modifiche andranno perse.")) {
            try {
                await dispatchDomainOperation({
                    type: 'exercise.upsert',
                    exercise: {
                        ...originalEx,
                        setsCount: originalEx.setsCount ?? 3,
                        sets: []
                    } as any
                });
                // Aggiorna anche il form corrente se è aperto
                if (editingExId === id) {
                    handleEditClick(originalEx);
                }
            } catch {
                showAlert("Errore durante il ripristino dell'esercizio.");
            }
        }
    };

    return {
        editingExId, exName, setExName, exNotes, setExNotes,
        muscleSearch, setMuscleSearch, selectedMuscles, secondaryMuscles,
        selectionMode, setSelectionMode, isDuplicateName,
        library, routines, filteredMuscles, trackingType, setTrackingType,
        isBodyweight, setIsBodyweight, equipmentWeight, setEquipmentWeight,
        toggleMuscle, handleToggleMuscleById, handleEditClick, handleCancelEdit,
        handleSaveExercise, handleDelete, handleRestoreExercise, handleDuplicate
    };
}
