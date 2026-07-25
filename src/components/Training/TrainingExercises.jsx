import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Logic } from '../../lib/logic';

const TrainingExercises = () => {
    const { userData, saveUserData } = useAuth();
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

    const handleSave = () => {
        if (!exName.trim()) {
            alert("Inserisci un nome per l'esercizio.");
            return;
        }

        const newEx = {
            id: 'ex_' + new Date().getTime(),
            name: exName.trim(),
            notes: exNotes.trim(),
            muscles: selectedMuscles.map(m => m.id)
        };

        const updatedLibrary = [...library, newEx].sort((a,b) => a.name.localeCompare(b.name));
        saveUserData({ ...userData, library: updatedLibrary });
        
        setExName('');
        setExNotes('');
        setSelectedMuscles([]);
        setMuscleSearch('');
        alert("Esercizio aggiunto all'archivio!");
    };

    const handleDelete = (id) => {
        if(confirm("Sei sicuro di voler eliminare questo esercizio dall'archivio?")) {
            const updatedLibrary = library.filter(ex => ex.id !== id);
            saveUserData({ ...userData, library: updatedLibrary });
        }
    };

    return (
        <div className="training-sub-view active">
            <div className="card">
                <h3>Nuovo Esercizio</h3>
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
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave}>
                        + Aggiungi in Archivio
                    </button>
                </div>
            </div>

            <h3 style={{ marginTop: '20px' }}>Lista Esercizi ({library.length})</h3>
            {library.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessun esercizio creato.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {library.map(ex => (
                        <div key={ex.id} className="card" style={{ padding: '15px', marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontWeight: 'bold' }}>{ex.name}</div>
                                {ex.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ex.notes}</div>}
                            </div>
                            <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => handleDelete(ex.id)}>🗑️</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrainingExercises;
