import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { renderWithProviders } from './setup';

let audioContextInstance: FakeAudioContext | null = null;
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
});
