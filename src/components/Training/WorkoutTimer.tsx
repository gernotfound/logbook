import { useState, useEffect } from 'react';
import { Pause, Play, RotateCcw, Square } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAppStore } from '../../store/useAppStore';
import {
    formatTimerMs,
    readWorkoutTimerSnapshot,
    stoppedWorkoutTimer,
    writeWorkoutTimerSnapshot,
    type WorkoutTimerSnapshot,
} from '../../lib/utils/timer';

const TIMER_REPAINT_MS = 500;

export default function WorkoutTimer() {
    const { currentUser, isGuest } = useAuth();
    const owner = !isGuest && currentUser ? `user:${currentUser.uid}` : 'guest';
    return <OwnerWorkoutTimer key={owner} owner={owner} />;
}

function OwnerWorkoutTimer({ owner }: { owner: string }) {
    const [restTimer, setRestTimer] = useState<WorkoutTimerSnapshot>(() => readWorkoutTimerSnapshot(owner));
    const [displayNow, setDisplayNow] = useState(() => Date.now());

    const restDisplay = restTimer.state === 'running'
        ? formatTimerMs(displayNow - restTimer.startTime + restTimer.accumulated)
        : (restTimer.state === 'paused' ? formatTimerMs(restTimer.accumulated) : '00:00');

    const commitTimer = (next: WorkoutTimerSnapshot): boolean => {
        try {
            // Device-critical timer transitions are persisted synchronously before
            // the UI confirms them. A failed write therefore cannot look saved.
            writeWorkoutTimerSnapshot(next, owner);
            setRestTimer(next);
            if (next.state === 'running') setDisplayNow(Date.now());
            return true;
        } catch {
            useAppStore.getState().setSaveError('Impossibile salvare il timer su questo dispositivo.');
            return false;
        }
    };

    useEffect(() => {
        const handleReset = () => {
            // resetGlobalWorkoutTimer dispatches only after its stopped snapshot has
            // been written successfully, so this event is safe to reflect in memory.
            setRestTimer(stoppedWorkoutTimer());
        };
        window.addEventListener('logbook_reset_timer', handleReset);
        return () => window.removeEventListener('logbook_reset_timer', handleReset);
    }, []);

    // The timeout chain is only a repaint trigger. Elapsed time always derives
    // from absolute timestamps, so mobile background throttling cannot make the
    // timer drift and no interval cadence becomes a second source of truth.
    useEffect(() => {
        if (restTimer.state !== 'running') return;

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let active = true;

        const scheduleNextTick = () => {
            timeoutId = setTimeout(() => {
                if (!active) return;
                setDisplayNow(Date.now());
                scheduleNextTick();
            }, TIMER_REPAINT_MS);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') setDisplayNow(Date.now());
        };

        scheduleNextTick();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            active = false;
            if (timeoutId) clearTimeout(timeoutId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [restTimer.state]);

    const startRest = () => {
        if (restTimer.state === 'running') return;
        commitTimer({
            version: 1,
            state: 'running',
            startTime: Date.now(),
            accumulated: restTimer.accumulated,
        });
    };

    const pauseRest = () => {
        if (restTimer.state !== 'running') return;
        commitTimer({
            version: 1,
            state: 'paused',
            startTime: 0,
            accumulated: restTimer.accumulated + (Date.now() - restTimer.startTime),
        });
    };

    const resetRest = () => {
        commitTimer({
            version: 1,
            state: 'running',
            startTime: Date.now(),
            accumulated: 0,
        });
    };

    const stopRest = () => {
        commitTimer(stoppedWorkoutTimer());
    };

    return (
        <div className="workout-timer" aria-label="Cronometro recupero">
            <div className="workout-timer-readout">
                <span className="text-sm text-muted">Recupero</span>
                <output className="timer-display" aria-live="off" aria-label="Tempo di recupero">
                    {restDisplay}
                </output>
            </div>
            <div className="timer-controls">
                {restTimer.state !== 'running' ? (
                    <button type="button" className="timer-btn play" onClick={startRest} aria-label="Avvia recupero" title="Avvia recupero">
                        <Play size={20} aria-hidden="true" />
                    </button>
                ) : (
                    <button type="button" className="timer-btn pause" onClick={pauseRest} aria-label="Pausa recupero" title="Pausa recupero">
                        <Pause size={20} aria-hidden="true" />
                    </button>
                )}
                <button type="button" className="timer-btn reset" onClick={resetRest} aria-label="Riavvia recupero" title="Riavvia recupero">
                    <RotateCcw size={20} aria-hidden="true" />
                </button>
                <button type="button" className="timer-btn stop" onClick={stopRest} aria-label="Ferma recupero" title="Ferma recupero">
                    <Square size={20} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
