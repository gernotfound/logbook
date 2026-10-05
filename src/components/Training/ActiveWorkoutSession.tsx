import { useState, useEffect, useMemo, useCallback } from 'react';
import { CheckCircle2, Trash2, Save, Search } from 'lucide-react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { useWakeLock } from '../../hooks/useWakeLock';
import { Logic } from '../../lib/logic';
import SessionHeader from './SessionHeader';
import SessionExerciseAccordion from './session/SessionExerciseAccordion';
import SessionRatings from './session/SessionRatings';
import { ExerciseSearchDropdown } from './ExerciseSearchDropdown';
import { resetWorkoutClockGuard, resumeWorkoutClock, sampleWorkoutClock } from '../../lib/workoutClockGuard';
import { useAppStore } from '../../store/useAppStore';

const EMPTY_HISTORY_ARRAY: Array<{ date: string; sets: any[]; note: string }> = [];

const remapIndexAfterMove = (index: number | null, fromIndex: number, toIndex: number): number | null => {
    if (index === null || fromIndex === toIndex) return index;
    if (index === fromIndex) return toIndex;
    if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
    if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1;
    return index;
};

const GlobalTimer = ({ workoutId, startTime }: { workoutId: string; startTime?: number }) => {
    const [display, setDisplay] = useState('00:00:00');
    const [clockAnomaly, setClockAnomaly] = useState(false);

    useEffect(() => {
        if (!startTime) return;

        const surfaceClockAnomaly = () => {
            setClockAnomaly(true);
            useAppStore.getState().setSaveError(
                'L’orologio del dispositivo è cambiato durante l’allenamento. Correggi data/ora e riapri TheLogBook prima di terminare la sessione.',
            );
        };

        const updateDisplay = () => {
            const sample = sampleWorkoutClock(workoutId, startTime);
            if (sample.anomalous) surfaceClockAnomaly();
            const diff = Math.floor(sample.elapsedMs / 1000);
            setDisplay(Logic.formatDuration(diff));
        };

        updateDisplay();
        const interval = setInterval(updateDisplay, 1000);

        const handleVisibilityChange = () => {
            if (document.visibilityState !== 'visible') return;
            const resumed = resumeWorkoutClock(workoutId, startTime);
            if (resumed.anomalous) surfaceClockAnomaly();
            updateDisplay();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            resetWorkoutClockGuard(workoutId);
        };
    }, [workoutId, startTime]);

    return (
        <div className="workout-total-duration">
            <span>Durata allenamento</span>
            <output>{display}</output>
            {clockAnomaly && (
                <p role="alert" className="text-muted">
                    Orologio del dispositivo modificato: la chiusura della sessione resta bloccata finché l’ora non viene corretta e l’app riaperta.
                </p>
            )}
        </div>
    );
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
        addSpecialSet, updateSpecialSet, removeSpecialSet, updateSetTarget,
        updateSetupNote, updateSessionNote, updateTechnicalStandard
    } = useWorkoutSession();

    useWakeLock(true);

    const [openHistoryExIndex, setOpenHistoryExIndex] = useState<number | null>(null);
    const [openSetupExIndex, setOpenSetupExIndex] = useState<number | null>(null);
    const [openSpecialMenuId, setOpenSpecialMenuId] = useState<string | null>(null);
    const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);

    const totalExercises = activeWorkout?.exercises?.length ?? 0;
    const safeCurrentExerciseIndex = totalExercises === 0
        ? 0
        : Math.min(currentExerciseIndex, totalExercises - 1);

    const handleMoveExercise = useCallback((fromIndex: number, direction: 'up' | 'down') => {
        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        moveExercise(fromIndex, direction);
        setOpenHistoryExIndex(prev => remapIndexAfterMove(prev, fromIndex, toIndex));
        setOpenSetupExIndex(prev => remapIndexAfterMove(prev, fromIndex, toIndex));
        setCurrentExerciseIndex(prev => remapIndexAfterMove(prev, fromIndex, toIndex) ?? 0);
    }, [moveExercise]);

    const handleMoveToPosition = useCallback((fromIndex: number, toIndex: number) => {
        reorderExercises(fromIndex, toIndex);
        setOpenHistoryExIndex(prev => remapIndexAfterMove(prev, fromIndex, toIndex));
        setOpenSetupExIndex(prev => remapIndexAfterMove(prev, fromIndex, toIndex));
        setCurrentExerciseIndex(prev => remapIndexAfterMove(prev, fromIndex, toIndex) ?? 0);
    }, [reorderExercises]);

    const handleRemoveExercise = useCallback((exIndex: number) => {
        void removeActiveExercise(exIndex, (removedIndex) => {
            if (openHistoryExIndex === removedIndex) setOpenHistoryExIndex(null);
            else if (openHistoryExIndex !== null && openHistoryExIndex > removedIndex) {
                setOpenHistoryExIndex(openHistoryExIndex - 1);
            }
            if (openSetupExIndex === removedIndex) setOpenSetupExIndex(null);
            else if (openSetupExIndex !== null && openSetupExIndex > removedIndex) {
                setOpenSetupExIndex(openSetupExIndex - 1);
            }
            setCurrentExerciseIndex(current => current > removedIndex ? current - 1 : current);
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
        void removeLastSet(exIndex);
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

    const handleUpdateSetTarget = useCallback((exIndex: number, setId: string, reps: number | undefined) => {
        updateSetTarget(exIndex, setId, reps);
    }, [updateSetTarget]);

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
                    list.push({
                        date: workout.date || '',
                        sets: exercise.sets || [],
                        note: exercise.sessionNote,
                    });
                }
            }
        }
        return map;
    }, [history]);

    const libraryMap = useMemo(() => new Map(library.map(item => [item.id, item])), [library]);

    if (!activeWorkout) return null;

    const handleSaveHistory = async () => {
        const ok = await saveHistoryEdit();
        if (ok && onNavigateToHistory) onNavigateToHistory();
    };

    const handleCancelHistory = async () => {
        const ok = await cancelHistoryEdit();
        if (ok && onNavigateToHistory) onNavigateToHistory();
    };

    const handleAddExtraExercise = (exerciseId: string) => {
        addExtraExercise(exerciseId);
        setCurrentExerciseIndex(activeWorkout.exercises.length);
    };

    return (
        <div className="training-sub-view active workout-session">
            <SessionHeader
                isEditingHistory={activeWorkout.isEditingHistory}
                routineName={activeWorkout.routineName}
                date={activeWorkout.date}
                onCancelHistory={handleCancelHistory}
                currentExerciseIndex={safeCurrentExerciseIndex}
                totalExercises={totalExercises}
            />

            <div className="session-exercise-list">
                {totalExercises === 0 ? (
                    <div className="session-empty-state">
                        Nessun esercizio presente in questa sessione.
                    </div>
                ) : (
                    activeWorkout.exercises.map((exItem: any, exIndex: number) => {
                        const libDef = libraryMap.get(exItem.exId);
                        const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || EMPTY_HISTORY_ARRAY;

                        return (
                            <SessionExerciseAccordion
                                key={exItem.id || `${exItem.exId}_${exIndex}`}
                                exItem={exItem}
                                exIndex={exIndex}
                                totalExercises={totalExercises}
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
                                onUpdateTechnicalStandard={handleUpdateTechnicalStandard}
                                onAddSet={handleAddSet}
                                onRemoveSet={handleRemoveSet}
                                onRemoveLastSet={handleRemoveLastSet}
                                onUpdateSet={handleUpdateSet}
                                onAddSpecialSet={handleAddSpecialSet}
                                onUpdateSpecialSet={handleUpdateSpecialSet}
                                onRemoveSpecialSet={handleRemoveSpecialSet}
                                onUpdateSetTarget={handleUpdateSetTarget}
                                onToggleSpecialMenu={handleToggleSpecialMenu}
                                isCurrent={safeCurrentExerciseIndex === exIndex}
                                initiallyExpanded={Boolean(activeWorkout.isEditingHistory)}
                                onActivate={setCurrentExerciseIndex}
                            />
                        );
                    })
                )}
            </div>

            <section className="session-extra-exercise" aria-labelledby="session-extra-exercise-title">
                <div className="session-extra-exercise-heading">
                    <Search size={20} aria-hidden="true" />
                    <div>
                        <h2 id="session-extra-exercise-title">Aggiungi esercizio</h2>
                        <p>Cerca nel catalogo e aggiungilo alla sessione corrente.</p>
                    </div>
                </div>
                <ExerciseSearchDropdown
                    library={library}
                    onSelectExercise={handleAddExtraExercise}
                    placeholder="Cerca esercizio per nome..."
                />
            </section>

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
                <div className="session-manual-duration">
                    <label htmlFor="workout-manual-duration">Durata della sessione</label>
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
                <GlobalTimer workoutId={String(activeWorkout.id ?? '')} startTime={activeWorkout.globalStartTime} />
            )}

            {activeWorkout.isEditingHistory ? (
                <div className="session-edit-actions">
                    <button className="btn btn-primary" onClick={handleSaveHistory}>
                        <Save size={20} aria-hidden="true" /> Salva modifiche
                    </button>
                    <button className="btn btn-danger" onClick={handleCancelHistory}>
                        Annulla modifica
                    </button>
                </div>
            ) : (
                <div className="session-finish-row">
                    <button className="btn btn-danger" onClick={() => void deleteWorkout()}>
                        <Trash2 size={20} aria-hidden="true" /> Elimina
                    </button>
                    <button className="btn btn-success" onClick={onRequestEnd}>
                        <CheckCircle2 size={20} aria-hidden="true" /> Termina allenamento
                    </button>
                </div>
            )}
        </div>
    );
};
