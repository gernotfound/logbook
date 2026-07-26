import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Logic } from '../../lib/logic';
import MuscleModel from './MuscleModel';

const TrainingExercises = () => {
    const { userData, saveUserData } = useAuth();
    const [editingExId, setEditingExId] = useState(null);
    const [exName, setExName] = useState('');
    const [exNotes, setExNotes] = useState('');
    const [muscleSearch, setMuscleSearch] = useState('');
    const [selectedMuscles, setSelectedMuscles] = useState([]);

    const library = userData?.library || [];

    const filteredMuscles = Logic.MUSCLES.filter(m => 
        m.name.toLowerCase().includes(muscleSearch.toLowerCase())
    ).slice(0, 5);

    const toggleMuscle = (muscle) => {
        if (selectedMuscles.find(m => m.id === muscle.id)) {
            setSelectedMuscles(selectedMuscles.filter(m => m.id !== muscle.id));
        } else {
            setSelectedMuscles([...selectedMuscles, muscle]);
        }
    };

    const handleEditClick = (ex) => {
        setEditingExId(ex.id);
        setExName(ex.name || '');
        setExNotes(ex.notes || '');
        
        // Populate selected muscles
        const exMuscles = [];
        (ex.muscles || []).forEach(mId => {
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

    const handleSave = () => {
        if (!exName.trim()) {
            alert("Inserisci un nome per l'esercizio.");
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
                        muscles: selectedMuscles.map(m => m.id)
                    };
                }
                return ex;
            });
            updatedLibrary.sort((a,b) => a.name.localeCompare(b.name));
            alert("Esercizio aggiornato!");
        } else {
            // Create new
            const newEx = {
                id: 'ex_' + new Date().getTime(),
                name: exName.trim(),
                notes: exNotes.trim(),
                muscles: selectedMuscles.map(m => m.id)
            };
            updatedLibrary = [...library, newEx].sort((a,b) => a.name.localeCompare(b.name));
            alert("Esercizio aggiunto all'archivio!");
        }

        saveUserData({ ...userData, library: updatedLibrary });
        handleCancelEdit(); // Reset form
    };

    const handleDelete = (id, e) => {
        e.stopPropagation(); // prevent triggering edit when clicking delete
        if(confirm("Sei sicuro di voler eliminare questo esercizio dall'archivio?")) {
            const updatedLibrary = library.filter(ex => ex.id !== id);
            saveUserData({ ...userData, library: updatedLibrary });
            if (editingExId === id) handleCancelEdit();
        }
    };

    return (
        <div className="training-sub-view active">
            <div className="card" style={{ border: editingExId ? '2px solid var(--primary-color)' : 'none' }}>
                <h3 style={{ color: editingExId ? 'var(--primary-color)' : 'white' }}>
                    {editingExId ? 'Modifica Esercizio' : 'Nuovo Esercizio'}
                </h3>
                <input 
                    type="text" 
                    placeholder="Nome Esercizio (es. Panca Piana)" 
                    value={exName}
                    onChange={e => setExName(e.target.value)}
                />
                <input 
                    type="text" 
                    placeholder="Note Setup (es. Inclinazione panca)" 
                    value={exNotes}
                    onChange={e => setExNotes(e.target.value)}
                />
                
                <div style={{ margin: '15px 0' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Muscoli Focus</label>
                    <input 
                        type="text" 
                        placeholder="Cerca muscolo (es. Petto)..." 
                        value={muscleSearch}
                        onChange={e => setMuscleSearch(e.target.value)}
                    />
                    
                    {muscleSearch && (
                        <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'var(--surface-color)', border: '1px solid var(--glass-border)', borderRadius: '8px', marginBottom: '10px' }}>
                            {filteredMuscles.map(m => (
                                <div 
                                    key={m.id} 
                                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--glass-border)' }}
                                    onClick={() => toggleMuscle(m)}
                                >
                                    {m.name}
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '15px' }}>
                        {selectedMuscles.map(m => (
                            <span key={m.id} className="badge badge-primary" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                {m.name}
                                <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={() => toggleMuscle(m)}>✕</span>
                            </span>
                        ))}
                    </div>

                    {/* Modello Muscolare 3D-like (SVG) */}
                    <MuscleModel selectedMuscles={selectedMuscles.map(m => m.id)} />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    {editingExId && (
                        <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={handleCancelEdit}>
                            Annulla
                        </button>
                    )}
                    <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave}>
                        {editingExId ? '💾 Salva Modifiche' : '+ Aggiungi in Archivio'}
                    </button>
                </div>
            </div>

            <h3 style={{ marginTop: '20px' }}>Lista Esercizi ({library.length})</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Clicca su un esercizio per modificarlo.</p>
            {library.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessun esercizio creato.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {library.map(ex => (
                        <div 
                            key={ex.id} 
                            className="card" 
                            style={{ padding: '15px', marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderLeft: editingExId === ex.id ? '3px solid var(--primary-color)' : 'none' }}
                            onClick={() => handleEditClick(ex)}
                        >
                            <div>
                                <div style={{ fontWeight: 'bold', color: editingExId === ex.id ? 'var(--primary-color)' : 'white' }}>{ex.name}</div>
                                {ex.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ex.notes}</div>}
                            </div>
                            <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={(e) => handleDelete(ex.id, e)}>🗑️</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrainingExercises;
