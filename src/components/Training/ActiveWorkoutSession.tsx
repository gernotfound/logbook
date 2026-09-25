import { useState, useEffect, useMemo, useCallback } from 'react';
import { Trash2, Save } from 'lucide-react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { useWakeLock } from '../../hooks/useWakeLock';
import { Logic } from '../../lib/logic';
import { computeProgressionEngine, formatProgressionReference, progressionBaselineStateLabel, progressionQualityLabel } from '../../lib/calc/progression';
import { useAppStore } from '../../store/useAppStore';
import SessionHeader from './SessionHeader';
import SessionExerciseCard from './session/SessionExerciseCard';
import SessionRatings from './session/SessionRatings';
import { ExerciseSearchDropdown } from './ExerciseSearchDropdown';

// Responsabilità: renderizzare la UI di un allenamento in corso (lista esercizi, timer).
// Props: onNavigateToHistory (callback per navigare allo storico).
// Effetti: chiama le callback di useWorkoutSession, useWakeLock per mantenere lo schermo acceso.

const EMPTY_HISTORY_ARRAY: Array<{ date: string; sets: any[]; note: string }> = [];

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

export interface ActiveWorkoutSessionProps {
    onNavigateToHistory?: () => void;
    onRequestEnd?: () => void;
}

export const ActiveWorkoutSession = ({ onNavigateToHistory, onRequestEnd }: ActiveWorkoutSessionProps) => {
    const {
        activeWorkout, library, history,
        mood, setMood, pump, setPump, fatigue, setFatigue, water, setWater,
        manualDuration, setManualDuration,
        pains, setPains, togglePain,
        deleteWorkout,
        saveHistoryEdit, cancelHistoryEdit,
        addExtraExercise, moveExercise, reorderExercises, removeActiveExercise,
        addSet, removeSet, removeLastSet, updateSet,
        addSpecialSet, updateSpecialSet, removeSpecialSet, addSegment, updateSetTarget,
        updateSetupNote, updateSessionNote, updateTechnicalStandard
    } = useWorkoutSession();
    const nutrition = useAppStore(state => state.userData?.nutrition);

    // Previene lo spegnimento automatico dello schermo durante la sessione attiva
    useWakeLock(true);

    const [openHistoryExIndex, setOpenHistoryExIndex] = useState<number | null>(null);
    const [openSetupExIndex, setOpenSetupExIndex] = useState<number | null>(null);
    const [openSpecialMenuId, setOpenSpecialMenuId] = useState<string | null>(null);

    const handleMoveExercise = useCallback((fromIndex: number, direction: 'up' | 'down') => {
        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        moveExercise(fromIndex, direction);
        setOpenHistoryExIndex(prev => {
            if (prev === null) return null;
            if (prev === fromIndex) return toIndex;
            if (prev === toIndex) return fromIndex;
            return prev;
        });
        setOpenSetupExIndex(prev => {
            if (prev === null) return null;
            if (prev === fromIndex) return toIndex;
            if (prev === toIndex) return fromIndex;
            return prev;
        });
    }, [moveExercise]);

    const handleMoveToPosition = useCallback((fromIndex: number, toIndex: number) => {
        reorderExercises(fromIndex, toIndex);
        setOpenHistoryExIndex(prev => {
            if (prev === null) return null;
            if (prev === fromIndex) return toIndex;
            if (prev === toIndex) return fromIndex;
            return prev;
        });
        setOpenSetupExIndex(prev => {
            if (prev === null) return null;
            if (prev === fromIndex) return toIndex;
            if (prev === toIndex) return fromIndex;
            return prev;
        });
    }, [reorderExercises]);

    const handleRemoveExercise = useCallback((exIndex: number) => {
        removeActiveExercise(exIndex, (idx) => {
            if (openHistoryExIndex === idx) setOpenHistoryExIndex(null);
            if (openSetupExIndex === idx) setOpenSetupExIndex(null);
        });
    }, [removeActiveExercise, openHistoryExIndex, openSetupExIndex]);

    const handleToggleHistory = useCallback((exIndex: number) => {
        setOpenHistoryExIndex(prev => (prev === exIndex ? null : exIndex));
    }, []);

    const handleToggleSetup = useCallback((exIndex: number) => {
        setOpenSetupExIndex(prev => (prev === exIndex ? null : exIndex));
    }, []);

    const handleUpdateSetupNote = useCallback((exId: string, note: string) => {
        updateSetupNote(exId, note);
    }, [updateSetupNote]);

    const handleUpdateSessionNote = useCallback((exIndex: number, note: string) => {
        updateSessionNote(exIndex, note);
    }, [updateSessionNote]);

    const handleUpdateTechnicalStandard = useCallback((exIndex: number, value: string) => {
        updateTechnicalStandard(exIndex, value);
    }, [updateTechnicalStandard]);

    const handleAddSet = useCallback((exIndex: number) => {
        addSet(exIndex);
    }, [addSet]);

    const handleRemoveSet = useCallback((exIndex: number, sIndex: number) => {
        removeSet(exIndex, sIndex);
    }, [removeSet]);

    const handleRemoveLastSet = useCallback((exIndex: number) => {
        removeLastSet(exIndex);
    }, [removeLastSet]);

    const handleUpdateSet = useCallback((exIndex: number, setId: string, field: string, val: any) => {
        updateSet(exIndex, setId, field, val);
    }, [updateSet]);

    const handleAddSpecialSet = useCallback((exIndex: number, type: string, setId: string) => {
        addSpecialSet(exIndex, setId, type, () => setOpenSpecialMenuId(null));
    }, [addSpecialSet]);

    const handleUpdateSpecialSet = useCallback((exIndex: number, setId: string, type: 'dropsets' | 'isometrics' | 'segments', idx: number, field: string, val: any) => {
        updateSpecialSet(exIndex, setId, type, idx, field, val);
    }, [updateSpecialSet]);

    const handleRemoveSpecialSet = useCallback((exIndex: number, setId: string, type: 'dropsets' | 'isometrics' | 'segments', idx: number) => {
        removeSpecialSet(exIndex, setId, type, idx);
    }, [removeSpecialSet]);

    const handleAddSegment = useCallback((exIndex: number, setId: string) => {
        addSegment(exIndex, setId);
    }, [addSegment]);

    const handleUpdateSetTarget = useCallback((exIndex: number, setId: string, reps: number | undefined) => {
        updateSetTarget(exIndex, setId, reps);
    }, [updateSetTarget]);

    const handleToggleSpecialMenu = useCallback((setId: string) => {
        setOpenSpecialMenuId(prev => (prev === setId ? null : setId));
    }, []);

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

    const libraryMap = useMemo(() => new Map(library.map(l => [l.id, l])), [library]);
    const progressionMap = useMemo(() => {
        if (!activeWorkout) return new Map();
        const engine = computeProgressionEngine(activeWorkout, history, libraryMap, { nutrition });
        return new Map(engine.exercises.map(analysis => [analysis.exId, analysis]));
    }, [activeWorkout, history, libraryMap, nutrition]);

    if (!activeWorkout) return null;

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
        <div className="training-sub-view active workout-session">
            <SessionHeader 
                isEditingHistory={activeWorkout.isEditingHistory}
                routineName={activeWorkout.routineName}
                date={activeWorkout.date}
                onCancelHistory={handleCancelHistory}
            />

            <div style={{ padding: '0', marginBottom: '20px' }}>
                {(activeWorkout.exercises || []).length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>Nessun esercizio presente in questa sessione.</p>
                ) : (
                    (activeWorkout.exercises || []).map((exItem: any, exIndex: number) => {
                        const libDef = libraryMap.get(exItem.exId);
                        const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || EMPTY_HISTORY_ARRAY;
                        const progression = progressionMap.get(exItem.exId);
                        const progressionHint = progression ? {
                            previousDate: progression.previousComparable?.date,
                            previousReference: progression.previousComparable ? formatProgressionReference(progression.previousComparable) : undefined,
                            quality: progressionQualityLabel(progression.quality),
                            comparisonStatus: progression.comparisonStatus,
                            comparisonReasons: progression.comparison.reasons,
                            baselineState: progressionBaselineStateLabel(progression.baselineState),
                            baselineVersion: progression.baselineVersion,
                            contractTarget: progression.progressionContract?.target,
                            nextAction: progression.progressionContract?.nextAction,
                        } : undefined;

                        return (
                            <SessionExerciseCard
                                key={exItem.id || `${exItem.exId}_${exIndex}`}
                                exItem={exItem}
                                exIndex={exIndex}
                                totalExercises={(activeWorkout.exercises || []).length}
                                libDef={libDef}
                                pastWorkouts={pastWorkouts}
                                progressionHint={progressionHint}
                                isHistoryOpen={openHistoryExIndex === exIndex}
                                isSetupOpen={openSetupExIndex === exIndex}
                                openSpecialMenuId={openSpecialMenuId}
                                onMoveExercise={handleMoveExercise}
                                onMoveToPosition={handleMoveToPosition}
                                onToggleHistory={handleToggleHistory}
                                onToggleSetup={handleToggleSetup}
                                onRemoveExercise={handleRemoveExercise}
                                onUpdateSetupNote={handleUpdateSetupNote}
                                onUpdateSessionNote={handleUpdateSessionNote}
                                onUpdateTechnicalStandard={handleUpdateTechnicalStandard}
                                onAddSet={handleAddSet}
                                onRemoveSet={handleRemoveSet}
                                onRemoveLastSet={handleRemoveLastSet}
                                onUpdateSet={handleUpdateSet}
                                onAddSpecialSet={handleAddSpecialSet}
                                onUpdateSpecialSet={handleUpdateSpecialSet}
                                onRemoveSpecialSet={handleRemoveSpecialSet}
                                onAddSegment={handleAddSegment}
                                onUpdateSetTarget={handleUpdateSetTarget}
                                onToggleSpecialMenu={handleToggleSpecialMenu}
                            />
                        );
                    })
                )}

                <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--glass-border)' }}>
                    <h3 style={{marginBottom: '10px'}}>Aggiungi esercizio extra</h3>
                    <ExerciseSearchDropdown
                        library={library}
                        onSelectExercise={addExtraExercise}
                        placeholder="?? Cerca esercizio extra da aggiungere..."
                    />
                </div>
            </div>

            {activeWorkout.isEditingHistory && (
<SessionRatings
                water={water}
                setWater={setWater}
                mood={mood}
                setMood={setMood}
                pump={pump}
                setPump={setPump}
                fatigue={fatigue}
                setFatigue={setFatigue}
                ratingScale={activeWorkout.ratingScale ?? 10}
                pains={pains}
                onTogglePain={togglePain}
                onSetPains={setPains}
            />
            )}

            {activeWorkout.isEditingHistory ? (
                <div style={{ margin: '20px 0', padding: '15px', background: 'var(--surface-light)', borderRadius: '12px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                    <label htmlFor="workout-manual-duration" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
                        ?? Durata della sessione
                    </label>
                    <input 
                        id="workout-manual-duration"
                        type="text" 
                        value={manualDuration} 
                        onChange={e => setManualDuration(e.target.value)} 
                        onBlur={() => setManualDuration(Logic.normalizeDuration(manualDuration))}
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
                        <Save size={16} aria-hidden="true" /> Salva modifiche
                    </button>
                    <button className="btn btn-danger" style={{ width: '100%', fontSize: '1rem', padding: '12px', marginBottom: '20px' }} onClick={handleCancelHistory}>
                        Annulla modifica
                    </button>
                </>
            ) : (
                <>
                    <button className="btn btn-success" style={{ width: '100%', fontSize: '1.1rem', padding: '15px', marginBottom: '10px' }} onClick={onRequestEnd}>
                        <span aria-hidden="true">??</span> Termina sessione
                    </button>
                    <button className="btn btn-danger" style={{ width: '100%', fontSize: '1rem', padding: '12px', marginBottom: '20px' }} onClick={deleteWorkout}>
                        <Trash2 size={16} aria-hidden="true" /> Elimina sessione
                    </button>
                </>
            )}
        </div>
    );
};
