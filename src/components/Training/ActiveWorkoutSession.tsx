import { useState, useEffect, useMemo, useCallback } from 'react';
import { CheckCircle2, Trash2, Save, Search } from 'lucide-react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { useWakeLock } from '../../hooks/useWakeLock';
import { Logic } from '../../lib/logic';
import { parseManualDuration } from '../../lib/utils/date';
import SessionHeader from './SessionHeader';
import SessionExerciseAccordion from './session/SessionExerciseAccordion';
import { isCurrentExerciseMutationTarget } from './session/exerciseMutationTarget';
import SessionRatings from './session/SessionRatings';
import { BufferedWorkoutScope } from '../UI/bufferedWorkoutScope';
import { ExerciseSearchDropdown } from './ExerciseSearchDropdown';
import { resumeWorkoutClock, sampleWorkoutClock } from '../../lib/workoutClockGuard';
import { useAppStore } from '../../store/useAppStore';
import type { SessionExerciseSet } from '../../types';

const EMPTY_HISTORY_ARRAY: Array<{ date: string; sets: SessionExerciseSet[]; note: string }> = [];

const remapIndexAfterMove = (index: number | null, fromIndex: number, toIndex: number): number | null => {
    if (index === null || fromIndex === toIndex) return index;
    if (index === fromIndex) return toIndex;
    if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
    if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1;
    return index;
};

