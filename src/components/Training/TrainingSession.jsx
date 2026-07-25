import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Logic } from '../../lib/logic';

const TrainingSession = () => {
    const { userData, saveUserData } = useAuth();
    const activeWorkout = userData?.activeWorkout;
    const routines = userData?.routines || [];
    const library = userData?.library || [];

    const [selectedRoutine, setSelectedRoutine] = useState('');
    const [timerDisplay, setTimerDisplay] = useState('00:00:00');
    const [mood, setMood] = useState('');
    const [pump, setPump] = useState('');
    const [fatigue, setFatigue] = useState('');
    const [water, setWater] = useState('');
    
    // Timer Effect
    useEffect(() => {
        if (!activeWorkout?.globalStartTime) return;
        
        const interval = setInterval(() => {
            const now = new Date().getTime();
            const diff = Math.floor((now - activeWorkout.globalStartTime) / 1000);
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            setTimerDisplay(
                `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
            );
        }, 1000);
        return () => clearInterval(interval);
    }, [activeWorkout]);

    const startWorkout = () => {
        if (!selectedRoutine) {
            alert("Seleziona una scheda per iniziare!");
            return;
        }

        const routine = routines.find(r => r.id === selectedRoutine);
        
        const newActiveWorkout = {
            id: 'wo_' + new Date().getTime(),
            routineId: routine.id,
            routineName: routine.name,
            globalStartTime: new Date().getTime(),
            exercises: JSON.parse(JSON.stringify(routine.exercises || []))
        };

        saveUserData({ ...userData, activeWorkout: newActiveWorkout });
    };

    const endWorkout = () => {
        if (!confirm("Terminare l'allenamento?")) return;

        const finishedWorkout = {
            ...activeWorkout,
            globalEndTime: new Date().getTime(),
            mood: mood ? parseInt(mood) : null,
            pump: pump ? parseInt(pump) : null,
            fatigue: fatigue ? parseInt(fatigue) : null,
            water: water ? parseFloat(water) : null
        };

        const updatedHistory = [...(userData.history || []), finishedWorkout];
        
        // Remove activeWorkout
        saveUserData({ ...userData, history: updatedHistory, activeWorkout: null });
        setMood(''); setPump(''); setFatigue(''); setWater('');
    };

    const addExtraExercise = (exId) => {
        const exDef = library.find(l => l.id === exId);
        if(!exDef) return;

        const updatedActive = { ...activeWorkout };
        updatedActive.exercises.push({
            id: exDef.id,
            name: exDef.name,
            sets: []
        });

        saveUserData({ ...userData, activeWorkout: updatedActive });
    };

    if (!activeWorkout) {
        return (
            <div className="training-sub-view active">
                <div className="card">
                    <h3 style={{ marginTop: 0, marginBottom: '15px' }}>Avvia nuova sessione</h3>
                    {routines.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)' }}>Non hai ancora creato nessuna scheda.</p>
                    ) : (
                        <div>
                            <select 
                                value={selectedRoutine} 
                                onChange={e => setSelectedRoutine(e.target.value)}
                                style={{ width: '100%', marginBottom: '15px', padding: '12px', background: 'var(--surface-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px' }}
                            >
                                <option value="">-- Seleziona Scheda --</option>
                                {routines.map(r => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                            </select>
                            <button className="btn btn-primary" style={{ width: '100%' }} onClick={startWorkout}>
                                💪 Inizia Allenamento
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="training-sub-view active">
            <h3 style={{ marginTop: 0 }}>Allenamento in corso: {activeWorkout.routineName}</h3>
            
            <div id="global-timer-bar" style={{ margin: '20px 0', textAlign: 'center' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Durata Allenamento Globale</div>
                <div className="timer-display" style={{ fontSize: '2.5rem', fontWeight: 'bold', margin: '10px 0', fontFamily: 'monospace', color: 'var(--primary-color)' }}>
                    {timerDisplay}
                </div>
            </div>

            <div className="card" style={{ padding: '15px', marginBottom: '20px' }}>
                {activeWorkout.exercises.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>Nessun esercizio presente.</p>
                ) : (
                    activeWorkout.exercises.map((ex, idx) => (
                        <div key={idx} style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px dashed var(--glass-border)' }}>
                            <h4 style={{ margin: '0 0 10px 0' }}>{ex.name}</h4>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Gestione Set/Ripetizioni in lavorazione...</p>
                        </div>
                    ))
                )}

                <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--glass-border)' }}>
                    <h4>Aggiungi Esercizio Extra</h4>
                    <select 
                        onChange={e => { if(e.target.value) addExtraExercise(e.target.value); e.target.value = ''; }}
                        style={{ width: '100%', padding: '10px', background: 'var(--bg-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px' }}
                    >
                        <option value="">-- Seleziona dalla libreria --</option>
                        {library.map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div style={{ margin: '20px 0', padding: '15px', background: 'rgba(14, 165, 233, 0.1)', borderRadius: '12px', border: '1px solid var(--primary-color)' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--primary-color)', display: 'block', marginBottom: '8px' }}>💧 Acqua bevuta (Litri)</label>
                <input type="number" step="0.1" placeholder="es. 1.5" value={water} onChange={e => setWater(e.target.value)} style={{ margin: 0, width: '100%', borderColor: 'var(--primary-color)' }} />
            </div>

            <div style={{ margin: '20px 0', padding: '15px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <h4 style={{ marginTop: 0, marginBottom: '12px' }}>Valuta Sessione (1-10)</h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Umore</label>
                        <input type="number" min="1" max="10" value={mood} onChange={e => setMood(e.target.value)} style={{ margin: 0, textAlign: 'center' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Pump</label>
                        <input type="number" min="1" max="10" value={pump} onChange={e => setPump(e.target.value)} style={{ margin: 0, textAlign: 'center' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Stanchezza</label>
                        <input type="number" min="1" max="10" value={fatigue} onChange={e => setFatigue(e.target.value)} style={{ margin: 0, textAlign: 'center' }} />
                    </div>
                </div>
            </div>

            <button className="btn btn-success" style={{ width: '100%', fontSize: '1.1rem', padding: '15px' }} onClick={endWorkout}>
                ✅ Termina Sessione
            </button>
        </div>
    );
};

export default TrainingSession;
