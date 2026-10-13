import React from 'react';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { useMetronome } from '../src/hooks/useMetronome';
import { renderWithProviders } from './setup';

let audioContextInstance: FakeAudioContext | null = null;
let releaseResume: (() => void) | null = null;
let originalAudioContextDescriptor: PropertyDescriptor | undefined;

class FakeAudioContext {
    state = 'running';
    currentTime = 10;
    destination = {};
    createOscillator = vi.fn(() => ({
        type: 'sine',
        frequency: {
            setValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
    }));
    createGain = vi.fn(() => ({
        gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
    }));
    resume = vi.fn(async () => {
        this.state = 'running';
    });
    close = vi.fn(async () => {
        this.state = 'closed';
    });

    constructor() {
        audioContextInstance = this;
    }
}

class SlowAudioContext extends FakeAudioContext {
    state = 'suspended';
    resume = vi.fn(() => new Promise<void>(resolve => {
        releaseResume = () => {
            this.state = 'running';
            resolve();
        };
    }));
}

const setAudioContext = (value: unknown) => {
    Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        writable: true,
        value,
    });
};

const openMetronome = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni timer' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Metronomo' }));
};

describe('Workout metronome', () => {
    beforeEach(() => {
        localStorage.clear();
        audioContextInstance = null;
        releaseResume = null;
        originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
    });

    afterEach(() => {
        vi.useRealTimers();
        if (originalAudioContextDescriptor) {
            Object.defineProperty(window, 'AudioContext', originalAudioContextDescriptor);
        } else {
            Reflect.deleteProperty(window, 'AudioContext');
        }
        vi.restoreAllMocks();
    });

    it('opens from the timer options menu and keeps BPM controls bounded', () => {
        setAudioContext(FakeAudioContext as unknown as typeof AudioContext);
        renderWithProviders(<WorkoutTimer />);

        expect(screen.queryByRole('spinbutton', { name: 'Battiti per minuto' })).toBeNull();

        openMetronome();

        const bpmInput = screen.getByRole('spinbutton', { name: 'Battiti per minuto' }) as HTMLInputElement;
        expect(bpmInput.value).toBe('120');

        fireEvent.click(screen.getByRole('button', { name: 'Aumenta BPM' }));
        expect(bpmInput.value).toBe('121');

        fireEvent.change(bpmInput, { target: { value: '999' } });
        fireEvent.blur(bpmInput);
        expect(bpmInput.value).toBe('240');

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni timer' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chiudi metronomo' }));
        expect(screen.queryByRole('spinbutton', { name: 'Battiti per minuto' })).toBeNull();
    });

    it('starts Web Audio from the user action and stops cleanly', async () => {
        vi.useFakeTimers();
        setAudioContext(FakeAudioContext as unknown as typeof AudioContext);
        renderWithProviders(<WorkoutTimer />);
        openMetronome();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Avvia' }));
            await Promise.resolve();
        });

        expect(audioContextInstance).not.toBeNull();
        expect(audioContextInstance?.createOscillator).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Ferma' }).getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Ferma' }));
        expect(screen.getByRole('button', { name: 'Avvia' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('does not autoplay and degrades explicitly when Web Audio is unavailable', () => {
        setAudioContext(undefined);
        renderWithProviders(<WorkoutTimer />);
        openMetronome();

        const startButton = screen.getByRole('button', { name: 'Avvia' }) as HTMLButtonElement;
        expect(startButton.disabled).toBe(true);
        expect(screen.getByText('Audio non disponibile su questo dispositivo.')).toBeDefined();
        expect(audioContextInstance).toBeNull();
    });
    it('starts only one scheduler when activation is requested twice before audio resume', async () => {
        vi.useFakeTimers();
        setAudioContext(SlowAudioContext as unknown as typeof AudioContext);
        const { result } = renderHook(() => useMetronome(120));
        let first!: Promise<boolean>;
        let second!: Promise<boolean>;
        act(() => {
            first = result.current.start();
            second = result.current.start();
        });
        expect((audioContextInstance as SlowAudioContext | null)?.resume).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);

        await act(async () => {
            releaseResume?.();
            expect(await Promise.all([first, second])).toEqual([true, true]);
        });
        expect(result.current.isRunning).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
        expect((audioContextInstance as SlowAudioContext | null)?.createOscillator).toHaveBeenCalledTimes(1);

        act(() => result.current.stop());
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not resurrect playback when stopped before audio resume settles', async () => {
        vi.useFakeTimers();
        setAudioContext(SlowAudioContext as unknown as typeof AudioContext);
        const { result } = renderHook(() => useMetronome(120));
        let startPromise!: Promise<boolean>;
        act(() => {
            startPromise = result.current.start();
            result.current.stop();
        });
        await act(async () => {
            releaseResume?.();
            expect(await startPromise).toBe(false);
        });
        expect(result.current.isRunning).toBe(false);
        expect((audioContextInstance as SlowAudioContext | null)?.createOscillator).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not schedule audio after the metronome has unmounted', async () => {
        vi.useFakeTimers();
        setAudioContext(SlowAudioContext as unknown as typeof AudioContext);
        const { result, unmount } = renderHook(() => useMetronome(120));
        let startPromise!: Promise<boolean>;
        act(() => { startPromise = result.current.start(); });
        unmount();
        await act(async () => {
            releaseResume?.();
            expect(await startPromise).toBe(false);
        });
        expect((audioContextInstance as SlowAudioContext | null)?.createOscillator).not.toHaveBeenCalled();
        expect((audioContextInstance as SlowAudioContext | null)?.close).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels a pending audio activation when the page becomes hidden', async () => {
        vi.useFakeTimers();
        setAudioContext(SlowAudioContext as unknown as typeof AudioContext);
        const { result } = renderHook(() => useMetronome(120));
        let startPromise!: Promise<boolean>;
        act(() => { startPromise = result.current.start(); });

        const previousVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        try {
            act(() => { document.dispatchEvent(new Event('visibilitychange')); });
            await act(async () => {
                releaseResume?.();
                expect(await startPromise).toBe(false);
            });
            expect(result.current.isRunning).toBe(false);
            expect((audioContextInstance as SlowAudioContext | null)?.createOscillator).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            if (previousVisibility) Object.defineProperty(document, 'visibilityState', previousVisibility);
            else Reflect.deleteProperty(document, 'visibilityState');
        }
    });

});
