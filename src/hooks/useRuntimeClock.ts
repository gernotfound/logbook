import { useEffect, useState } from 'react';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Low-frequency wall clock for UI calculations that genuinely decay with time.
 * The timer is suspended while the document is hidden and refreshed immediately
 * when the app returns to the foreground.
 */
export function useRuntimeClock(intervalMs: number = DEFAULT_INTERVAL_MS): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const cadence = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const clearTimer = () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        };

        const schedule = () => {
            clearTimer();
            if (document.visibilityState === 'hidden') return;
            timer = setTimeout(() => {
                setNow(Date.now());
                schedule();
            }, cadence);
        };

        const refresh = () => {
            setNow(Date.now());
            schedule();
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                clearTimer();
            } else {
                refresh();
            }
        };

        schedule();
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', refresh);
        return () => {
            clearTimer();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', refresh);
        };
    }, [intervalMs]);

    return now;
}
