import { Logic } from '../../../lib/logic';
import { BufferedWorkoutScope } from '../../UI/bufferedWorkoutScope';
import SessionRatings from './SessionRatings';
import type { WorkoutSession } from '../../../types';
import type { WorkoutCompletionDraft } from '../../../hooks/workout/workoutSessionPreparation';

interface PostSessionReviewProps {
    workout: WorkoutSession;
    endTime: number;
    draft: WorkoutCompletionDraft | null;
    onDraftChange: (patch: Partial<WorkoutCompletionDraft>) => void;
    onTogglePain: (muscleId: string) => void;
    onFinish: () => Promise<void>;
    onReturn: () => void;
}

export default function PostSessionReview({
    workout, endTime, draft, onDraftChange, onTogglePain, onFinish, onReturn,
}: PostSessionReviewProps) {
    const durationSeconds = workout.globalStartTime
        ? Math.max(0, Math.floor((endTime - workout.globalStartTime) / 1000))
        : 0;
    const totalSets = workout.exercises.reduce(
        (sum, exercise) => sum + (exercise.sets?.length ?? 0),
        0,
    );

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
                        <p>{workout.routineName || 'Allenamento libero'}</p>
                    </div>
                    <div className="post-session-summary-grid">
                        <div>
                            <strong>{Logic.formatDuration(durationSeconds)}</strong>
                            <span>Durata</span>
                        </div>
                        <div>
                            <strong>{workout.exercises.length}</strong>
                            <span>Esercizi</span>
                        </div>
                        <div>
                            <strong>{totalSets}</strong>
                            <span>Serie</span>
                        </div>
                    </div>
                </div>
                {draft && (
                    <BufferedWorkoutScope.Provider key={String(workout.id)} value={String(workout.id)}>
                        <SessionRatings
                        water={draft.water}
                        setWater={water => onDraftChange({ water })}
                        mood={draft.mood}
                        setMood={mood => onDraftChange({ mood })}
                        pump={draft.pump}
                        setPump={pump => onDraftChange({ pump })}
                        fatigue={draft.fatigue}
                        setFatigue={fatigue => onDraftChange({ fatigue })}
                        pains={draft.pains}
                        onTogglePain={onTogglePain}
                        onSetPains={pains => onDraftChange({ pains })}
                        />
                    </BufferedWorkoutScope.Provider>
                )}
                <div className="pre-session-actions">
                    <button type="button" className="btn btn-success" onClick={() => void onFinish()}>Salva e termina</button>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onReturn}
                    >
                        Torna all’allenamento
                    </button>
                </div>
            </section>
        );
}
