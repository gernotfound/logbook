import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { TrainingSessionSetup } from './TrainingSessionSetup';
import { ActiveWorkoutSession } from './ActiveWorkoutSession';
import PreSessionCheckIn from './PreSessionCheckIn';
import WorkoutReportModal from './WorkoutReportModal';
import SessionRatings from './session/SessionRatings';
import type { WorkoutSession } from '../../types';
import { Logic } from '../../lib/logic';
import { draftRegistry } from '../../lib/utils/draftRegistry';
import type { WorkoutCompletionDraft } from '../../hooks/workout/workoutSessionPreparation';

interface TrainingSessionProps {
    onNavigateToHistory?: () => void;
    onNavigateToPlanning?: () => void;
}

interface PostSessionDraft extends WorkoutCompletionDraft {
    workoutId: string;
}

function createPostSessionDraft(workout: WorkoutSession): PostSessionDraft {
    return {
        workoutId: String(workout.id ?? ''),
        mood: workout.moodRating !== undefined && workout.moodRating !== null ? String(workout.moodRating) : '',
        pump: workout.pumpRating !== undefined && workout.pumpRating !== null ? String(workout.pumpRating) : '',
        fatigue: workout.fatigueRating !== undefined && workout.fatigueRating !== null ? String(workout.fatigueRating) : '',
        water: workout.waterLiters !== undefined && workout.waterLiters !== null ? String(workout.waterLiters) : '',
        pains: Array.isArray(workout.pains) ? [...workout.pains] : [],
    };
}

