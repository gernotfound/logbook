import { useEffect, useState } from 'react';
import { Music2, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { formatTimerMs, stoppedWorkoutTimer, type WorkoutTimerSnapshot } from '../../lib/workoutTimerSnapshot';
import { ContextMenu } from '../UI/ContextMenu';
import WorkoutMetronome from './WorkoutMetronome';
import './metronome.css';

const TIMER_REPAINT_MS = 500;

export function WorkoutTimerControls({
    snapshot: restTimer, isActive = true, timerUnreadable = false, timerConflict = false, onChange,
}: {
    snapshot: WorkoutTimerSnapshot;
    isActive?: boolean;
    timerUnreadable?: boolean;
    timerConflict?: boolean;
    onChange: (next: WorkoutTimerSnapshot) => boolean;
}) {
    const [displayNow, setDisplayNow] = useState(() => Date.now());
    const [metronomeOpen, setMetronomeOpen] = useState(false);
    const restDisplay = restTimer.state === 'running'
        ? formatTimerMs(displayNow - restTimer.startTime + restTimer.accumulated)
        : (restTimer.state === 'paused' ? formatTimerMs(restTimer.accumulated) : '00:00');

    const commitTimer = (next: WorkoutTimerSnapshot) => {
        if (!timerUnreadable && onChange(next) && next.state === 'running') setDisplayNow(Date.now());
    };

    // The timeout chain is only a repaint trigger. Elapsed time always derives
    // from absolute timestamps, so mobile background throttling cannot make the
    // timer drift and no interval cadence becomes a second source of truth.
    useEffect(() => {
        if (restTimer.state !== 'running' || !isActive) return;

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let active = true;

        const scheduleNextTick = () => {
            if (!active || document.visibilityState !== 'visible') return;
            timeoutId = setTimeout(() => {
                if (!active || document.visibilityState !== 'visible') return;
                setDisplayNow(Date.now());
                scheduleNextTick();
            }, TIMER_REPAINT_MS);
        };

        const handleVisibilityChange = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = null;
            if (document.visibilityState === 'visible') {
                setDisplayNow(Date.now());
                scheduleNextTick();
            }
        };

        if (document.visibilityState === 'visible') {
            timeoutId = setTimeout(() => {
                if (!active) return;
                setDisplayNow(Date.now());
                scheduleNextTick();
            }, 0);
        }
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            active = false;
            if (timeoutId) clearTimeout(timeoutId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [restTimer.state, restTimer.startTime, isActive]);

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
        <div className="workout-timer-shell">
            <div className="workout-timer" aria-label="Cronometro recupero">
                <div className="workout-timer-readout">
                    <output className="timer-display" aria-live="off" aria-label="Tempo di recupero">
                        {restDisplay}
                    </output>
                </div>
                {timerUnreadable && (
                    <p role="alert" className="text-muted">Timer non disponibile finché lo storage del dispositivo non viene riletto correttamente.</p>
                )}
                {timerConflict && !timerUnreadable && (
                    <p role="status" className="text-muted">Timer aggiornato da un'altra scheda. Ripeti l'azione per modificarlo.</p>
                )}
                <div className="timer-controls">
                    {restTimer.state !== 'running' ? (
                        <button type="button" className="timer-btn play" onClick={startRest} disabled={timerUnreadable} aria-label="Avvia recupero" title="Avvia recupero">
                            <Play size={20} aria-hidden="true" />
                        </button>
                    ) : (
                        <button type="button" className="timer-btn pause" onClick={pauseRest} disabled={timerUnreadable} aria-label="Pausa recupero" title="Pausa recupero">
                            <Pause size={20} aria-hidden="true" />
                        </button>
                    )}
                    <button type="button" className="timer-btn reset" onClick={resetRest} disabled={timerUnreadable} aria-label="Riavvia recupero" title="Riavvia recupero">
                        <RotateCcw size={20} aria-hidden="true" />
                    </button>
                    <button type="button" className="timer-btn stop" onClick={stopRest} disabled={timerUnreadable} aria-label="Ferma recupero" title="Ferma recupero">
                        <Square size={20} aria-hidden="true" />
                    </button>
                    <ContextMenu
                        className="workout-timer-menu"
                        triggerClassName="workout-timer-menu-trigger"
                        ariaLabel="Opzioni timer"
                        align="right"
                        items={[{
                            id: 'metronome',
                            label: metronomeOpen ? 'Chiudi metronomo' : 'Metronomo',
                            icon: Music2,
                            onClick: () => setMetronomeOpen(open => !open),
                        }]}
                    />
                </div>
            </div>

            {metronomeOpen && <WorkoutMetronome />}
        </div>
    );
}
