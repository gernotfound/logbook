import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Square } from 'lucide-react';
import './training.css';
import { useAuth } from '../../hooks/useAuth';
import { readDeviceValue, writeDeviceValue } from '../../lib/sync/deviceStorage';
import { useAppStore } from '../../store/useAppStore';
import { formatTimerMs } from '../../lib/utils/timer';

export default function WorkoutTimer() {
    const { currentUser, isGuest } = useAuth();
    const owner = !isGuest && currentUser ? `user:${currentUser.uid}` : 'guest';
    return <OwnerWorkoutTimer key={owner} owner={owner} />;
}

function OwnerWorkoutTimer({ owner }: { owner: string }) {
    // Rest Timer State
    const [restState, setRestState] = useState<'stopped' | 'running' | 'paused'>(() => {
        const saved = readDeviceValue('timer_state', owner);
        return saved === 'running' || saved === 'paused' ? saved : 'stopped';
    });
    const [restStartTime, setRestStartTime] = useState<number>(() => {
        const saved = readDeviceValue('timer_start', owner);
        return saved ? (parseInt(saved, 10) || 0) : 0;
    });
    const [restAccumulated, setRestAccumulated] = useState<number>(() => {
        const saved = readDeviceValue('timer_accumulated', owner);
        return saved ? (parseInt(saved, 10) || 0) : 0;
    });
    const [restDisplay, setRestDisplay] = useState<string>(() => {
        const savedState = readDeviceValue('timer_state', owner);
        const savedStart = readDeviceValue('timer_start', owner);
        const savedAcc = readDeviceValue('timer_accumulated', owner);
        const start = savedStart ? (parseInt(savedStart, 10) || 0) : 0;
        const acc = savedAcc ? (parseInt(savedAcc, 10) || 0) : 0;

        if (savedState === 'running' && start > 0) {
            return formatTimerMs(Date.now() - start + acc);
        } else if (savedState === 'paused' && acc > 0) {
            return formatTimerMs(acc);
        }
        return '00:00';
    });

    useEffect(() => {
        const handleReset = () => {
            setRestState('stopped');
            setRestStartTime(0);
            setRestAccumulated(0);
            setRestDisplay('00:00');
        };
        window.addEventListener('logbook_reset_timer', handleReset);
        return () => window.removeEventListener('logbook_reset_timer', handleReset);
    }, []);

    useEffect(() => {
      try {
        if (restState === 'stopped' && restStartTime === 0 && restAccumulated === 0) {
            writeDeviceValue('timer_state', null, owner);
            writeDeviceValue('timer_start', null, owner);
            writeDeviceValue('timer_accumulated', null, owner);
            return;
        }
        writeDeviceValue('timer_state', restState, owner);
        writeDeviceValue('timer_start', restStartTime.toString(), owner);
        writeDeviceValue('timer_accumulated', restAccumulated.toString(), owner);
      } catch {
        useAppStore.getState().setSaveError('Impossibile salvare il timer su questo dispositivo.');
      }
    }, [restState, restStartTime, restAccumulated, owner]);

    // Rest Timer Ticker con aggiornamento istantaneo al ripristino da background
    useEffect(() => {
        if (restState !== 'running') {
            if (restState === 'paused') {
                setRestDisplay(formatTimerMs(restAccumulated));
            } else if (restState === 'stopped') {
                setRestDisplay('00:00');
            }
            return;
        }

        const tick = () => {
            const ms = Date.now() - restStartTime + restAccumulated;
            setRestDisplay(formatTimerMs(ms));
        };

        tick();
        const interval = setInterval(tick, 500);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                tick();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [restState, restStartTime, restAccumulated]);

    const startRest = () => {
        if (restState !== 'running') {
            setRestStartTime(Date.now());
            setRestState('running');
        }
    };

    const pauseRest = () => {
        if (restState === 'running') {
            setRestAccumulated(prev => prev + (Date.now() - restStartTime));
            setRestState('paused');
        }
    };

    const resetRest = () => {
        setRestAccumulated(0);
        setRestStartTime(Date.now());
        setRestDisplay('00:00');
        setRestState('running');
    };

    const stopRest = () => {
        setRestState('stopped');
        setRestAccumulated(0);
        setRestStartTime(0);
        setRestDisplay('00:00');
    };

    return (
        <div className="workout-timer" aria-label="Cronometro recupero">
            <div><span className="text-sm text-muted">Recupero</span><output className="timer-display" aria-label="Tempo di recupero">{restDisplay}</output></div>
            <div className="timer-controls">
                {restState !== 'running' ? (
                    <button type="button" className="timer-btn play" onClick={startRest} aria-label="Avvia recupero" title="Avvia recupero"><Play size={20} aria-hidden="true" /></button>
                ) : (
                    <button type="button" className="timer-btn pause" onClick={pauseRest} aria-label="Pausa recupero" title="Pausa recupero"><Pause size={20} aria-hidden="true" /></button>
                )}
                <button type="button" className="timer-btn reset" onClick={resetRest} aria-label="Riavvia recupero" title="Riavvia recupero"><RotateCcw size={20} aria-hidden="true" /></button>
                <button type="button" className="timer-btn stop" onClick={stopRest} aria-label="Ferma recupero" title="Ferma recupero"><Square size={20} aria-hidden="true" /></button>
            </div>
        </div>
    );
}
