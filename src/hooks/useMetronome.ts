import { useCallback, useEffect, useRef, useState } from 'react';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.08;
const CLICK_DURATION_SECONDS = 0.035;
const CLICK_FREQUENCY_HZ = 1000;

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
    if (typeof window === 'undefined') return null;
    const webkitWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
    return window.AudioContext ?? webkitWindow.webkitAudioContext ?? null;
}

export interface MetronomeController {
    isRunning: boolean;
    isSupported: boolean;
    error: string | null;
    start: () => Promise<boolean>;
    stop: () => void;
}

export function useMetronome(bpm: number): MetronomeController {
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const contextRef = useRef<AudioContext | null>(null);
    const schedulerRef = useRef<number | null>(null);
    const nextBeatTimeRef = useRef(0);
    const runningRef = useRef(false);
    const bpmRef = useRef(bpm);
    const scheduledOscillatorsRef = useRef(new Set<OscillatorNode>());

    const isSupported = getAudioContextConstructor() !== null;

    useEffect(() => {
        bpmRef.current = bpm;
    }, [bpm]);

    const clearScheduler = useCallback(() => {
        if (schedulerRef.current !== null) {
            window.clearInterval(schedulerRef.current);
            schedulerRef.current = null;
        }
    }, []);

    const stopScheduledClicks = useCallback(() => {
        for (const oscillator of scheduledOscillatorsRef.current) {
            try {
                oscillator.stop();
            } catch {
                // A node that already ended cannot be stopped twice; cleanup remains best-effort.
            }
        }
        scheduledOscillatorsRef.current.clear();
    }, []);

    const scheduleClick = useCallback((context: AudioContext, atTime: number) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(CLICK_FREQUENCY_HZ, atTime);
        gain.gain.setValueAtTime(0.0001, atTime);
        gain.gain.exponentialRampToValueAtTime(0.18, atTime + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, atTime + CLICK_DURATION_SECONDS);

        oscillator.connect(gain);
        gain.connect(context.destination);

        scheduledOscillatorsRef.current.add(oscillator);
        oscillator.onended = () => {
            scheduledOscillatorsRef.current.delete(oscillator);
            oscillator.disconnect();
            gain.disconnect();
        };

        oscillator.start(atTime);
        oscillator.stop(atTime + CLICK_DURATION_SECONDS);
    }, []);

    const runScheduler = useCallback(() => {
        const context = contextRef.current;
        if (!context || !runningRef.current || context.state !== 'running') return;

        const secondsPerBeat = 60 / bpmRef.current;
        const schedulingLimit = context.currentTime + SCHEDULE_AHEAD_SECONDS;

        while (nextBeatTimeRef.current < schedulingLimit) {
            scheduleClick(context, nextBeatTimeRef.current);
            nextBeatTimeRef.current += secondsPerBeat;
        }
    }, [scheduleClick]);

    const stop = useCallback(() => {
        runningRef.current = false;
        clearScheduler();
        stopScheduledClicks();
        setIsRunning(false);
    }, [clearScheduler, stopScheduledClicks]);

    const start = useCallback(async (): Promise<boolean> => {
        if (runningRef.current) return true;

        const AudioContextCtor = getAudioContextConstructor();
        if (!AudioContextCtor) {
            setError('Audio non disponibile su questo dispositivo.');
            return false;
        }

        try {
            let context = contextRef.current;
            if (!context || context.state === 'closed') {
                context = new AudioContextCtor();
                contextRef.current = context;
            }

            if (context.state !== 'running') {
                await context.resume();
            }

            if (context.state !== 'running') {
                throw new Error('Contesto audio non attivo');
            }

            setError(null);
            runningRef.current = true;
            setIsRunning(true);
            nextBeatTimeRef.current = context.currentTime + 0.03;
            runScheduler();
            schedulerRef.current = window.setInterval(runScheduler, LOOKAHEAD_MS);
            return true;
        } catch (cause) {
            console.error('Impossibile avviare il metronomo:', cause);
            runningRef.current = false;
            clearScheduler();
            stopScheduledClicks();
            setIsRunning(false);
            setError('Impossibile avviare il metronomo. Tocca di nuovo Avvia.');
            return false;
        }
    }, [clearScheduler, runScheduler, stopScheduledClicks]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && runningRef.current) {
                stop();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [stop]);

    useEffect(() => {
        return () => {
            runningRef.current = false;
            clearScheduler();
            stopScheduledClicks();

            const context = contextRef.current;
            contextRef.current = null;
            if (context && context.state !== 'closed') {
                void context.close().catch(() => {});
            }
        };
    }, [clearScheduler, stopScheduledClicks]);

    return { isRunning, isSupported, error, start, stop };
}
