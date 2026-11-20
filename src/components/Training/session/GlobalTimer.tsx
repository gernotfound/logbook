import { useEffect, useState } from 'react';
import { Logic } from '../../../lib/logic';
import { resumeWorkoutClock, sampleWorkoutClock } from '../../../lib/workoutClockGuard';
import { useAppStore } from '../../../store/useAppStore';

export const GlobalTimer = ({ workoutId, startTime, isActive = true }: { workoutId: string; startTime?: number; isActive?: boolean }) => {
    const [display, setDisplay] = useState('00:00:00');
    const [clockAnomaly, setClockAnomaly] = useState(false);

    useEffect(() => {
        if (!startTime || !isActive) return;

        let anomalyReported = false;
        const surfaceClockAnomaly = () => {
            if (anomalyReported) return;
            anomalyReported = true;
            setClockAnomaly(true);
            useAppStore.getState().setSaveError(
                'L’orologio del dispositivo è cambiato durante l’allenamento. Correggi data/ora e riapri TheLogBook prima di terminare la sessione.',
            );
        };

        const updateDisplay = () => {
            const sample = sampleWorkoutClock(workoutId, startTime);
            if (sample.anomalous) surfaceClockAnomaly();
            const diff = Math.floor(sample.elapsedMs / 1000);
            setDisplay(Logic.formatDuration(diff));
        };

        let interval: ReturnType<typeof setInterval> | null = null;
        const stopRepaint = () => {
            if (interval !== null) clearInterval(interval);
            interval = null;
        };
        const startRepaint = () => {
            if (interval === null && document.visibilityState === 'visible') {
                interval = setInterval(updateDisplay, 1000);
            }
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState !== 'visible') {
                stopRepaint();
                return;
            }
            const resumed = resumeWorkoutClock(workoutId, startTime);
            if (resumed.anomalous) surfaceClockAnomaly();
            updateDisplay();
            startRepaint();
        };
        if (document.visibilityState === 'visible') {
            updateDisplay();
            startRepaint();
        }
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            stopRepaint();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [workoutId, startTime, isActive]);

    return (
        <div className="workout-total-duration">
            <span>Durata allenamento</span>
            <output>{display}</output>
            {clockAnomaly && (
                <p role="alert" className="text-muted">
                    Orologio del dispositivo modificato: la chiusura della sessione resta bloccata finché l’ora non viene corretta e l’app riaperta.
                </p>
            )}
        </div>
    );
};
