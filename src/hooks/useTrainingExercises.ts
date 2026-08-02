import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

export function useTrainingExercises() {
    const userData = useAppStore(state => state.userData);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [editingExId, setEditingExId] = useState<string | null>(null);
    const [exName, setExName] = useState('');
    const [exNotes, setExNotes] = useState('');
    const [muscleSearch, setMuscleSearch] = useState('');
    const [selectedMuscles, setSelectedMuscles] = useState<any[]>([]);
    const [secondaryMuscles, setSecondaryMuscles] = useState<any[]>([]);
    const [selectionMode, setSelectionMode] = useState<'primary' | 'secondary'>('primary');
    const [trackingType, setTrackingType] = useState<'weight_reps' | 'time'>('weight_reps');

    const library = userData?.library || [];

    // Restore draft on mount
    useEffect(() => {
        const draft = localStorage.getItem('draft_exercise');
        if (draft) {
            try {
                const parsed = JSON.parse(draft);
                if (parsed.name) setExName(parsed.name);
                if (parsed.notes) setExNotes(parsed.notes);
                if (parsed.trackingType) setTrackingType(parsed.trackingType);
                if (parsed.selectedMuscles) setSelectedMuscles(parsed.selectedMuscles);
                if (parsed.secondaryMuscles) setSecondaryMuscles(parsed.secondaryMuscles);
            } catch (e) {}
        }
    }, []);

    // Save draft on change
    useEffect(() => {
        if (!editingExId) {
            try {
                localStorage.setItem('draft_exercise', JSON.stringify({ 
                    name: exName, 
                    notes: exNotes, 
                    trackingType, 
                    selectedMuscles,
                    secondaryMuscles
                }));
            } catch (e) {
                console.warn("Quota exceeded or error saving draft", e);
            }
        }
    }, [exName, exNotes, trackingType, selectedMuscles, secondaryMuscles, editingExId]);

    const filteredMuscles = useMemo(() => {
        return Logic.MUSCLES.filter(m => 
            m.name.toLowerCase().includes(muscleSearch.toLowerCase())
        ).slice(0, 5);
    }, [muscleSearch]);

    const toggleSmartMuscleSelection = (currentSelection: any[], toggledMuscle?: any) => {
        const expanded = new Set<string>();
        for (const m of currentSelection || []) {
            if (!m || !m.id) continue;
            const leftId = m.id + '_left';
            const rightId = m.id + '_right';
            if (Logic.MUSCLES.find(x => x.id === leftId) && Logic.MUSCLES.find(x => x.id === rightId)) {
                expanded.add(leftId);
                expanded.add(rightId);
            } else {
                expanded.add(m.id);
            }
        }
        
        if (toggledMuscle && toggledMuscle.id) {
            const toggledIds: string[] = [];
            const tLeftId = toggledMuscle.id + '_left';
            const tRightId = toggledMuscle.id + '_right';
            if (Logic.MUSCLES.find(x => x.id === tLeftId) && Logic.MUSCLES.find(x => x.id === tRightId)) {
                toggledIds.push(tLeftId, tRightId);
            } else {
                toggledIds.push(toggledMuscle.id);
            }

            const allSelected = toggledIds.every(id => expanded.has(id));
            if (allSelected) {
                toggledIds.forEach(id => expanded.delete(id));
            } else {
                toggledIds.forEach(id => expanded.add(id));
            }
        }

        const finalIds = Array.from(expanded).filter((id): id is string => typeof id === 'string' && Boolean(id));
        let changed = true;
        let maxIter = 100;
        while (changed && maxIter-- > 0) {
            changed = false;
            for (let i = 0; i < finalIds.length; i++) {
                const id = finalIds[i];
                if (id && (id.endsWith('_left') || id.endsWith('_right'))) {
                    const baseId = id.replace(/_(left|right)$/, '');
                    const counterpart = id.endsWith('_left') ? `${baseId}_right` : `${baseId}_left`;
                    const cIndex = finalIds.indexOf(counterpart);
                    if (cIndex !== -1 && Logic.MUSCLES.find(x => x.id === baseId)) {
                        finalIds.splice(Math.max(i, cIndex), 1);
                        finalIds.splice(Math.min(i, cIndex), 1);
                        if (!finalIds.includes(baseId)) {
                            finalIds.push(baseId);
                        }
                        changed = true;
                        break;
                    }
                }
            }
        }

        return finalIds.map(id => Logic.MUSCLES.find(m => m.id === id)).filter(Boolean);
    };

    const getExpandedMuscleIds = (musclesList: any[]): Set<string> => {
        const set = new Set<string>();
        for (const m of musclesList || []) {
            if (!m || !m.id) continue;
            const leftId = m.id + '_left';
            const rightId = m.id + '_right';
            if (Logic.MUSCLES.find(x => x.id === leftId) && Logic.MUSCLES.find(x => x.id === rightId)) {
                set.add(leftId);
                set.add(rightId);
            } else {
                set.add(m.id);
            }
        }
        return set;
    };

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

    const handleEditClick = (ex: any) => {
        setEditingExId(ex.id);
        setExName(ex.name || '');
        setExNotes(ex.notes || '');
        
        // Populate selected muscles
        const exMuscles: any[] = [];
        (ex.muscles || []).forEach((mId: string) => {
            const m = Logic.MUSCLES.find(mu => mu.id === mId);
            if(m) exMuscles.push(m);
        });
        setSelectedMuscles(exMuscles);

        // Populate secondary muscles
        const exSecMuscles: any[] = [];
        (ex.secondaryMuscles || []).forEach((mId: string) => {
            const m = Logic.MUSCLES.find(mu => mu.id === mId);
            if(m) exSecMuscles.push(m);
        });
        setSecondaryMuscles(exSecMuscles);

        setTrackingType(ex.trackingType || 'weight_reps');
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
        localStorage.removeItem('draft_exercise');
    };

    const handleSaveExercise = async () => {
        if (!exName.trim()) {
            await showAlert("Inserisci un nome per l'esercizio.");
            return;
        }

        let updatedLibrary;

        if (editingExId) {
            // Update existing
            updatedLibrary = library.map(ex => {
                if (ex.id === editingExId) {
                    return {
                        ...ex,
                        name: exName.trim(),
                        notes: exNotes.trim(),
                        muscles: selectedMuscles.map((m: any) => m.id),
                        secondaryMuscles: secondaryMuscles.map((m: any) => m.id),
                        trackingType
                    };
                }
                return ex;
            });
            updatedLibrary.sort((a,b) => a.name.localeCompare(b.name));
        } else {
            // Create new
            const newEx = {
                id: Logic.generateId('ex'),
                name: exName.trim(),
                notes: exNotes.trim(),
                muscles: selectedMuscles.map((m: any) => m.id),
                secondaryMuscles: secondaryMuscles.map((m: any) => m.id),
                trackingType,
                setsCount: 3,
                sets: []
            };
            updatedLibrary = [...library, newEx].sort((a,b) => a.name.localeCompare(b.name));
        }

        try {
            await saveUserData({ ...userData, library: updatedLibrary });
            handleCancelEdit(); // Reset form
        } catch {
            showAlert("Errore durante il salvataggio dell'esercizio.");
        }
    };

    const handleDelete = async (id: string, e: any) => {
        e.stopPropagation(); // prevent triggering edit when clicking delete
        
        // Check if exercise is used in routines
        const usedInRoutines = (userData?.routines || []).filter(rtn => 
            (rtn.exercises || []).some(ex => ex.exId === id)
        );
        
        let confirmMsg = "Sei sicuro di voler eliminare questo esercizio dall'archivio?";
        if (usedInRoutines.length > 0) {
            confirmMsg = `Attenzione: questo esercizio è usato in ${usedInRoutines.length} scheda/e. Se lo elimini scomparirà da quelle schede. Procedere comunque?`;
        }

        if(await showConfirm(confirmMsg)) {
            const updatedLibrary = library.filter(ex => ex.id !== id);
            try {
                await saveUserData({ ...userData, library: updatedLibrary });
                if (editingExId === id) handleCancelEdit();
            } catch {
                showAlert("Errore durante l'eliminazione dell'esercizio.");
            }
        }
    };

    return {
        editingExId, exName, setExName, exNotes, setExNotes,
        muscleSearch, setMuscleSearch, selectedMuscles, secondaryMuscles,
        selectionMode, setSelectionMode,
        library, filteredMuscles, trackingType, setTrackingType,
        toggleMuscle, handleToggleMuscleById, handleEditClick, handleCancelEdit,
        handleSaveExercise, handleDelete
    };
}
