import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRuntimeClock } from '../src/hooks/useRuntimeClock';

describe('audit regression: runtime clock', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-18T10:00:00'));
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible'
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('refreshes time-derived UI on the configured cadence', () => {
        const { result } = renderHook(() => useRuntimeClock(60_000));
        const initial = result.current;

        act(() => {
            vi.setSystemTime(new Date('2026-09-18T10:01:00'));
            vi.advanceTimersByTime(60_000);
        });

        expect(result.current).toBe(initial + 60_000);
    });

    it('pauses while hidden and refreshes immediately in the foreground', () => {
        const { result } = renderHook(() => useRuntimeClock(60_000));
        const initial = result.current;

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden'
        });
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
            vi.setSystemTime(new Date('2026-09-18T10:05:00'));
            vi.advanceTimersByTime(5 * 60_000);
        });
        expect(result.current).toBe(initial);

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible'
        });
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(result.current).toBe(initial + 5 * 60_000);
    });
});