const TrainingSession = ({ onNavigateToHistory, onNavigateToPlanning }: TrainingSessionProps) => {
    const {
        activeWorkout, history, library, confirmWorkoutStart, deleteWorkout, endWorkout,
    } = useWorkoutSession();
    const [reportWorkout, setReportWorkout] = useState<WorkoutSession | null>(null);
    const [pendingEndTime, setPendingEndTime] = useState<number | null>(null);
    const [postSessionDraft, setPostSessionDraft] = useState<PostSessionDraft | null>(null);
    const postSessionDraftRef = useRef<PostSessionDraft | null>(null);
    const wasStartedRef = useRef(Boolean(activeWorkout?.globalStartTime));
    const isPostSession = pendingEndTime !== null;

    const updatePostSessionDraft = useCallback((patch: Partial<WorkoutCompletionDraft>) => {
        const current = postSessionDraftRef.current;
        if (!current) return;
        const next = { ...current, ...patch };
        postSessionDraftRef.current = next;
        setPostSessionDraft(next);
    }, []);

    const togglePostSessionPain = useCallback((muscleId: string) => {
        const current = postSessionDraftRef.current;
        if (!current || !muscleId) return;
        const pains = current.pains.includes(muscleId)
            ? current.pains.filter(id => id !== muscleId)
            : [...current.pains, muscleId];
        updatePostSessionDraft({ pains });
    }, [updatePostSessionDraft]);

    const handleRequestEnd = useCallback(() => {
        if (!activeWorkout || activeWorkout.isEditingHistory) return;
        const workoutId = String(activeWorkout.id ?? '');
        const current = postSessionDraftRef.current;
        if (!current || current.workoutId !== workoutId) {
            const next = createPostSessionDraft(activeWorkout);
            postSessionDraftRef.current = next;
            setPostSessionDraft(next);
        }
        setPendingEndTime(Date.now());
    }, [activeWorkout]);

    useEffect(() => {
        const isStarted = Boolean(activeWorkout?.globalStartTime);
        if (!wasStartedRef.current && isStarted) {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
        wasStartedRef.current = isStarted;
    }, [activeWorkout?.globalStartTime]);
    const handleCloseReport = useCallback(() => {
        setReportWorkout(null);
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'home' }));
    }, []);
    // Il report appartiene al contenitore della sessione: deve sopravvivere alla
    // cancellazione del workout locale che segue un salvataggio riuscito.
    if (isPostSession && activeWorkout && !activeWorkout.isEditingHistory) {
        const durationSeconds = activeWorkout.globalStartTime
            ? Math.max(0, Math.floor((pendingEndTime - activeWorkout.globalStartTime) / 1000))
            : 0;
        const totalSets = activeWorkout.exercises.reduce(
            (sum, exercise) => sum + (exercise.sets?.length ?? 0),
            0,
        );

        const finish = async () => {
            draftRegistry.flushAll();
            const draft = postSessionDraftRef.current;
            if (!draft || draft.workoutId !== String(activeWorkout.id ?? '')) return;
            const completionDraft: WorkoutCompletionDraft = {
                mood: draft.mood,
                pump: draft.pump,
                fatigue: draft.fatigue,
                water: draft.water,
                pains: [...draft.pains],
            };
            const finished = await endWorkout(false, pendingEndTime, completionDraft);
            if (finished) {
                postSessionDraftRef.current = null;
                setPostSessionDraft(null);
                setPendingEndTime(null);
                setReportWorkout(finished);
            }
        };
        return (
            <section className="pre-session-checkin post-session-checkin" aria-labelledby="post-session-title">
                <header className="pre-session-header">
                    <p className="pre-session-eyebrow">Fine sessione</p>
                    <h2 id="post-session-title">Com’è andato l’allenamento?</h2>
                    <p>Registra le sensazioni finali prima di salvare la sessione.</p>
                </header>
                <div className="post-session-summary">
                    <div>
                        <h3>Riepilogo rapido</h3>
                        <p>{activeWorkout.routineName || 'Allenamento libero'}</p>
                    </div>
                    <div className="post-session-summary-grid">
                        <div>
                            <strong>{Logic.formatDuration(durationSeconds)}</strong>
                            <span>Durata</span>
                        </div>
                        <div>
                            <strong>{activeWorkout.exercises.length}</strong>
                            <span>Esercizi</span>
                        </div>
                        <div>
                            <strong>{totalSets}</strong>
                            <span>Serie</span>
                        </div>
                    </div>
                </div>
                {postSessionDraft && (
                    <SessionRatings
                        water={postSessionDraft.water}
                        setWater={water => updatePostSessionDraft({ water })}
                        mood={postSessionDraft.mood}
                        setMood={mood => updatePostSessionDraft({ mood })}
                        pump={postSessionDraft.pump}
                        setPump={pump => updatePostSessionDraft({ pump })}
                        fatigue={postSessionDraft.fatigue}
                        setFatigue={fatigue => updatePostSessionDraft({ fatigue })}
                        ratingScale={5}
                        pains={postSessionDraft.pains}
                        onTogglePain={togglePostSessionPain}
                        onSetPains={pains => updatePostSessionDraft({ pains })}
                    />
                )}
                <div className="pre-session-actions">
                    <button type="button" className="btn btn-success" onClick={() => void finish()}>Salva e termina</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setPendingEndTime(null)}>Torna all’allenamento</button>
                </div>
            </section>
        );
    }

    if (reportWorkout) {
        return (
            <WorkoutReportModal
                workout={reportWorkout}
                history={history}
                library={library}
                fromEndWorkout
                onClose={handleCloseReport}
            />
        );
    }

    if (activeWorkout && !activeWorkout.isEditingHistory && !activeWorkout.globalStartTime) {
        return (
            <PreSessionCheckIn
                routineName={activeWorkout.routineName}
                date={activeWorkout.date}
                onStart={confirmWorkoutStart}
                onCancel={deleteWorkout}
            />
        );
    }

    if (!activeWorkout) {
        return <TrainingSessionSetup onNavigateToPlanning={onNavigateToPlanning} />;
    }

    return (
        <ActiveWorkoutSession
            onNavigateToHistory={onNavigateToHistory}
            onRequestEnd={handleRequestEnd}
        />
    );
};

export default TrainingSession;
