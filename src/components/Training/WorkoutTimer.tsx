import React, { useState, useEffect } from 'react';

export default function WorkoutTimer({ globalStartTime }) {
    const [timerDisplay, setTimerDisplay] = useState('00:00');

    useEffect(() => {
        if (!globalStartTime) return;
        
        const interval = setInterval(() => {
            const diff = Math.floor((new Date().getTime() - globalStartTime) / 1000);
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

    return <span>{timerDisplay}</span>;
}
