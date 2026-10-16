import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useLocalToday } from '../src/hooks/useLocalToday';
import { calculateCycleTimeline } from '../src/lib/calc/planning';
import type { TrainingCycle } from '../src/types';

const cycle: TrainingCycle = {
    id: 'cycle-midnight',
    name: 'Ciclo',
    startDate: '2026-10-13',
    durationWeeks: 2,
    sessionsPerWeek: 1,
    routines: [{ routineId: 'routine-1', frequencyPerWeek: 1 }],
};

function ProgressProbe() {
    const today = useLocalToday();
    const progress = calculateCycleTimeline(cycle, today);
    return <p data-testid="day-progress">{today} / {progress.currentWeek}</p>;
}

describe('training cycle local-day progress', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('keeps one local-day clock for multiple subscribers and cleans up on unmount', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 12, 0, 0));
        const view = render(<><ProgressProbe /><ProgressProbe /></>);
        expect(vi.getTimerCount()).toBe(1);
        view.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reconciles an actual timezone change on visibility and keeps one clock', async () => {
        vi.useFakeTimers();
        vi.stubEnv('TZ', 'Europe/Rome');
        vi.setSystemTime(new Date('2026-10-19T22:30:00.000Z'));
        const view = render(<ProgressProbe />);
        expect(screen.getByTestId('day-progress').textContent).toContain('2026-10-20');
        expect(vi.getTimerCount()).toBe(1);

        vi.stubEnv('TZ', 'Pacific/Honolulu');
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(screen.getByTestId('day-progress').textContent).toContain('2026-10-19');
        expect(vi.getTimerCount()).toBe(1);

        view.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('handles a DST transition without skipping or duplicating the local date', async () => {
        vi.useFakeTimers();
        vi.stubEnv('TZ', 'Europe/Rome');
        vi.setSystemTime(new Date('2026-10-25T00:59:58.000Z'));
        render(<ProgressProbe />);
        expect(screen.getByTestId('day-progress').textContent).toContain('2026-10-25');

        // Clocks move back from 03:00 CEST to 02:00 CET: still the same local day.
        await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
        expect(screen.getByTestId('day-progress').textContent).toContain('2026-10-25');

        vi.setSystemTime(new Date('2026-10-25T22:59:58.000Z'));
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
        expect(screen.getByTestId('day-progress').textContent).toContain('2026-10-26');
    });

    it('updates without a data mutation on local midnight and focus', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 58));
        render(<ProgressProbe />);
        expect(screen.getByTestId('day-progress').textContent).toBe('2026-10-19 / 1');

        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
        expect(screen.getByTestId('day-progress').textContent).toBe('2026-10-20 / 2');

        vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        expect(screen.getByTestId('day-progress').textContent).toBe('2026-10-21 / 2');
    });
});
