import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Logic } from '../../lib/logic';

const TrainingSession = () => {
    const { userData, saveUserData } = useAuth();
    
    const activeWorkout = userData?.activeWorkout;
    const routines = userData?.routines || [];
    const library = userData?.library || [];
    const history = userData?.history || [];

    const [selectedRoutine, setSelectedRoutine] = useState('');
    const [timerDisplay, setTimerDisplay] = useState('00:00');
    
    // Rating states
    const [mood, setMood] = useState('');
    const [pump, setPump] = useState('');
    const [fatigue, setFatigue] = useState('');
    const [water, setWater] = useState('');

    // Toggle states for UI sections (history, setup notes)
    const [openHistoryExIndex, setOpenHistoryExIndex] = useState(null);
    const [openSetupExIndex, setOpenSetupExIndex] = useState(null);
    const [openSpecialMenuId, setOpenSpecialMenuId] = useState(null);

    useEffect(() => {
        if (!activeWorkout || !activeWorkout.globalStartTime) return;
        
        const interval = setInterval(() => {
            const diff = Math.floor((new Date().getTime() - activeWorkout.globalStartTime) / 1000);
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            if (h > 0) {
                setTimerDisplay(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
            } else {
                setTimerDisplay(`${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [activeWorkout]);

    const startWorkout = () => {
        if (!selectedRoutine) {
            alert("Seleziona una scheda per iniziare!");
            return;
        }

        const routine = routines.find(r => r.id === selectedRoutine);
        if (!routine) return;
        
        const newActiveWorkout = {
            id: 'wo_' + new Date().getTime(),
            routineId: routine.id,
            routineName: routine.name,
            globalStartTime: new Date().getTime(),
            exercises: (routine.exercises || []).map(ex => ({
                exId: ex.exId,
                sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }],
                sessionNote: ''
            }))
        };

        saveUserData({ ...userData, activeWorkout: newActiveWorkout });
    };

    const endWorkout = () => {
        if (!confirm("Terminare l'allenamento?")) return;

        const valRes = Logic.validateWorkoutRatings(
            mood ? parseInt(mood) : null,
            pump ? parseInt(pump) : null,
            fatigue ? parseInt(fatigue) : null
        );

        if (!valRes.isValid && (mood || pump || fatigue)) {
            // Optional ratings, but if provided they must be valid
            // we can just proceed with nulls if invalid or warn
        }

        const finishedWorkout = {
            ...activeWorkout,
            globalEndTime: new Date().getTime(),
            globalDurationStr: timerDisplay,
            moodRating: valRes.mood,
            pumpRating: valRes.pump,
            fatigueRating: valRes.fatigue,
            waterLiters: water ? parseFloat(water) : 0,
            date: new Date().toISOString().split('T')[0]
        };

        const updatedHistory = [finishedWorkout, ...history];
        
        saveUserData({ ...userData, history: updatedHistory, activeWorkout: null });
        setMood(''); setPump(''); setFatigue(''); setWater('');
    };

    const addExtraExercise = (exId) => {
        const exDef = library.find(l => l.id === exId);
        if(!exDef) return;

        const updatedActive = { ...activeWorkout };
        updatedActive.exercises.push({
            exId: exDef.id,
            sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }],
            sessionNote: ''
        });

        saveUserData({ ...userData, activeWorkout: updatedActive });
    };

    const removeActiveExercise = (exIndex) => {
        if (!confirm("Rimuovere questo esercizio dalla sessione corrente?")) return;
        const updatedActive = { ...activeWorkout };
        updatedActive.exercises.splice(exIndex, 1);
        saveUserData({ ...userData, activeWorkout: updatedActive });
    };

    // Sets Management
    const addSet = (exIndex) => {
        const updatedActive = { ...activeWorkout };
        updatedActive.exercises[exIndex].sets.push({ id: Logic.generateId('s'), kg: '', reps: '' });
        saveUserData({ ...userData, activeWorkout: updatedActive });
    };

    const removeSet = (exIndex, setIndex) => {
        const updatedActive = { ...activeWorkout };
        updatedActive.exercises[exIndex].sets.splice(setIndex, 1);
        saveUserData({ ...userData, activeWorkout: updatedActive });
    };

    const updateSet = (exIndex, setId, field, value) => {
        const updatedActive = { ...activeWorkout };
        const set = updatedActive.exercises[exIndex].sets.find(s => s.id === setId);
        if (set) {
            set[field] = value;
            saveUserData({ ...userData, activeWorkout: updatedActive });
        }
    };

    // Special Sets
    const addSpecialSet = (exIndex, setId, type) => {
        const updatedActive = { ...activeWorkout };
        const set = updatedActive.exercises[exIndex].sets.find(s => s.id === setId);
        if (!set) return;

        if (type === 'dropset') {
            if (!set.dropsets) set.dropsets = [];
            set.dropsets.push({ kg: '', reps: '' });
        } else if (type === 'isometry') {
            if (!set.isometrics) set.isometrics = [];
            set.isometrics.push({ kg: '', time: '' });
        }
        setOpenSpecialMenuId(null);
        saveUserData({ ...userData, activeWorkout: updatedActive });
    };

    const updateSpecialSet = (exIndex, setId, collection, specIndex, field, value) => {
        const updatedActive = { ...activeWorkout };
        const set = updatedActive.exercises[exIndex].sets.find(s => s.id === setId);
        if (set && set[collection] && set[collection][specIndex]) {
            set[collection][specIndex][field] = value;
            saveUserData({ ...userData, activeWorkout: updatedActive });
        }
    };

    const removeSpecialSet = (exIndex, setId, collection, specIndex) => {
        const updatedActive = { ...activeWorkout };
        const set = updatedActive.exercises[exIndex].sets.find(s => s.id === setId);
        if (set && set[collection]) {
            set[collection].splice(specIndex, 1);
            saveUserData({ ...userData, activeWorkout: updatedActive });
        }
    };

    // Notes
    const updateSessionNote = (exIndex, note) => {
        const updatedActive = { ...activeWorkout };
        updatedActive.exercises[exIndex].sessionNote = note;
        saveUserData({ ...userData, activeWorkout: updatedActive });
    };

    const updateSetupNote = (exId, note) => {
        const updatedLibrary = library.map(l => {
            if (l.id === exId) return { ...l, notes: note };
            return l;
        });
        saveUserData({ ...userData, library: updatedLibrary });
    };

    if (!activeWorkout) {
        return (
            <div className="training-sub-view active">
                <div className="card">
                    <h3 style={{ marginTop: 0, marginBottom: '15px' }}>Avvia nuova sessione</h3>
                    {routines.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)' }}>Non hai ancora creato nessuna scheda. Vai in 'Schede' per crearne una e aggiungerci degli esercizi.</p>
                    ) : (
                        <div>
                            <select 
                                value={selectedRoutine} 
                                onChange={e => setSelectedRoutine(e.target.value)}
                                style={{ width: '100%', marginBottom: '15px', padding: '12px', background: 'var(--surface-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px' }}
                            >
                                <option value="">-- Seleziona Scheda --</option>
                                {routines.map(r => (
                                    <option key={r.id} value={r.id}>{r.name} ({(r.exercises || []).length} es.)</option>
                                ))}
                            </select>
                            <button className="btn btn-primary" style={{ width: '100%' }} onClick={startWorkout}>
                                🏋️ Inizia Allenamento
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="training-sub-view active">
            <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg-color)', padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }}>
                <h3 style={{ margin: '0 0 5px 0', fontSize: '1.1rem' }}>Allenamento in corso: <span style={{ color: 'var(--primary-color)' }}>{activeWorkout.routineName}</span></h3>
                <div id="global-timer-bar" style={{ textAlign: 'center' }}>
                    <div className="timer-display" style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--primary-color)' }}>
                        {timerDisplay}
                    </div>
                </div>
            </div>

            <div className="card" style={{ padding: '15px', marginBottom: '20px', marginTop: '15px' }}>
                {(activeWorkout.exercises || []).length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>Nessun esercizio presente in questa sessione.</p>
                ) : (
                    (activeWorkout.exercises || []).map((exItem, exIndex) => {
                        const libDef = library.find(l => l.id === exItem.exId);
                        const exName = libDef ? libDef.name : "Esercizio Rimosso";
                        const exNotes = libDef ? (libDef.notes || '') : "";

                        // Fetch History for this exercise
                        const pastWorkouts = [];
                        for (let w of history) {
                            let ex = (w.exercises || []).find(e => e.exId === exItem.exId);
                            if (ex) pastWorkouts.push({ date: w.date, sets: ex.sets || [], note: ex.sessionNote });
                            if (pastWorkouts.length === 2) break;
                        }
                        let lastNote = pastWorkouts.find(p => p.note && p.note.trim() !== '')?.note || '';

                        return (
                            <div key={exIndex} style={{ marginBottom: '25px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                    <h3 style={{ color: 'var(--primary-color)', margin: 0 }}>{exName}</h3>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <button className="btn-small" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '8px' }} onClick={() => removeActiveExercise(exIndex)}>🗑️</button>
                                        <button className="btn-small toggle-btn" onClick={() => setOpenHistoryExIndex(openHistoryExIndex === exIndex ? null : exIndex)}>🕒 Storico</button>
                                        <button className="btn-small toggle-btn" onClick={() => setOpenSetupExIndex(openSetupExIndex === exIndex ? null : exIndex)}>⚙️ Setup</button>
                                    </div>
                                </div>

                                {openHistoryExIndex === exIndex && (
                                    <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                                        <h5 style={{ marginBottom: '8px', marginTop: 0 }}>Ultimi 2 Allenamenti:</h5>
                                        {pastWorkouts.length === 0 ? (
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nessun dato precedente trovato.</div>
                                        ) : (
                                            pastWorkouts.map((pw, idx) => (
                                                <div key={idx} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px dashed var(--glass-border)' }}>
                                                    <strong style={{ fontSize: '0.85rem', color: 'var(--primary-color)' }}>{pw.date}</strong><br />
                                                    {pw.sets.map((s, sIdx) => (
                                                        <span key={sIdx} style={{ fontSize: '0.85rem', marginRight: '15px', display: 'inline-block' }}>
                                                            S{sIdx + 1}: <b>{s.kg}</b> kg x <b>{s.reps}</b>
                                                        </span>
                                                    ))}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}

                                {openSetupExIndex === exIndex && (
                                    <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                                        <h5 style={{ marginBottom: '8px', marginTop: 0, color: 'var(--text-muted)' }}>Modifica Setup (Globale):</h5>
                                        <input type="text" value={exNotes} placeholder="Note di setup (es. altezza sedile...)" onChange={(e) => updateSetupNote(exItem.exId, e.target.value)} style={{ margin: 0, width: '100%' }} />
                                    </div>
                                )}

                                {lastNote && (
                                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px', borderLeft: '3px solid var(--danger-color)', fontSize: '0.85rem', marginBottom: '15px', color: '#fca5a5' }}>
                                        ⚠️ <b>Note scorsa volta:</b> {lastNote}
                                    </div>
                                )}

                                {(exItem.sets || []).map((s, sIndex) => (
                                    <React.Fragment key={s.id}>
                                        <div className="set-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '80px' }}>
                                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>Serie {sIndex + 1}</span>
                                                <button className="btn-icon" style={{ color: 'var(--danger-color)', fontSize: '1rem' }} onClick={() => removeSet(exIndex, sIndex)}>🗑️</button>
                                            </div>
                                            <div className="set-controls" style={{ display: 'flex', gap: '5px', flex: 1 }}>
                                                <input type="number" step="0.25" placeholder="Kg" value={s.kg} onChange={e => updateSet(exIndex, s.id, 'kg', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                <input type="number" placeholder="Reps" value={s.reps} onChange={e => updateSet(exIndex, s.id, 'reps', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                <button className="btn-icon" style={{ background: 'var(--primary-color)', borderRadius: '50%', width: '38px', height: '38px', color: '#fff', flexShrink: 0 }} onClick={() => setOpenSpecialMenuId(openSpecialMenuId === s.id ? null : s.id)}>+</button>
                                            </div>
                                        </div>

                                        {openSpecialMenuId === s.id && (
                                            <div style={{ textAlign: 'right', marginBottom: '10px' }}>
                                                <button className="btn-small" style={{ background: 'var(--warning-color)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', marginRight: '5px' }} onClick={() => addSpecialSet(exIndex, s.id, 'dropset')}>Dropset</button>
                                                <button className="btn-small" style={{ background: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px' }} onClick={() => addSpecialSet(exIndex, s.id, 'isometry')}>Isometria</button>
                                            </div>
                                        )}

                                        {/* Render Dropsets */}
                                        {(s.dropsets || []).map((ds, dsIdx) => (
                                            <div key={`ds-${dsIdx}`} className="set-row special-row" style={{ marginLeft: '20px', borderLeft: '2px solid var(--warning-color)', paddingLeft: '10px', display: 'flex', alignItems: 'center', marginBottom: '5px', gap: '10px' }}>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--warning-color)', minWidth: '70px' }}>↳ Dropset</div>
                                                <div className="set-controls" style={{ display: 'flex', gap: '5px', flex: 1 }}>
                                                    <input type="number" step="0.25" placeholder="Kg" value={ds.kg} onChange={e => updateSpecialSet(exIndex, s.id, 'dropsets', dsIdx, 'kg', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    <input type="number" placeholder="Reps" value={ds.reps} onChange={e => updateSpecialSet(exIndex, s.id, 'dropsets', dsIdx, 'reps', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    <button className="btn-icon" style={{ color: 'var(--danger-color)', padding: '0 5px' }} onClick={() => removeSpecialSet(exIndex, s.id, 'dropsets', dsIdx)}>✕</button>
                                                </div>
                                            </div>
                                        ))}

                                        {/* Render Isometrics */}
                                        {(s.isometrics || []).map((iso, isoIdx) => (
                                            <div key={`iso-${isoIdx}`} className="set-row special-row" style={{ marginLeft: '20px', borderLeft: '2px solid var(--accent-color)', paddingLeft: '10px', display: 'flex', alignItems: 'center', marginBottom: '5px', gap: '10px' }}>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--accent-color)', minWidth: '70px' }}>↳ Isometria</div>
                                                <div className="set-controls" style={{ display: 'flex', gap: '5px', flex: 1 }}>
                                                    <input type="number" step="0.25" placeholder="Kg" value={iso.kg} onChange={e => updateSpecialSet(exIndex, s.id, 'isometrics', isoIdx, 'kg', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    <input type="number" placeholder="Sec" value={iso.time} onChange={e => updateSpecialSet(exIndex, s.id, 'isometrics', isoIdx, 'time', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    <button className="btn-icon" style={{ color: 'var(--danger-color)', padding: '0 5px' }} onClick={() => removeSpecialSet(exIndex, s.id, 'isometrics', isoIdx)}>✕</button>
                                                </div>
                                            </div>
                                        ))}
                                    </React.Fragment>
                                ))}

                                <button className="btn btn-small" style={{ border: '1px dashed var(--glass-border)', background: 'rgba(255,255,255,0.05)', marginTop: '10px' }} onClick={() => addSet(exIndex)}>+ Aggiungi Serie</button>
                                
                                <textarea 
                                    placeholder="Note per la prossima volta (dolori, feedback)..." 
                                    value={exItem.sessionNote || ''}
                                    onChange={(e) => updateSessionNote(exIndex, e.target.value)}
                                    style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', color: 'var(--text-main)', borderRadius: '12px', marginTop: '15px', fontSize: '0.9rem', resize: 'vertical' }} 
                                />
                            </div>
                        );
                    })
                )}

                <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--glass-border)' }}>
                    <h4>Aggiungi Esercizio Extra</h4>
                    <select 
                        onChange={e => { if(e.target.value) addExtraExercise(e.target.value); e.target.value = ''; }}
                        style={{ width: '100%', padding: '10px', background: 'var(--surface-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px' }}
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
                🏁 Termina Sessione
            </button>
        </div>
    );
};

export default TrainingSession;
