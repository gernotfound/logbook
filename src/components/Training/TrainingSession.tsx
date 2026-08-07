import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import WorkoutTimer from './WorkoutTimer';
import SessionExerciseCard from './session/SessionExerciseCard';
import SessionRatings from './session/SessionRatings';

const GlobalTimer = ({ startTime }: { startTime?: number }) => {
    const [display, setDisplay] = useState('00:00');
    
    useEffect(() => {
        if (!startTime) return;
        const updateDisplay = () => {
            const diff = Math.floor((Date.now() - startTime) / 1000);
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            if (h > 0) {
                setDisplay(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
            } else {
                setDisplay(`${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
            }
        };

        updateDisplay(); // initial call
        const interval = setInterval(updateDisplay, 1000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                updateDisplay();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [startTime]);
    return <div style={{ fontSize: '2rem', fontWeight: 'bold', fontFamily: 'monospace', color: 'var(--primary-color)', textAlign: 'center', margin: '15px 0' }}>{display}</div>;
};

interface TrainingSessionProps {
    onNavigateToHistory?: () => void;
}

const TrainingSession = ({ onNavigateToHistory }: TrainingSessionProps) => {
    const {
        activeWorkout, routines, library, history,
        selectedRoutine, setSelectedRoutine,
        mood, setMood, pump, setPump, fatigue, setFatigue, water, setWater,
        manualDuration, setManualDuration,
        startWorkout, endWorkout, deleteWorkout,
        saveHistoryEdit, cancelHistoryEdit,
        addExtraExercise, removeActiveExercise,
        addSet, removeSet, updateSet,
        addSpecialSet, updateSpecialSet, removeSpecialSet,
        updateSetupNote, updateSessionNote
    } = useWorkoutSession();

    const [openHistoryExIndex, setOpenHistoryExIndex] = useState<number | null>(null);
    const [openSetupExIndex, setOpenSetupExIndex] = useState<number | null>(null);
    const [openSpecialMenuId, setOpenSpecialMenuId] = useState<string | null>(null);

    // Callbacks che chiudono i pannelli — memoizzate per non ricrearle ad ogni render
    const handleRemoveExercise = useCallback((exIndex: number) => {
        removeActiveExercise(exIndex, (idx) => {
            if (openHistoryExIndex === idx) setOpenHistoryExIndex(null);
            if (openSetupExIndex === idx) setOpenSetupExIndex(null);
        });
    }, [removeActiveExercise, openHistoryExIndex, openSetupExIndex]);

    const handleAddSet = useCallback((exIndex: number, type: string = 'normal', setId: string | null = null) => {
        addSpecialSet(exIndex, setId as string, type, () => setOpenSpecialMenuId(null));
    }, [addSpecialSet]);

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

    // Pre-calcola la mappa libreria per evitare library.find() ad ogni render
    const libraryMap = useMemo(() => new Map(library.map(l => [l.id, l])), [library]);

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
                                className="w-full p-10 bg-surface text-white border-b rounded-8 mb-15"
                            >
                                <option value="">+ Seleziona scheda</option>
                                {routines.map(r => (
                                    <option key={r.id} value={r.id}>
                                        {r.name} ({(r.exercises || []).length} es.)
                                    </option>
                                ))}
                            </select>
                            <button className="btn btn-primary" style={{ width: '100%' }} onClick={startWorkout}>
                                🏋️ Inizia allenamento
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const handleSaveHistory = async () => {
        const ok = await saveHistoryEdit();
        if (ok && onNavigateToHistory) {
            onNavigateToHistory();
        }
    };

    const handleCancelHistory = async () => {
        const ok = await cancelHistoryEdit();
        if (ok && onNavigateToHistory) {
            onNavigateToHistory();
        }
    };

    return (
        <div className="training-sub-view active">
            {/* Sticky Timer */}
            <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg-color)', padding: '10px 0', borderBottom: '1px solid var(--glass-border)', marginBottom: '15px' }}>
                <WorkoutTimer />
            </div>

            {activeWorkout.isEditingHistory && (
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(234, 179, 8, 0.15)',
                    border: '1px solid var(--warning-color, #eab308)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    marginBottom: '15px'
                }}>
                    <div>
                        <div style={{ fontWeight: 'bold', color: 'var(--warning-color, #eab308)', fontSize: '0.95rem' }}>
                            ✏️ Modifica allenamento dello storico
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {activeWorkout.routineName || 'Sessione'} • {activeWorkout.date || ''}
                        </div>
                    </div>
                    <button 
                        className="btn btn-small" 
                        style={{ width: 'auto', padding: '5px 12px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.1)' }}
                        onClick={handleCancelHistory}
                    >
                        Annulla
                    </button>
                </div>
            )}

            <div className="card" style={{ padding: '15px', marginBottom: '20px' }}>
                {activeWorkout.routineName && <h3 style={{ marginTop: 0 }}>{activeWorkout.routineName}</h3>}
                {(activeWorkout.exercises || []).length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>Nessun esercizio presente in questa sessione.</p>
                ) : (
                    (activeWorkout.exercises || []).map((exItem: any, exIndex: number) => {
                        const libDef = libraryMap.get(exItem.exId);
                        const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || [];

                        return (
                            <SessionExerciseCard
                                key={exItem.exId}
                                exItem={exItem}
                                exIndex={exIndex}
                                libDef={libDef}
                                pastWorkouts={pastWorkouts}
                                isHistoryOpen={openHistoryExIndex === exIndex}
                                isSetupOpen={openSetupExIndex === exIndex}
                                openSpecialMenuId={openSpecialMenuId}
                                onToggleHistory={() => setOpenHistoryExIndex(openHistoryExIndex === exIndex ? null : exIndex)}
                                onToggleSetup={() => setOpenSetupExIndex(openSetupExIndex === exIndex ? null : exIndex)}
                                onRemoveExercise={() => handleRemoveExercise(exIndex)}
                                onUpdateSetupNote={(note) => updateSetupNote(exItem.exId, note)}
                                onUpdateSessionNote={(note) => updateSessionNote(exIndex, note)}
                                onAddSet={() => addSet(exIndex)}
                                onRemoveSet={(sIndex) => removeSet(exIndex, sIndex)}
                                onUpdateSet={(setId, field, val) => updateSet(exIndex, setId, field, val)}
                                onAddSpecialSet={(type, setId) => handleAddSet(exIndex, type, setId)}
                                onUpdateSpecialSet={(setId, type, idx, field, val) => updateSpecialSet(exIndex, setId, type, idx, field, val)}
                                onRemoveSpecialSet={(setId, type, idx) => removeSpecialSet(exIndex, setId, type, idx)}
                                onToggleSpecialMenu={(setId) => setOpenSpecialMenuId(openSpecialMenuId === setId ? null : setId)}
                            />
                        );
                    })
                )}

                <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--glass-border)' }}>
                    <h4 style={{ marginBottom: '10px' }}>Aggiungi esercizio extra</h4>
                    <select 
                        onChange={e => { if(e.target.value) addExtraExercise(e.target.value); e.target.value = ''; }}
                        className="w-full p-10 bg-surface text-white border-b rounded-8"
                    >
                        <option value="">+ Aggiungi esercizio dalla libreria</option>
                        {library.map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <SessionRatings
                water={water}
                setWater={setWater}
                mood={mood}
                setMood={setMood}
                pump={pump}
                setPump={setPump}
                fatigue={fatigue}
                setFatigue={setFatigue}
            />

            {activeWorkout.isEditingHistory ? (
                <div style={{ margin: '20px 0', padding: '15px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                    <label htmlFor="workout-manual-duration" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
                        ⏱️ Durata sessione (HH:MM:SS oppure MM:SS)
                    </label>
                    <input 
                        id="workout-manual-duration"
                        type="text" 
                        value={manualDuration} 
                        onChange={e => setManualDuration(e.target.value)} 
                        placeholder="es. 01:15:00 o 45:00"
                        style={{ 
                            fontSize: '1.8rem', 
                            fontFamily: 'monospace', 
                            fontWeight: 'bold', 
                            color: 'var(--primary-color)', 
                            textAlign: 'center', 
                            maxWidth: '240px', 
                            margin: '0 auto', 
                            padding: '8px 12px' 
                        }} 
                    />
                </div>
            ) : (
                <GlobalTimer startTime={activeWorkout.globalStartTime} />
            )}

            {activeWorkout.isEditingHistory ? (
                <>
                    <button className="btn btn-primary" style={{ width: '100%', fontSize: '1.1rem', padding: '15px', marginBottom: '10px' }} onClick={handleSaveHistory}>
                        💾 Salva modifiche
                    </button>
                    <button className="btn btn-danger" style={{ width: '100%', fontSize: '1rem', padding: '12px', marginBottom: '20px' }} onClick={handleCancelHistory}>
                        Annulla modifica
                    </button>
                </>
            ) : (
                <>
                    <button className="btn btn-success" style={{ width: '100%', fontSize: '1.1rem', padding: '15px', marginBottom: '10px' }} onClick={endWorkout}>
                        🏁 Termina sessione
                    </button>
                    <button className="btn btn-danger" style={{ width: '100%', fontSize: '1rem', padding: '12px', marginBottom: '20px' }} onClick={deleteWorkout}>
                        🗑️ Elimina sessione
                    </button>
                </>
            )}
        </div>
    );
};

export default TrainingSession;
