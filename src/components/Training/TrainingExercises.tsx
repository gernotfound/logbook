import React from 'react';
import MuscleModel from './MuscleModel';
import { useTrainingExercises } from '../../hooks/useTrainingExercises';

const TrainingExercises = () => {
    const {
        editingExId, exName, setExName, exNotes, setExNotes,
        muscleSearch, setMuscleSearch, selectedMuscles,
        library, filteredMuscles,
        toggleMuscle, handleEditClick, handleCancelEdit,
        handleSave, handleDelete
    } = useTrainingExercises();

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
