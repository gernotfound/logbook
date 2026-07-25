import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const TrainingRoutines = () => {
    const { userData, saveUserData } = useAuth();
    const [routineName, setRoutineName] = useState('');
    const [editingRoutineId, setEditingRoutineId] = useState(null);

    const routines = userData?.routines || [];
    const library = userData?.library || [];

    const handleCreate = () => {
        if (!routineName.trim()) {
            alert("Inserisci il nome della scheda");
            return;
        }

        const newRoutine = {
            id: 'rtn_' + new Date().getTime(),
            name: routineName.trim(),
            exercises: []
        };

        const updatedRoutines = [...routines, newRoutine].sort((a,b) => a.name.localeCompare(b.name));
        saveUserData({ ...userData, routines: updatedRoutines });
        setRoutineName('');
        setEditingRoutineId(newRoutine.id); // Open it for editing immediately
    };

    const handleDelete = (id, e) => {
        e.stopPropagation(); // prevent expanding
        if (confirm("Vuoi davvero eliminare questa scheda?")) {
            const updatedRoutines = routines.filter(r => r.id !== id);
            saveUserData({ ...userData, routines: updatedRoutines });
            if (editingRoutineId === id) setEditingRoutineId(null);
        }
    };

    const handleAddExerciseToRoutine = (routineId, exId) => {
        if (!exId) return;
        const routine = routines.find(r => r.id === routineId);
        if (!routine) return;

        const updatedRoutines = routines.map(r => {
            if (r.id === routineId) {
                return {
                    ...r,
                    exercises: [...(r.exercises || []), { exId }]
                };
            }
            return r;
        });
        saveUserData({ ...userData, routines: updatedRoutines });
    };

    const handleRemoveExerciseFromRoutine = (routineId, indexToRemove) => {
        const updatedRoutines = routines.map(r => {
            if (r.id === routineId) {
                return {
                    ...r,
                    exercises: (r.exercises || []).filter((_, idx) => idx !== indexToRemove)
                };
            }
            return r;
        });
        saveUserData({ ...userData, routines: updatedRoutines });
    };

    const moveExercise = (routineId, index, direction) => {
        const routine = routines.find(r => r.id === routineId);
        if (!routine) return;
        
        const newExercises = [...(routine.exercises || [])];
        if (direction === 'up' && index > 0) {
            const temp = newExercises[index];
            newExercises[index] = newExercises[index - 1];
            newExercises[index - 1] = temp;
        } else if (direction === 'down' && index < newExercises.length - 1) {
            const temp = newExercises[index];
            newExercises[index] = newExercises[index + 1];
            newExercises[index + 1] = temp;
        } else {
            return;
        }

        const updatedRoutines = routines.map(r => {
            if (r.id === routineId) {
                return { ...r, exercises: newExercises };
            }
            return r;
        });
        saveUserData({ ...userData, routines: updatedRoutines });
    };

    return (
        <div className="training-sub-view active">
            <div className="card">
                <h3>Crea Nuova Scheda</h3>
                <input 
                    type="text" 
                    placeholder="Nome Scheda (es. Push Day, Full Body)" 
                    value={routineName}
                    onChange={e => setRoutineName(e.target.value)}
                />
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={handleCreate}>
                    ➕ Salva Nuova Scheda
                </button>
            </div>

            <h3 style={{ marginTop: '20px' }}>Archivio Schede ({routines.length})</h3>
            {routines.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessuna scheda creata.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {routines.map(rtn => {
                        const isEditing = editingRoutineId === rtn.id;
                        return (
                            <div key={rtn.id} className="card" style={{ padding: '15px', marginBottom: 0 }}>
                                <div 
                                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                                    onClick={() => setEditingRoutineId(isEditing ? null : rtn.id)}
                                >
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: isEditing ? 'var(--primary-color)' : 'white' }}>
                                            {rtn.name}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                            {(rtn.exercises || []).length} esercizi {isEditing ? ' (Modifica in corso)' : ''}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button className="btn-icon" style={{ fontSize: '1.2rem' }}>
                                            {isEditing ? '⬆️' : '⬇️'}
                                        </button>
                                        <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={(e) => handleDelete(rtn.id, e)}>🗑️</button>
                                    </div>
                                </div>
                                
                                {isEditing && (
                                    <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
                                        <div style={{ marginBottom: '15px' }}>
                                            <select 
                                                onChange={(e) => {
                                                    handleAddExerciseToRoutine(rtn.id, e.target.value);
                                                    e.target.value = '';
                                                }}
                                                style={{ width: '100%', padding: '10px', background: 'var(--surface-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px' }}
                                            >
                                                <option value="">+ Aggiungi Esercizio dalla Libreria</option>
                                                {library.map(l => (
                                                    <option key={l.id} value={l.id}>{l.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {(rtn.exercises || []).length === 0 ? (
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Nessun esercizio presente in questa scheda.</p>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {(rtn.exercises || []).map((ex, index) => {
                                                    const libDef = library.find(l => l.id === ex.exId);
                                                    return (
                                                        <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                                                            <div style={{ fontSize: '0.95rem' }}>
                                                                {index + 1}. {libDef ? libDef.name : 'Esercizio Rimosso'}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '5px' }}>
                                                                <button className="btn-icon" disabled={index === 0} style={{ opacity: index === 0 ? 0.3 : 1 }} onClick={() => moveExercise(rtn.id, index, 'up')}>⬆️</button>
                                                                <button className="btn-icon" disabled={index === (rtn.exercises || []).length - 1} style={{ opacity: index === (rtn.exercises || []).length - 1 ? 0.3 : 1 }} onClick={() => moveExercise(rtn.id, index, 'down')}>⬇️</button>
                                                                <button className="btn-icon" style={{ color: 'var(--danger-color)', marginLeft: '10px' }} onClick={() => handleRemoveExerciseFromRoutine(rtn.id, index)}>❌</button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TrainingRoutines;
