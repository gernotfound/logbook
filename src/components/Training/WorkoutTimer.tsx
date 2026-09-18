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

export default function WorkoutTimer() {
    const { currentUser, isGuest } = useAuth();
    const owner = !isGuest && currentUser ? `user:${currentUser.uid}` : 'guest';
    return <OwnerWorkoutTimer key={owner} owner={owner} />;
}

function OwnerWorkoutTimer({ owner }: { owner: string }) {
    const [restTimer, setRestTimer] = useState<WorkoutTimerSnapshot>(() => readWorkoutTimerSnapshot(owner));
    const [restDisplay, setRestDisplay] = useState<string>(() => {
        const initial = readWorkoutTimerSnapshot(owner);
        if (initial.state === 'running') {
            return formatTimerMs(Date.now() - initial.startTime + initial.accumulated);
        }
        if (initial.state === 'paused') return formatTimerMs(initial.accumulated);
        return '00:00';
    });

    useEffect(() => {
        const handleReset = () => {
            setRestTimer(stoppedWorkoutTimer());
            setRestDisplay('00:00');
        };
        window.addEventListener('logbook_reset_timer', handleReset);
        return () => window.removeEventListener('logbook_reset_timer', handleReset);
    }, []);

    useEffect(() => {
        try {
            writeWorkoutTimerSnapshot(restTimer, owner);
        } catch {
            useAppStore.getState().setSaveError('Impossibile salvare il timer su questo dispositivo.');
        }
    }, [restTimer, owner]);

    // The interval is only a repaint trigger. Elapsed time always derives from
    // Date.now(), so mobile background throttling cannot make the timer drift.
    useEffect(() => {
        if (restTimer.state !== 'running') {
            setRestDisplay(restTimer.state === 'paused' ? formatTimerMs(restTimer.accumulated) : '00:00');
            return;
        }

        const tick = () => {
            const ms = Date.now() - restTimer.startTime + restTimer.accumulated;
            setRestDisplay(formatTimerMs(ms));
        };

        tick();
        const interval = setInterval(tick, 500);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') tick();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [restTimer]);

    const startRest = () => {
        setRestTimer(previous => previous.state === 'running'
            ? previous
            : {
                version: 1,
                state: 'running',
                startTime: Date.now(),
                accumulated: previous.accumulated,
            });
    };

    const pauseRest = () => {
        setRestTimer(previous => previous.state !== 'running'
            ? previous
            : {
                version: 1,
                state: 'paused',
                startTime: 0,
                accumulated: previous.accumulated + (Date.now() - previous.startTime),
            });
    };

    const resetRest = () => {
        setRestTimer({
            version: 1,
            state: 'running',
            startTime: Date.now(),
            accumulated: 0,
        });
        setRestDisplay('00:00');
    };

    const stopRest = () => {
        setRestTimer(stoppedWorkoutTimer());
        setRestDisplay('00:00');
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