export const GlobalTimer = ({ workoutId, startTime }: { workoutId: string; startTime?: number }) => {
    const [display, setDisplay] = useState('00:00:00');
    const [clockAnomaly, setClockAnomaly] = useState(false);

    useEffect(() => {
        if (!startTime) return;

        let anomalyReported = false;
        const surfaceClockAnomaly = () => {
            if (anomalyReported) return;
            anomalyReported = true;
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
        activeWorkout, library, history, historySaving,
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
        void updateSetupNote(exId, note).catch(error => console.error('Salvataggio nota esercizio non completato:', error));
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

    const handleRemoveSet = useCallback((exIndex: number, sIndex: number, setId: string,
        exerciseId?: string, workoutId?: string | null) => {
        removeSet(exIndex, sIndex, setId, exerciseId, workoutId);
    }, [removeSet]);

    const handleRemoveLastSet = useCallback((exIndex: number) => {
        void removeLastSet(exIndex);
    }, [removeLastSet]);

    const handleUpdateSet = useCallback((exIndex: number, setId: string, field: string, val: unknown) => {
        updateSet(exIndex, setId, field, val);
    }, [updateSet]);

    const handleAddSpecialSet = useCallback((exIndex: number, type: string, setId: string) => {
        addSpecialSet(exIndex, setId, type, () => setOpenSpecialMenuId(null));
    }, [addSpecialSet]);

    const handleUpdateSpecialSet = useCallback((exIndex: number, setId: string, type: 'segments', segmentId: string, field: string, val: unknown) => {
        updateSpecialSet(exIndex, setId, type, segmentId, field, val);
    }, [updateSpecialSet]);

    const handleRemoveSpecialSet = useCallback((exIndex: number, setId: string, type: 'segments', segmentId: string) => {
        removeSpecialSet(exIndex, setId, type, segmentId);
    }, [removeSpecialSet]);

    const handleUpdateSetTarget = useCallback((exIndex: number, setId: string, reps: number | undefined) => {
        updateSetTarget(exIndex, setId, reps);
    }, [updateSetTarget]);

    const handleToggleSpecialMenu = useCallback((setId: string) => {
        setOpenSpecialMenuId(prev => (prev === setId ? null : setId));
    }, []);

    const exerciseHistoryMap = useMemo(() => {
        const map = new Map<string, Array<{ date: string; sets: SessionExerciseSet[]; note: string }>>();
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
        <BufferedWorkoutScope.Provider key={String(activeWorkout.id)} value={String(activeWorkout.id)}>
            <div className="training-sub-view active workout-session">
            <SessionHeader
                isEditingHistory={activeWorkout.isEditingHistory}
                routineName={activeWorkout.routineName}
                date={activeWorkout.date}
                onCancelHistory={handleCancelHistory}
                historySaving={historySaving}
                currentExerciseIndex={safeCurrentExerciseIndex}
                totalExercises={totalExercises}
            />

            <div className="session-exercise-list">
                {totalExercises === 0 ? (
                    <div className="session-empty-state">
                        Nessun esercizio presente in questa sessione.
                    </div>
                ) : (
                    activeWorkout.exercises.map((exItem, exIndex: number) => {
                        const libDef = libraryMap.get(exItem.exId);
                        const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || EMPTY_HISTORY_ARRAY;
                        const applyToOriginalExercise = (index: number, action: () => void) => {
                            if (isCurrentExerciseMutationTarget(String(activeWorkout.id), index, exItem.id)) action();
                        };

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
                                onMoveExercise={(index, direction) => applyToOriginalExercise(index, () => handleMoveExercise(index, direction))}
                                onMoveToPosition={(index, target) => applyToOriginalExercise(index, () => handleMoveToPosition(index, target))}
                                onToggleHistory={index => applyToOriginalExercise(index, () => handleToggleHistory(index))}
                                onToggleSetup={index => applyToOriginalExercise(index, () => handleToggleSetup(index))}
                                onRemoveExercise={index => applyToOriginalExercise(index, () => handleRemoveExercise(index))}
                                onUpdateSetupNote={(exId, note) => applyToOriginalExercise(exIndex, () => handleUpdateSetupNote(exId, note))}
                                onUpdateSessionNote={(index, note) => applyToOriginalExercise(index, () => handleUpdateSessionNote(index, note))}
                                onUpdateTechnicalStandard={(index, note) => applyToOriginalExercise(index, () => handleUpdateTechnicalStandard(index, note))}
                                onAddSet={index => applyToOriginalExercise(index, () => handleAddSet(index))}
                                onRemoveSet={(index, setIndex, setId, exerciseId, workoutId) => applyToOriginalExercise(index,
                                    () => handleRemoveSet(index, setIndex, setId, exerciseId, workoutId))}
                                onRemoveLastSet={index => applyToOriginalExercise(index, () => handleRemoveLastSet(index))}
                                onUpdateSet={(index, setId, field, value) => applyToOriginalExercise(index,
                                    () => handleUpdateSet(index, setId, field, value))}
                                onAddSpecialSet={(index, type, setId) => applyToOriginalExercise(index,
                                    () => handleAddSpecialSet(index, type, setId))}
                                onUpdateSpecialSet={(index, setId, type, segmentId, field, value) => applyToOriginalExercise(index,
                                    () => handleUpdateSpecialSet(index, setId, type, segmentId, field, value))}
                                onRemoveSpecialSet={(index, setId, type, segmentId) => applyToOriginalExercise(index,
                                    () => handleRemoveSpecialSet(index, setId, type, segmentId))}
                                onUpdateSetTarget={(index, setId, reps) => applyToOriginalExercise(index,
                                    () => handleUpdateSetTarget(index, setId, reps))}
                                onToggleSpecialMenu={setId => applyToOriginalExercise(exIndex, () => handleToggleSpecialMenu(setId))}
                                isCurrent={safeCurrentExerciseIndex === exIndex}
                                initiallyExpanded={Boolean(activeWorkout.isEditingHistory)}
                                onActivate={index => applyToOriginalExercise(index, () => setCurrentExerciseIndex(index))}
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
                        onBlur={() => {
                            const normalized = parseManualDuration(manualDuration);
                            if (normalized !== null) setManualDuration(normalized);
                        }}
                        onFocus={event => event.target.select()}
                        placeholder="00:00:00"
                    />
                </div>
            ) : (
                <GlobalTimer workoutId={String(activeWorkout.id ?? '')} startTime={activeWorkout.globalStartTime} />
            )}

            {activeWorkout.isEditingHistory ? (
                <div className="session-edit-actions">
                    <button className="btn btn-primary" disabled={historySaving} onClick={handleSaveHistory}>
                        <Save size={20} aria-hidden="true" /> Salva modifiche
                    </button>
                    <button className="btn btn-danger" disabled={historySaving} onClick={handleCancelHistory}>
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
        </BufferedWorkoutScope.Provider>
    );
};
