import { useState, useEffect } from 'react';

interface WorkoutTimerProps {
    globalStartTime?: number;
}

export default function WorkoutTimer({ globalStartTime }: WorkoutTimerProps) {
    const [timerDisplay, setTimerDisplay] = useState('00:00');

    // Rest Timer State
    const [restState, setRestState] = useState<'stopped' | 'running' | 'paused'>('stopped');
    const [restStartTime, setRestStartTime] = useState<number>(0);
    const [restAccumulated, setRestAccumulated] = useState<number>(0);
    const [restDisplay, setRestDisplay] = useState('00:00');

    // Workout Global Duration Ticker
    useEffect(() => {
        if (!globalStartTime) return;
        
        const interval = setInterval(() => {
            const diff = Math.floor((Date.now() - globalStartTime) / 1000);
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            if (h > 0) {
                setTimerDisplay(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
            } else {
                setTimerDisplay(`${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
            }
        }, 1000);
        
        return () => clearInterval(interval);
    }, [globalStartTime]);

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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', fontFamily: 'monospace', color: 'var(--primary-color)', margin: 0 }}>
                {timerDisplay}
            </div>

            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '6px 14px',
                borderRadius: '20px',
                border: '1px solid var(--glass-border)'
            }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    ⏱️ Recupero:
                </span>
                <span className="timer-display" style={{ fontSize: '1.2rem', fontFamily: 'monospace', fontWeight: 'bold', color: restState === 'running' ? 'var(--warning-color)' : '#fff' }}>
                    {restDisplay}
                </span>
                <div className="timer-controls">
                    {restState !== 'running' ? (
                        <button type="button" className="timer-btn play" onClick={startRest} title="Avvia recupero">▶</button>
                    ) : (
                        <button type="button" className="timer-btn pause" onClick={pauseRest} title="Pausa recupero">⏸</button>
                    )}
                    <button type="button" className="timer-btn reset" onClick={resetRest} title="Riavvia recupero">🔄</button>
                    <button type="button" className="timer-btn stop" onClick={stopRest} title="Fermare recupero">⏹</button>
                </div>
            </div>
        </div>
    );
}
