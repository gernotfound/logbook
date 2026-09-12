import { useState, useEffect, useMemo, useCallback } from 'react';
import { Flag, Save, Trash2, X } from 'lucide-react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { useWakeLock } from '../../hooks/useWakeLock';
import { Logic } from '../../lib/logic';
import SessionHeader from './SessionHeader';
import SessionExerciseCard from './session/SessionExerciseCard';
import SessionRatings from './session/SessionRatings';
import { ExerciseSearchDropdown } from './ExerciseSearchDropdown';
import WorkoutReportModal from './WorkoutReportModal';
import type { WorkoutSession } from '../../types';

const EMPTY_HISTORY_ARRAY: Array<{ date: string; sets: any[]; note: string }> = [];

const GlobalTimer = ({ startTime }: { startTime?: number }) => {
    const [display, setDisplay] = useState('00:00:00');

    useEffect(() => {
        if (!startTime) return;
        const updateDisplay = () => {
            const diff = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
            setDisplay(Logic.formatDuration(diff));
        };

        updateDisplay();
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

    return (
        <div className="workout-duration" aria-label={`Durata sessione ${display}`}>
            <span className="workout-duration__label">Durata sessione</span>
            <div className="workout-duration__value">{display}</div>
        </div>
    );
};

export interface ActiveWorkoutSessionProps {
    onNavigateToHistory?: () => void;
}

export const ActiveWorkoutSession = ({ onNavigateToHistory }: ActiveWorkoutSessionProps) => {
    const {
        activeWorkout, library, history,
        mood, setMood, pump, setPump, fatigue, setFatigue, water, setWater,
        manualDuration, setManualDuration,
        pains, setPains, togglePain,
        endWorkout, deleteWorkout,
        saveHistoryEdit, cancelHistoryEdit,
        addExtraExercise, moveExercise, reorderExercises, removeActiveExercise,
        addSet, removeSet, removeLastSet, updateSet,
        addSpecialSet, updateSpecialSet, removeSpecialSet,
        updateSetupNote, updateSessionNote
    } = useWorkoutSession();

    useWakeLock(true);

    const [openHistoryExIndex, setOpenHistoryExIndex] = useState<number | null>(null);
    const [openSetupExIndex, setOpenSetupExIndex] = useState<number | null>(null);
    const [openSpecialMenuId, setOpenSpecialMenuId] = useState<string | null>(null);
    const [reportWorkout, setReportWorkout] = useState<WorkoutSession | null>(null);

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

    const handleAddSet = useCallback((exIndex: number) => {
        addSet(exIndex);
    }, [addSet]);

    const handleRemoveSet = useCallback((exIndex: number, sIndex: number) => {
        removeSet(exIndex, sIndex);
    }, [removeSet]);

    const handleRemoveLastSet = useCallback((exIndex: number) => {
        removeLastSet(exIndex);
    }, [removeLastSet]);

    const handleUpdateSet = useCallback((exIndex: number, setId: string, field: string, value: any) => {
        updateSet(exIndex, setId, field, value);
    }, [updateSet]);

    const handleAddSpecialSet = useCallback((exIndex: number, type: string, setId: string) => {
        addSpecialSet(exIndex, setId, type, () => setOpenSpecialMenuId(null));
    }, [addSpecialSet]);

    const handleUpdateSpecialSet = useCallback((exIndex: number, setId: string, type: 'dropsets' | 'isometrics', index: number, field: string, value: any) => {
        updateSpecialSet(exIndex, setId, type, index, field, value);
    }, [updateSpecialSet]);

    const handleRemoveSpecialSet = useCallback((exIndex: number, setId: string, type: 'dropsets' | 'isometrics', index: number) => {
        removeSpecialSet(exIndex, setId, type, index);
    }, [removeSpecialSet]);

    const handleToggleSpecialMenu = useCallback((setId: string) => {
        setOpenSpecialMenuId(prev => (prev === setId ? null : setId));
    }, []);

    const exerciseHistoryMap = useMemo(() => {
        const map = new Map<string, Array<{ date: string; sets: any[]; note: string }>>();
        if (!history || history.length === 0) return map;

        for (const workout of history) {
            if (!workout.exercises) continue;
            for (const exercise of workout.exercises) {
                if (!exercise.exId) continue;
                if (!map.has(exercise.exId)) map.set(exercise.exId, []);
                const list = map.get(exercise.exId)!;
                if (list.length < 2) {
                    list.push({ date: workout.date || '', sets: exercise.sets || [], note: exercise.sessionNote });
                }
            }
        }
        return map;
    }, [history]);

    const libraryMap = useMemo(() => new Map(library.map(item => [item.id, item])), [library]);

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

    const handleEndWorkout = async () => {
        const finishedWorkout = await endWorkout();
        if (finishedWorkout) {
            setReportWorkout(finishedWorkout);
        }
    };

    const handleCloseReport = () => {
        setReportWorkout(null);
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'home' }));
    };

    return (
        <div className="training-sub-view active workout-session">
            {reportWorkout && (
                <WorkoutReportModal
                    workout={reportWorkout}
                    history={history}
                    library={library}
                    onClose={handleCloseReport}
                    fromEndWorkout={true}
                />
            )}

            <SessionHeader
                isEditingHistory={activeWorkout.isEditingHistory}
                routineName={activeWorkout.routineName}
                date={activeWorkout.date}
                onCancelHistory={handleCancelHistory}
            />

            <div className="workout-exercises">
                {(activeWorkout.exercises || []).length === 0 ? (
                    <div className="empty-state ui-inset">
                        <div className="empty-state__title">Nessun esercizio presente in questa sessione.</div>
                    </div>
                ) : (
                    (activeWorkout.exercises || []).map((exItem: any, exIndex: number) => {
                        const libDef = libraryMap.get(exItem.exId);
                        const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || EMPTY_HISTORY_ARRAY;

                        return (
                            <SessionExerciseCard
                                key={exItem.id || `${exItem.exId}_${exIndex}`}
                                exItem={exItem}
                                exIndex={exIndex}
                                totalExercises={(activeWorkout.exercises || []).length}
                                libDef={libDef}
                                pastWorkouts={pastWorkouts}
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
                                onAddSet={handleAddSet}
                                onRemoveSet={handleRemoveSet}
                                onRemoveLastSet={handleRemoveLastSet}
                                onUpdateSet={handleUpdateSet}
                                onAddSpecialSet={handleAddSpecialSet}
                                onUpdateSpecialSet={handleUpdateSpecialSet}
                                onRemoveSpecialSet={handleRemoveSpecialSet}
                                onToggleSpecialMenu={handleToggleSpecialMenu}
                            />
                        );
                    })
                )}

                <div className="workout-extra">
                    <h3>Aggiungi esercizio extra</h3>
                    <ExerciseSearchDropdown
                        library={library}
                        onSelectExercise={addExtraExercise}
                        placeholder="🔍 Cerca esercizio extra da aggiungere..."
                    />
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
                pains={pains}
                onTogglePain={togglePain}
                onSetPains={setPains}
            />

            {activeWorkout.isEditingHistory ? (
                <div className="workout-duration">
                    <label htmlFor="workout-manual-duration" className="workout-duration__label">
                        Durata della sessione
                    </label>
                    <input
                        id="workout-manual-duration"
                        type="text"
                        value={manualDuration}
                        onChange={event => setManualDuration(event.target.value)}
                        onBlur={() => setManualDuration(Logic.normalizeDuration(manualDuration))}
                        onFocus={event => event.target.select()}
                        placeholder="00:00:00"
                    />
                </div>
            ) : (
                <GlobalTimer startTime={activeWorkout.globalStartTime} />
            )}

            {activeWorkout.isEditingHistory ? (
                <div className="workout-actions">
                    <button className="btn btn-primary" onClick={handleSaveHistory}>
                        <Save size={19} aria-hidden="true" /> Salva modifiche
                    </button>
                    <button className="btn btn-danger" onClick={handleCancelHistory}>
                        <X size={19} aria-hidden="true" /> Annulla modifica
                    </button>
                </div>
            ) : (
                <div className="workout-actions">
                    <button className="btn btn-success" onClick={handleEndWorkout}>
                        <Flag size={19} aria-hidden="true" /> Termina sessione
                    </button>
                    <button className="btn btn-danger" onClick={deleteWorkout}>
                        <Trash2 size={19} aria-hidden="true" /> Elimina sessione
                    </button>
                </div>
            )}
        </div>
    );
};
