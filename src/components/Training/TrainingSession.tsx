import { useCallback, useState } from 'react';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { TrainingSessionSetup } from './TrainingSessionSetup';
import { ActiveWorkoutSession } from './ActiveWorkoutSession';
import PreSessionCheckIn from './PreSessionCheckIn';
import WorkoutReportModal from './WorkoutReportModal';
import SessionRatings from './session/SessionRatings';
import type { WorkoutReadiness, WorkoutSession } from '../../types';

interface TrainingSessionProps {
    onNavigateToHistory?: () => void;
    onNavigateToPlanning?: () => void;
}

const TrainingSession = ({ onNavigateToHistory, onNavigateToPlanning }: TrainingSessionProps) => {
    const {
        activeWorkout, history, library, confirmWorkoutStart, deleteWorkout, endWorkout,
        mood, setMood, pump, setPump, fatigue, setFatigue, water, setWater,
        pains, setPains, togglePain,
    } = useWorkoutSession();
    const [reportWorkout, setReportWorkout] = useState<WorkoutSession | null>(null);
    const [pendingEndTime, setPendingEndTime] = useState<number | null>(null);
    const isPostSession = pendingEndTime !== null;
    const handleCloseReport = useCallback(() => {
        setReportWorkout(null);
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'home' }));
    }, []);
    const handleWorkoutStart = useCallback(async (readiness?: Omit<WorkoutReadiness, 'capturedAt'>) => {
        const started = await confirmWorkoutStart(readiness);
        if (started) {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
        return started;
    }, [confirmWorkoutStart]);

    // Il report appartiene al contenitore della sessione: deve sopravvivere alla
    // cancellazione del workout locale che segue un salvataggio riuscito.
    if (isPostSession && activeWorkout && !activeWorkout.isEditingHistory) {
        const finish = async () => {
            const finished = await endWorkout(false, pendingEndTime);
            if (finished) {
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
                <SessionRatings
                    water={water} setWater={setWater}
                    mood={mood} setMood={setMood}
                    pump={pump} setPump={setPump}
                    fatigue={fatigue} setFatigue={setFatigue}
                    ratingScale={5}
                    pains={pains} onTogglePain={togglePain} onSetPains={setPains}
                />
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
                onStart={handleWorkoutStart}
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
            onRequestEnd={() => setPendingEndTime(Date.now())}
        />
    );
};

export default TrainingSession;
