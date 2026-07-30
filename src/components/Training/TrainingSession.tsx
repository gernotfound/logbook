import React, { useState, useEffect, useMemo } from 'react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import WorkoutTimer from './WorkoutTimer';

const GlobalTimer = ({ startTime }: { startTime?: number }) => {
    const [display, setDisplay] = useState('00:00');
    useEffect(() => {
        if (!startTime) return;
        const interval = setInterval(() => {
            const diff = Math.floor((Date.now() - startTime) / 1000);
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            if (h > 0) {
                setDisplay(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
            } else {
                setDisplay(`${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [startTime]);
    return <div style={{ fontSize: '2rem', fontWeight: 'bold', fontFamily: 'monospace', color: 'var(--primary-color)', textAlign: 'center', margin: '15px 0' }}>{display}</div>;
};

const TrainingSession = () => {
    const {
        activeWorkout, routines, library, history,
        selectedRoutine, setSelectedRoutine,
        mood, setMood, pump, setPump, fatigue, setFatigue, water, setWater,
        startWorkout, endWorkout, deleteWorkout,
        addExtraExercise, removeActiveExercise,
        addSet, removeSet, updateSet,
        addSpecialSet, updateSpecialSet, removeSpecialSet,
        updateSetupNote, updateSessionNote
    } = useWorkoutSession();

    const [openHistoryExIndex, setOpenHistoryExIndex] = useState<number | null>(null);
    const [openSetupExIndex, setOpenSetupExIndex] = useState<number | null>(null);
    const [openSpecialMenuId, setOpenSpecialMenuId] = useState<string | null>(null);

    // Callbacks that also close panels
    const handleRemoveExercise = (exIndex: number) => {
        removeActiveExercise(exIndex, (idx) => {
            if (openHistoryExIndex === idx) setOpenHistoryExIndex(null);
            if (openSetupExIndex === idx) setOpenSetupExIndex(null);
        });
    };

    const handleAddSet = (exIndex: number, type: string = 'normal', setId: string | null = null) => {
        addSpecialSet(exIndex, setId as string, type, () => setOpenSpecialMenuId(null));
    };

    const exerciseHistoryMap = useMemo(() => {
        const map = new Map<string, Array<{ date: string; sets: any[]; note: string }>>();
        if (!history || history.length === 0) return map;

        for (const w of history) {
            if (!w.exercises) continue;
            for (const ex of w.exercises) {
                if (!ex.exId) continue;
                if (!map.has(ex.exId)) map.set(ex.exId, []);
                const list = map.get(ex.exId)!;
                if (list.length < 2) {
                    list.push({ date: w.date || '', sets: ex.sets || [], note: ex.sessionNote });
                }
            }
        }
        return map;
    }, [history]);

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
                                    <option key={r.id} value={r.id}>
                                        {r.name} ({(r.exercises || []).length} es.)
                                    </option>
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
            {/* Sticky Timer */}
            <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg-color)', padding: '10px 0', borderBottom: '1px solid var(--glass-border)', marginBottom: '15px' }}>
                <WorkoutTimer />
            </div>

            <div className="card" style={{ padding: '15px', marginBottom: '20px' }}>
                {activeWorkout.routineName && <h3 style={{ marginTop: 0 }}>{activeWorkout.routineName}</h3>}
                {(activeWorkout.exercises || []).length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>Nessun esercizio presente in questa sessione.</p>
                ) : (
                    (activeWorkout.exercises || []).map((exItem: any, exIndex: number) => {
                        const libDef = library.find(l => l.id === exItem.exId);
                        const exName = libDef ? libDef.name : "Esercizio Rimosso";
                        const exNotes = libDef ? (libDef.notes || '') : "";

                        // Fetch last 2 history entries for this exercise
                        const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || [];
                        const lastNote = pastWorkouts.find(p => p.note && p.note.trim() !== '')?.note || '';

                        return (
                            <div key={exIndex} style={{ marginBottom: '25px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                    <h3 style={{ color: 'var(--primary-color)', margin: 0 }}>{exName}</h3>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <button className="btn-small" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '8px' }} onClick={() => handleRemoveExercise(exIndex)}>🗑️</button>
                                        <button className={`btn-small toggle-btn ${openHistoryExIndex === exIndex ? 'active-highlight' : ''}`} style={openHistoryExIndex === exIndex ? { background: 'var(--primary-color)', color: '#000' } : {}} onClick={() => setOpenHistoryExIndex(openHistoryExIndex === exIndex ? null : exIndex)}>🕒 Storico</button>
                                        <button className={`btn-small toggle-btn ${openSetupExIndex === exIndex ? 'active-highlight' : ''}`} style={openSetupExIndex === exIndex ? { background: 'var(--primary-color)', color: '#000' } : {}} onClick={() => setOpenSetupExIndex(openSetupExIndex === exIndex ? null : exIndex)}>⚙️ Setup</button>
                                    </div>
                                </div>
                                {(exItem.minReps || exItem.maxReps) && (
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                                        Rep min: {exItem.minReps || '-'} | Rep max: {exItem.maxReps || '-'}
                                    </div>
                                )}
                                {!(exItem.minReps || exItem.maxReps) && <div style={{ marginBottom: '15px' }}></div>}

                                {openHistoryExIndex === exIndex && (
                                    <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                                        <h5 style={{ marginBottom: '8px', marginTop: 0 }}>Ultimi 2 Allenamenti:</h5>
                                        {pastWorkouts.length === 0 ? (
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nessun dato precedente trovato.</div>
                                        ) : (
                                            pastWorkouts.map((pw, idx) => (
                                                <div key={idx} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px dashed var(--glass-border)' }}>
                                                    <strong style={{ fontSize: '0.85rem', color: 'var(--primary-color)' }}>{pw.date}</strong><br />
                                                    {pw.sets.map((s: any, sIdx: number) => (
                                                        <span key={sIdx} style={{ fontSize: '0.85rem', marginRight: '15px', display: 'inline-block' }}>
                                                            S{sIdx + 1}: {libDef?.trackingType === 'time' ? (
                                                                <><b>{s.kg ? s.kg + 'kg ' : ''}</b>⏱️ <b>{s.time || '?'}</b></>
                                                            ) : (
                                                                <><b>{s.kg || '?'}</b> kg × <b>{s.reps || '?'}</b></>
                                                            )}
                                                        </span>
                                                    ))}
                                                    {pw.note && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>{pw.note}</div>}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}

                                {openSetupExIndex === exIndex && (
                                    <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                                        <h5 style={{ marginBottom: '8px', marginTop: 0, color: 'var(--text-muted)' }}>Modifica Setup (Globale):</h5>
                                        <input id={`setup-${exItem.exId}`} type="text" defaultValue={exNotes} placeholder="Note di setup (es. altezza sedile...)" onBlur={(e) => updateSetupNote(exItem.exId, e.target.value)} style={{ margin: 0, width: '100%' }} />
                                    </div>
                                )}

                                {lastNote && (
                                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px', borderLeft: '3px solid var(--danger-color)', fontSize: '0.85rem', marginBottom: '15px', color: '#fca5a5' }}>
                                        ⚠️ <b>Note scorsa volta:</b> {lastNote}
                                    </div>
                                )}

                                {(exItem.sets || []).map((s: any, sIndex: number) => (
                                    <React.Fragment key={s.id}>
                                        <div className="set-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '75px' }}>
                                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>S{sIndex + 1}</span>
                                                <button className="btn-icon" style={{ color: 'var(--danger-color)', fontSize: '0.9rem' }} onClick={() => removeSet(exIndex, sIndex)}>🗑️</button>
                                            </div>
                                            <div style={{ display: 'flex', gap: '5px', flex: 1, position: 'relative' }}>
                                                {libDef?.trackingType === 'time' ? (
                                                    <>
                                                        <input id={`kg-${s.id}`} type="number" step="0.25" placeholder="Kg (opz)" value={s.kg} onChange={e => updateSet(exIndex, s.id, 'kg', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                        <input id={`time-${s.id}`} type="text" placeholder="Tempo (es. 60s)" value={s.time || ''} onChange={e => updateSet(exIndex, s.id, 'time', e.target.value)} style={{ margin: 0, flex: 2 }} />
                                                    </>
                                                ) : (
                                                    <>
                                                        <input id={`kg-${s.id}`} type="number" step="0.25" placeholder="Kg" value={s.kg} onChange={e => updateSet(exIndex, s.id, 'kg', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                        <input id={`reps-${s.id}`} type="number" placeholder="Reps" value={s.reps} onChange={e => updateSet(exIndex, s.id, 'reps', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    </>
                                                )}
                                                <button className="btn-icon" style={{ background: 'var(--primary-color)', borderRadius: '50%', width: '36px', height: '36px', color: '#fff', flexShrink: 0 }} onClick={() => setOpenSpecialMenuId(openSpecialMenuId === s.id ? null : s.id)}>+</button>
                                                
                                                {openSpecialMenuId === s.id && (
                                                    <div className="special-menu" style={{ position: 'absolute', right: 0, top: '35px', background: 'var(--surface-color)', padding: '10px', borderRadius: '8px', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', border: '1px solid var(--glass-border)' }}>
                                                        <button className="btn btn-small" style={{ display: 'block', width: '100%', marginBottom: '5px' }} onClick={() => handleAddSet(exIndex, 'dropset', s.id)}>+ Dropset</button>
                                                        <button className="btn btn-small" style={{ display: 'block', width: '100%' }} onClick={() => handleAddSet(exIndex, 'isometry', s.id)}>+ Isometria</button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {(s.dropsets || []).map((ds: any, dsIdx: number) => (
                                            <div key={ds.id || dsIdx} style={{ marginLeft: '20px', borderLeft: '2px solid var(--warning-color)', paddingLeft: '10px', display: 'flex', alignItems: 'center', marginBottom: '5px', gap: '10px' }}>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--warning-color)', minWidth: '65px' }}>↳ Dropset</div>
                                                <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
                                                    <input id={`ds-kg-${s.id}-${dsIdx}`} type="number" step="0.25" placeholder="Kg" value={ds.kg} onChange={e => updateSpecialSet(exIndex, s.id, 'dropsets', dsIdx, 'kg', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    <input id={`ds-reps-${s.id}-${dsIdx}`} type="number" placeholder="Reps" value={ds.reps} onChange={e => updateSpecialSet(exIndex, s.id, 'dropsets', dsIdx, 'reps', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => removeSpecialSet(exIndex, s.id, 'dropsets', dsIdx)}>✕</button>
                                                </div>
                                            </div>
                                        ))}

                                        {(s.isometrics || []).map((iso: any, isoIdx: number) => (
                                            <div key={iso.id || isoIdx} style={{ marginLeft: '20px', borderLeft: '2px solid var(--accent-color)', paddingLeft: '10px', display: 'flex', alignItems: 'center', marginBottom: '5px', gap: '10px' }}>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--accent-color)', minWidth: '65px' }}>↳ Isometria</div>
                                                <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
                                                    <input id={`iso-kg-${s.id}-${isoIdx}`} type="number" step="0.25" placeholder="Kg" value={iso.kg} onChange={e => updateSpecialSet(exIndex, s.id, 'isometrics', isoIdx, 'kg', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    <input id={`iso-time-${s.id}-${isoIdx}`} type="number" placeholder="Sec" value={iso.time} onChange={e => updateSpecialSet(exIndex, s.id, 'isometrics', isoIdx, 'time', e.target.value)} style={{ margin: 0, flex: 1 }} />
                                                    <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => removeSpecialSet(exIndex, s.id, 'isometrics', isoIdx)}>✕</button>
                                                </div>
                                            </div>
                                        ))}
                                    </React.Fragment>
                                ))}

                                <button className="btn btn-small" style={{ border: '1px dashed var(--glass-border)', background: 'rgba(255,255,255,0.05)', marginTop: '10px', width: '100%' }} onClick={() => addSet(exIndex)}>
                                    + Aggiungi Serie
                                </button>
                                
                                <textarea 
                                    placeholder="Note per la prossima volta (dolori, feedback)..." 
                                    value={exItem.sessionNote || ''}
                                    onChange={(e: any) => updateSessionNote(exIndex, e.target.value)}
                                    style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', color: 'var(--text-main)', borderRadius: '12px', marginTop: '12px', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box' }} 
                                />
                            </div>
                        );
                    })
                )}

                <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--glass-border)' }}>
                    <h4 style={{ marginBottom: '10px' }}>Aggiungi Esercizio Extra</h4>
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
                <input id="water-intake" type="number" step="0.1" placeholder="es. 1.5" value={water} onChange={e => setWater(e.target.value)} style={{ margin: 0, width: '100%', borderColor: 'var(--primary-color)' }} />
            </div>

            <div style={{ margin: '20px 0', padding: '15px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <h4 style={{ marginTop: 0, marginBottom: '12px' }}>Valuta Sessione (1-10) — Opzionale</h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Umore</label>
                        <input id="mood-rating" type="number" min="1" max="10" value={mood} onChange={e => setMood(e.target.value)} style={{ margin: 0, textAlign: 'center' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Pump</label>
                        <input id="pump-rating" type="number" min="1" max="10" value={pump} onChange={e => setPump(e.target.value)} style={{ margin: 0, textAlign: 'center' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Stanchezza</label>
                        <input id="fatigue-rating" type="number" min="1" max="10" value={fatigue} onChange={e => setFatigue(e.target.value)} style={{ margin: 0, textAlign: 'center' }} />
                    </div>
                </div>
            </div>

            <GlobalTimer startTime={activeWorkout.globalStartTime} />

            <button className="btn btn-success" style={{ width: '100%', fontSize: '1.1rem', padding: '15px', marginBottom: '10px' }} onClick={endWorkout}>
                🏁 Termina Sessione
            </button>
            <button className="btn btn-danger" style={{ width: '100%', fontSize: '1rem', padding: '12px', marginBottom: '20px' }} onClick={deleteWorkout}>
                🗑️ Elimina Sessione
            </button>
        </div>
    );
};

export default TrainingSession;
