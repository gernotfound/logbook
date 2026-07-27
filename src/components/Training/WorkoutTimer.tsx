import { useState, useEffect } from 'react';

export default function WorkoutTimer() {
    // Rest Timer State
    const [restState, setRestState] = useState<'stopped' | 'running' | 'paused'>('stopped');
    const [restStartTime, setRestStartTime] = useState<number>(0);
    const [restAccumulated, setRestAccumulated] = useState<number>(0);
    const [restDisplay, setRestDisplay] = useState('00:00');

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
        <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '6px 14px',
                borderRadius: '20px',
                border: '1px solid var(--glass-border)'
            }}>
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
