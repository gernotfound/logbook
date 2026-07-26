import React from 'react';
import MuscleModel from './MuscleModel';
import { useTrainingRoutines } from '../../hooks/useTrainingRoutines';

const TrainingRoutines = () => {
    const {
        routineName, setRoutineName,
        editingRoutineId, setEditingRoutineId,
        routines, library,
        handleCreate, handleDelete,
        handleAddExerciseToRoutine, handleUpdateSetsCount,
        handleRemoveExerciseFromRoutine, moveExercise
    } = useTrainingRoutines();

    return (
        <div className="training-sub-view active">
            <div className="card">
                <h3>Crea Nuova Scheda</h3>
                <input 
                    type="text" 
                    placeholder="Nome Scheda (es. Push Day, Full Body)" 
                    value={routineName}
                    onChange={e => setRoutineName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
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
                                            {(rtn.exercises || []).length} esercizi
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '1.2rem' }}>{isEditing ? '🔼' : '🔽'}</span>
                                        <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={(e) => handleDelete(rtn.id, e)}>🗑️</button>
                                    </div>
                                </div>
                                
                                {isEditing && (() => {
                                    const routineMuscles = new Set();
                                    (rtn.exercises || []).forEach(ex => {
                                        const libDef = library.find(l => l.id === ex.exId);
                                        if (libDef && libDef.muscles) {
                                            libDef.muscles.forEach(mId => routineMuscles.add(mId));
                                        }
                                    });
                                    const routineSelectedMuscles = Array.from(routineMuscles);

                                    return (
                                        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
                                            {(rtn.exercises || []).length > 0 && (
                                                <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'center' }}>
                                                    <MuscleModel selectedMuscles={routineSelectedMuscles} />
                                                </div>
                                            )}
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
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Nessun esercizio presente. Aggiungine uno dalla libreria!</p>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {(rtn.exercises || []).map((ex, index) => {
                                                    const libDef = library.find(l => l.id === ex.exId);
                                                    return (
                                                        <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', gap: '10px' }}>
                                                            <div style={{ fontSize: '0.95rem', flex: 1 }}>
                                                                {index + 1}. {libDef ? libDef.name : 'Esercizio Rimosso'}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem' }}>
                                                                <label style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Serie:</label>
                                                                <input 
                                                                    type="number" min="1" max="20"
                                                                    value={ex.setsCount || 3}
                                                                    onChange={e => handleUpdateSetsCount(rtn.id, index, e.target.value)}
                                                                    style={{ width: '50px', margin: 0, padding: '4px', textAlign: 'center' }}
                                                                    onClick={e => e.stopPropagation()}
                                                                />
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                                <button className="btn-icon" disabled={index === 0} style={{ opacity: index === 0 ? 0.3 : 1 }} onClick={() => moveExercise(rtn.id, index, 'up')}>⬆️</button>
                                                                <button className="btn-icon" disabled={index === (rtn.exercises || []).length - 1} style={{ opacity: index === (rtn.exercises || []).length - 1 ? 0.3 : 1 }} onClick={() => moveExercise(rtn.id, index, 'down')}>⬇️</button>
                                                                <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => handleRemoveExerciseFromRoutine(rtn.id, index)}>❌</button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TrainingRoutines;
