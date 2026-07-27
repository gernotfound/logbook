import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

export function useTrainingExercises() {
    const { userData, saveUserData } = useAppStore();
    const { showAlert, showConfirm } = useDialogStore();
    const [editingExId, setEditingExId] = useState<string | null>(null);
    const [exName, setExName] = useState('');
    const [exNotes, setExNotes] = useState('');
    const [muscleSearch, setMuscleSearch] = useState('');
    const [selectedMuscles, setSelectedMuscles] = useState<any[]>([]);

    const library = userData?.library || [];

    const filteredMuscles = Logic.MUSCLES.filter(m => 
        m.name.toLowerCase().includes(muscleSearch.toLowerCase())
    ).slice(0, 5);

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
        
        // Scroll to top to see the form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingExId(null);
        setExName('');
        setExNotes('');
        setSelectedMuscles([]);
        setMuscleSearch('');
    };

    const handleSave = async () => {
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
                        muscles: selectedMuscles.map((m: any) => m.id)
                    };
                }
                return ex;
            });
            updatedLibrary.sort((a,b) => a.name.localeCompare(b.name));
            await showAlert("Esercizio aggiornato!");
        } else {
            // Create new
            const newEx = {
                id: 'ex_' + new Date().getTime(),
                name: exName.trim(),
                notes: exNotes.trim(),
                muscles: selectedMuscles.map((m: any) => m.id),
                setsCount: 3,
                sets: []
            };
            updatedLibrary = [...library, newEx].sort((a,b) => a.name.localeCompare(b.name));
            await showAlert("Esercizio aggiunto all'archivio!");
        }

        saveUserData({ ...userData, library: updatedLibrary });
        handleCancelEdit(); // Reset form
    };

    const handleDelete = async (id: string, e: any) => {
        e.stopPropagation(); // prevent triggering edit when clicking delete
        if(await showConfirm("Sei sicuro di voler eliminare questo esercizio dall'archivio?")) {
            const updatedLibrary = library.filter(ex => ex.id !== id);
            saveUserData({ ...userData, library: updatedLibrary });
            if (editingExId === id) handleCancelEdit();
        }
    };

    return {
        editingExId, exName, setExName, exNotes, setExNotes,
        muscleSearch, setMuscleSearch, selectedMuscles,
        library, filteredMuscles,
        toggleMuscle, handleEditClick, handleCancelEdit,
        handleSave, handleDelete
    };
}
