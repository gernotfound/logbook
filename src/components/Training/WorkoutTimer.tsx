import { useState, useEffect } from 'react';
import { Music2, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAppStore } from '../../store/useAppStore';
import { ContextMenu } from '../UI/ContextMenu';
import WorkoutMetronome from './WorkoutMetronome';
import {
    formatTimerMs,
    readWorkoutTimerSnapshot,
    stoppedWorkoutTimer,
    writeWorkoutTimerSnapshot,
    type WorkoutTimerSnapshot,
} from '../../lib/utils/timer';
import './metronome.css';

const TIMER_REPAINT_MS = 500;

export default function WorkoutTimer() {
    const { currentUser, isGuest } = useAuth();
    const owner = !isGuest && currentUser ? `user:${currentUser.uid}` : 'guest';
    return <OwnerWorkoutTimer key={owner} owner={owner} />;
}

function OwnerWorkoutTimer({ owner }: { owner: string }) {
    const [initialTimer] = useState(() => {
        try {
            return { snapshot: readWorkoutTimerSnapshot(owner), unreadable: false, error: null };
        } catch (error) {
            return { snapshot: stoppedWorkoutTimer(), unreadable: true, error };
        }
    });
    const [restTimer, setRestTimer] = useState<WorkoutTimerSnapshot>(initialTimer.snapshot);
    const [timerUnreadable, setTimerUnreadable] = useState(initialTimer.unreadable);
    const [displayNow, setDisplayNow] = useState(() => Date.now());
    const [metronomeOpen, setMetronomeOpen] = useState(false);

    useEffect(() => {
        if (!initialTimer.unreadable) return;
        console.error('Timer device-critical non leggibile:', initialTimer.error);
        useAppStore.setState({
            localPersistenceBlocked: true,
            syncHealth: 'failed',
            syncPresentation: 'normal',
            saveError: 'Timer locale non leggibile. Riapri TheLogBook prima di usare o sovrascrivere il cronometro.',
        });
    }, [initialTimer]);

    const restDisplay = restTimer.state === 'running'
        ? formatTimerMs(displayNow - restTimer.startTime + restTimer.accumulated)
        : (restTimer.state === 'paused' ? formatTimerMs(restTimer.accumulated) : '00:00');

    const commitTimer = (next: WorkoutTimerSnapshot): boolean => {
        if (timerUnreadable) return false;
        try {
            // Device-critical timer transitions are persisted synchronously before
            // the UI confirms them. A failed write therefore cannot look saved.
            writeWorkoutTimerSnapshot(next, owner);
            setRestTimer(next);
            if (next.state === 'running') setDisplayNow(Date.now());
            return true;
        } catch (error) {
            console.error('Persistenza timer device-critical fallita:', error);
            setTimerUnreadable(true);
            useAppStore.setState({
                localPersistenceBlocked: true,
                syncHealth: 'failed',
                syncPresentation: 'normal',
                saveError: 'Impossibile salvare il timer su questo dispositivo. Riapri TheLogBook prima di continuare.',
            });
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
