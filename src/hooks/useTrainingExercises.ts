import { useState, useMemo } from 'react';
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
    const [trackingType, setTrackingType] = useState<'weight_reps' | 'time'>('weight_reps');

    const library = userData?.library || [];

    const filteredMuscles = useMemo(() => {
        return Logic.MUSCLES.filter(m => 
            m.name.toLowerCase().includes(muscleSearch.toLowerCase())
        ).slice(0, 5);
    }, [muscleSearch]);

    const toggleMuscle = (muscle: any) => {
        if (selectedMuscles.find((m: any) => m.id === muscle.id)) {
            setSelectedMuscles(selectedMuscles.filter((m: any) => m.id !== muscle.id));
        } else {
            setSelectedMuscles([...selectedMuscles, muscle]);
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
        setTrackingType(ex.trackingType || 'weight_reps');
        
        // Scroll to top to see the form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingExId(null);
        setExName('');
        setExNotes('');
        setSelectedMuscles([]);
        setMuscleSearch('');
        setTrackingType('weight_reps');
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
        if(await showConfirm("Sei sicuro di voler eliminare questo esercizio dall'archivio?")) {
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
        muscleSearch, setMuscleSearch, selectedMuscles,
        library, filteredMuscles, trackingType, setTrackingType,
        toggleMuscle, handleEditClick, handleCancelEdit,
        handleSaveExercise, handleDelete
    };
}
