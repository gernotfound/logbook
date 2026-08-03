import { useState, useEffect } from 'react';

export const resetGlobalWorkoutTimer = () => {
    try {
        localStorage.removeItem('logbook_timer_state');
        localStorage.removeItem('logbook_timer_start');
        localStorage.removeItem('logbook_timer_accumulated');
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('logbook_reset_timer'));
        }
    } catch (e) {
        console.error("Errore reset timer:", e);
    }
};

export default function WorkoutTimer() {
    // Rest Timer State
    const [restState, setRestState] = useState<'stopped' | 'running' | 'paused'>(() => {
        const saved = localStorage.getItem('logbook_timer_state');
        return (saved as any) || 'stopped';
    });
    const [restStartTime, setRestStartTime] = useState<number>(() => {
        const saved = localStorage.getItem('logbook_timer_start');
        return saved ? parseInt(saved, 10) : 0;
    });
    const [restAccumulated, setRestAccumulated] = useState<number>(() => {
        const saved = localStorage.getItem('logbook_timer_accumulated');
        return saved ? parseInt(saved, 10) : 0;
    });
    const [restDisplay, setRestDisplay] = useState('00:00');

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
        if (restState === 'stopped' && restStartTime === 0 && restAccumulated === 0) {
            localStorage.removeItem('logbook_timer_state');
            localStorage.removeItem('logbook_timer_start');
            localStorage.removeItem('logbook_timer_accumulated');
            return;
        }
        localStorage.setItem('logbook_timer_state', restState);
        localStorage.setItem('logbook_timer_start', restStartTime.toString());
        localStorage.setItem('logbook_timer_accumulated', restAccumulated.toString());
    }, [restState, restStartTime, restAccumulated]);

    // Rest Timer Ticker
    useEffect(() => {
        if (restState !== 'running') return;

        const interval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - restStartTime + restAccumulated) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            setRestDisplay(`${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
        }, 1000);

        return () => clearInterval(interval);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '0 10px' }}>
            <span className="timer-display" style={{ fontSize: '1.6rem', fontFamily: 'monospace', fontWeight: 'bold', color: restState === 'running' ? 'var(--warning-color)' : '#fff', letterSpacing: '2px' }}>
                {restDisplay}
            </span>
            <div className="timer-controls" style={{ display: 'flex', gap: '8px' }}>
                {restState !== 'running' ? (
                    <button type="button" className="timer-btn play" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={startRest} title="Avvia recupero">▶</button>
                ) : (
                    <button type="button" className="timer-btn pause" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={pauseRest} title="Pausa recupero">⏸</button>
                )}
                <button type="button" className="timer-btn reset" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={resetRest} title="Riavvia recupero">🔄</button>
                <button type="button" className="timer-btn stop" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={stopRest} title="Fermare recupero">⏹</button>
            </div>
        </div>
    );
}
