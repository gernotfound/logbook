import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWakeLock } from '../src/hooks/useWakeLock';

// -------- Helpers --------

function makeSentinel() {
    const listeners: Record<string, (() => void)[]> = {};
    const sentinel = {
        released: false,
        release: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn((event: string, cb: () => void) => {
            listeners[event] = listeners[event] || [];
            listeners[event].push(cb);
        }),
        removeEventListener: vi.fn(),
        _emit: (event: string) => { listeners[event]?.forEach(fn => fn()); },
    };
    return sentinel;
}

// -------- Setup / Teardown --------

let mockRequest: ReturnType<typeof vi.fn>;
let sentinel: ReturnType<typeof makeSentinel>;

beforeEach(() => {
    sentinel = makeSentinel();
    mockRequest = vi.fn().mockResolvedValue(sentinel);
    Object.defineProperty(navigator, 'wakeLock', {
        value: { request: mockRequest },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
        writable: true,
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -------- Tests --------

describe('useWakeLock', () => {
    it('non chiama wakeLock.request quando enabled=false', () => {
        renderHook(() => useWakeLock(false));
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('chiama wakeLock.request quando enabled=true e documento visibile', async () => {
        renderHook(() => useWakeLock(true));
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledWith('screen'));
    });

    it('non genera errori se navigator.wakeLock non esiste (API assente)', () => {
        Object.defineProperty(navigator, 'wakeLock', {
            value: undefined,
            configurable: true,
            writable: true,
        });
        expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('fallisce silenziosamente se la richiesta viene rifiutata', async () => {
        mockRequest.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
        const spy = vi.spyOn(console, 'error');
        renderHook(() => useWakeLock(true));
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalled());
        expect(spy).not.toHaveBeenCalled();
    });

    it('rilascia il sentinel quando enabled diventa false', async () => {
        const { rerender } = renderHook(({ e }) => useWakeLock(e), { initialProps: { e: true } });
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalled());
        rerender({ e: false });
        expect(sentinel.release).toHaveBeenCalled();
    });

    it('rilascia il sentinel al unmount', async () => {
        const { unmount } = renderHook(() => useWakeLock(true));
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalled());
        unmount();
        expect(sentinel.release).toHaveBeenCalled();
    });

    it('rilascia il sentinel quando visibilità passa a hidden', async () => {
        renderHook(() => useWakeLock(true));
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalled());
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(sentinel.release).toHaveBeenCalled();
    });

    it('riacquisisce il lock quando visibilità torna visible con enabled=true', async () => {
        renderHook(() => useWakeLock(true));
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
        // Simula background
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        // Simula ritorno in foreground
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
    });

    it('NON riacquisisce il lock quando visibilità torna visible ma enabled=false', async () => {
        const { rerender } = renderHook(({ e }) => useWakeLock(e), { initialProps: { e: true } });
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
        rerender({ e: false });
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        // Nessuna nuova richiesta
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('gestisce la race condition: sentinel tardivo viene rilasciato se già smontato', async () => {
        let resolveSentinel!: (s: any) => void;
        mockRequest.mockReturnValue(new Promise(r => { resolveSentinel = r; }));
        const { unmount } = renderHook(() => useWakeLock(true));
        // Smonta prima che la Promise si risolva
        unmount();
        // Ora la Promise si risolve (troppo tardi)
        const lateSentinel = makeSentinel();
        resolveSentinel(lateSentinel);
        await vi.waitFor(() => expect(lateSentinel.release).toHaveBeenCalled());
    });

    it("l'evento 'release' del sentinel azzera il ref interno senza loop", async () => {
        renderHook(() => useWakeLock(true));
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalled());
        // L'OS rilascia spontaneamente il sentinel
        sentinel._emit('release');
        // Non deve tentare una riacquisizione automatica
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });
});
