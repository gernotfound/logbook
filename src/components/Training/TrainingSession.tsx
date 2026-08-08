import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { Logic } from '../../lib/logic';
import WorkoutTimer from './WorkoutTimer';
import SessionExerciseCard from './session/SessionExerciseCard';
import SessionRatings from './session/SessionRatings';

const GlobalTimer = ({ startTime }: { startTime?: number }) => {
    const [display, setDisplay] = useState('00:00:00');
    
    useEffect(() => {
        if (!startTime) return;
        const updateDisplay = () => {
            const diff = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
            setDisplay(Logic.formatDuration(diff));
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
    onNavigateToPlanning?: () => void;
}

const TrainingSession = ({ onNavigateToHistory, onNavigateToPlanning }: TrainingSessionProps) => {
    const userData = useAppStore(state => state.userData);
    const trainingCycles = userData?.trainingCycles || [];
    const activeCycleId = userData?.activeCycleId ?? null;
    const activeCycle = activeCycleId ? trainingCycles.find(c => c.id === activeCycleId) : null;

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

    const plannedRoutines = useMemo(() => {
        if (!activeCycle || !activeCycle.routines) return [];
        return activeCycle.routines.map((item, idx) => {
            const found = routines.find(r => r.id === item.routineId);
            const letter = String.fromCharCode(65 + (idx % 26));
            return {
                cycleItem: item,
                routine: found,
                letter,
                position: idx + 1
            };
        }).filter(item => item.routine !== undefined);
    }, [activeCycle, routines]);

    const nextScheduled = useMemo(() => {
        return Logic.getNextScheduledRoutine(activeCycle, routines, history);
    }, [activeCycle, routines, history]);

    const [selectedPlannedRoutine, setSelectedPlannedRoutine] = useState('');

    useEffect(() => {
        if (nextScheduled?.nextRoutineId) {
            setSelectedPlannedRoutine(nextScheduled.nextRoutineId);
        } else if (plannedRoutines.length > 0) {
            setSelectedPlannedRoutine(plannedRoutines[0].routine!.id);
        } else {
            setSelectedPlannedRoutine('');
        }
    }, [activeCycle?.id, nextScheduled?.nextRoutineId]);

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
            <div className="tab-pane active fade-in" id="train-session">
                {/* 1. Sezione Avvia sessione pianificata */}
                <div
                    className="card mb-15"
                    style={{
                        border: activeCycle ? '1px solid var(--primary-color)' : '1px solid var(--glass-border)',
                        background: activeCycle ? 'rgba(14, 165, 233, 0.05)' : 'var(--glass-bg)'
                    }}
                >
                    <div className="flex-between items-center mb-10 pb-8 border-b">
                        <div>
                            <span className="text-xs text-primary font-bold uppercase tracking-wider block">
                                Programmazione
                            </span>
                            <h3 className="m-0 text-white" style={{ fontSize: '1.15rem' }}>
                                🎯 Avvia sessione pianificata
                            </h3>
                        </div>
                        {activeCycle && (
                            <span
                                style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    padding: '3px 10px',
                                    borderRadius: '12px',
                                    background: 'var(--primary-color)',
                                    color: '#000'
                                }}
                            >
                                {activeCycle.name}
                            </span>
                        )}
                    </div>

                    {activeCycle ? (
                        plannedRoutines.length === 0 ? (
                            <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                <p className="m-0 mb-8">Nessuna scheda valida trovata nel ciclo attivo "{activeCycle.name}".</p>
                                {onNavigateToPlanning && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-small"
                                        style={{ fontSize: '0.8rem', marginBottom: 0 }}
                                        onClick={onNavigateToPlanning}
                                    >
                                        Modifica ciclo in Pianificazione
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div>
                                {nextScheduled?.nextRoutine && (
                                    <div
                                        style={{
                                            padding: '12px',
                                            background: 'rgba(14, 165, 233, 0.1)',
                                            border: '1px solid rgba(14, 165, 233, 0.3)',
                                            borderRadius: '8px',
                                            marginBottom: '15px'
                                        }}
                                    >
                                        <div className="flex-between items-center mb-6">
                                            <span style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Prossima in programma
                                            </span>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                Seduta #{nextScheduled.nextSessionIndex} di {nextScheduled.totalSessions}
                                            </span>
                                        </div>

                                        <div className="flex-between items-center mb-10">
                                            <div>
                                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#fff' }}>
                                                    {nextScheduled.nextRoutine.name}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                    Rotazione {nextScheduled.rotationNumber} • Scheda {nextScheduled.positionInRotation} di {nextScheduled.totalRoutinesInCycle} • {(nextScheduled.nextRoutine.exercises || []).length} esercizi
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            style={{ width: '100%', marginBottom: 0, fontWeight: 'bold' }}
                                            onClick={() => startWorkout(nextScheduled.nextRoutine!.id, { cycleId: activeCycle.id, cycleName: activeCycle.name })}
                                        >
                                            🏋️ Avvia {nextScheduled.nextRoutine.name} (Seduta #{nextScheduled.nextSessionIndex})
                                        </button>
                                    </div>
                                )}

                                <div className="border-t pt-10">
                                    <label className="text-xs text-muted font-bold block mb-6">
                                        Oppure scegli un'altra scheda della rotazione:
                                    </label>
                                    <div className="form-group mb-10">
                                        <select
                                            aria-label="Seleziona scheda della rotazione"
                                            value={selectedPlannedRoutine}
                                            onChange={e => setSelectedPlannedRoutine(e.target.value)}
                                            className="w-full p-10 bg-surface text-white border-b rounded-8"
                                            style={{ fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block', appearance: 'none' }}
                                        >
                                            <option value="">+ Seleziona scheda della rotazione</option>
                                            {plannedRoutines.map(({ routine, letter, position }) => (
                                                <option key={routine!.id} value={routine!.id}>
                                                    {letter}. {routine!.name} (Posizione {position}/{plannedRoutines.length} • {(routine!.exercises || []).length} es.)
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {selectedPlannedRoutine && (
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            style={{ width: '100%', marginBottom: 0 }}
                                            onClick={() => startWorkout(selectedPlannedRoutine, { cycleId: activeCycle.id, cycleName: activeCycle.name })}
                                        >
                                            🏋️ Avvia {plannedRoutines.find(p => p.routine?.id === selectedPlannedRoutine)?.routine?.name || 'scheda selezionata'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    ) : (
                        <div style={{ padding: '8px 0', color: 'var(--text-muted)' }}>
                            <p className="text-xs m-0 mb-10">
                                Nessun ciclo di allenamento attivo al momento.
                            </p>
                            {onNavigateToPlanning && (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-small"
                                    style={{ fontSize: '0.8rem', marginBottom: 0 }}
                                    onClick={onNavigateToPlanning}
                                >
                                    🎯 Vai a Pianificazione
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* 2. Sezione Avvia nuova sessione (Tutte le schede / Libera) */}
                <div className="card">
                    <div className="flex-between items-center mb-10 pb-8 border-b">
                        <div>
                            <h3 className="m-0" style={{ fontSize: '1.1rem' }}>
                                Avvia nuova sessione
                            </h3>
                            <p className="text-muted text-xs m-0 mt-4">
                                Seleziona liberamente qualsiasi scheda dal tuo archivio
                            </p>
                        </div>
                    </div>
                    {routines.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            Non hai ancora creato nessuna scheda. Vai in 'Schede' per crearne una e aggiungerci degli esercizi.
                        </p>
                    ) : (
                        <div>
                            <div className="form-group mb-12">
                                <select 
                                    aria-label="Seleziona scheda dall'archivio"
                                    value={selectedRoutine} 
                                    onChange={e => setSelectedRoutine(e.target.value)}
                                    className="w-full p-10 bg-surface text-white border-b rounded-8"
                                    style={{ fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block', appearance: 'none' }}
                                >
                                    <option value="">+ Seleziona scheda</option>
                                    {routines.map(r => (
                                        <option key={r.id} value={r.id}>
                                            {r.name} ({(r.exercises || []).length} es.)
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ width: '100%', marginBottom: 0 }}
                                onClick={() => startWorkout(selectedRoutine)}
                            >
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
            <div style={{ position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 100, background: 'var(--bg-color)', padding: '10px 0', borderBottom: '1px solid var(--glass-border)', marginBottom: '15px' }}>
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
                                key={exItem.id || `${exItem.exId}_${exIndex}`}
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
                        ⏱️ Durata della sessione
                    </label>
                    <input 
                        id="workout-manual-duration"
                        type="text" 
                        value={manualDuration} 
                        onChange={e => setManualDuration(e.target.value)} 
                        onBlur={() => setManualDuration(prev => Logic.normalizeDuration(prev))}
                        onFocus={e => e.target.select()}
                        placeholder="00:00:00"
                        style={{ 
                            fontSize: '1.8rem', 
                            fontFamily: 'monospace', 
                            fontWeight: 'bold', 
                            color: 'var(--primary-color)', 
                            textAlign: 'center', 
                            maxWidth: '240px', 
                            width: '100%',
                            margin: '0 auto', 
                            padding: '8px 12px',
                            display: 'block',
                            boxSizing: 'border-box'
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
