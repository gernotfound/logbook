import { useState, useEffect } from 'react';
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '0 10px' }}>
            <span className="timer-display" style={{ fontSize: '1.6rem', fontFamily: 'monospace', fontWeight: 'bold', color: restTimer.state === 'running' ? 'var(--warning-color)' : '#fff', letterSpacing: '2px' }}>
                {restDisplay}
            </span>
            <div className="timer-controls" style={{ display: 'flex', gap: '8px' }}>
                {restTimer.state !== 'running' ? (
                    <button type="button" className="timer-btn play" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={startRest} aria-label="Avvia recupero" title="Avvia recupero">▶</button>
                ) : (
                    <button type="button" className="timer-btn pause" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={pauseRest} aria-label="Pausa recupero" title="Pausa recupero">⏸</button>
                )}
                <button type="button" className="timer-btn reset" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={resetRest} aria-label="Riavvia recupero" title="Riavvia recupero">🔄</button>
                <button type="button" className="timer-btn stop" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={stopRest} aria-label="Ferma recupero" title="Ferma recupero">⏹</button>
            </div>
        </div>
    );
}
