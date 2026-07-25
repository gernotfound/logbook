import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const TrainingRoutines = () => {
    const { userData, saveUserData } = useAuth();
    const [routineName, setRoutineName] = useState('');

    const routines = userData?.routines || [];

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
        alert("Scheda creata!");
    };

    const handleDelete = (id) => {
        if (confirm("Vuoi davvero eliminare questa scheda?")) {
            const updatedRoutines = routines.filter(r => r.id !== id);
            saveUserData({ ...userData, routines: updatedRoutines });
        }
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
                    💾 Salva Nuova Scheda
                </button>
            </div>

            <h3 style={{ marginTop: '20px' }}>Archivio Schede ({routines.length})</h3>
            {routines.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessuna scheda creata.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {routines.map(rtn => (
                        <div key={rtn.id} className="card" style={{ padding: '15px', marginBottom: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{rtn.name}</div>
                                <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => handleDelete(rtn.id)}>🗑️</button>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                {rtn.exercises.length} esercizi
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrainingRoutines;
