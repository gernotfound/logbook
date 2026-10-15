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
    });

    it('updates without a data mutation on local midnight and focus', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 58));
        render(<ProgressProbe />);
        expect(screen.getByTestId('day-progress').textContent).toBe('2026-10-19 / 1');

        act(() => vi.advanceTimersByTime(3000));
        expect(screen.getByTestId('day-progress').textContent).toBe('2026-10-20 / 2');

        vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
        act(() => window.dispatchEvent(new Event('focus')));
        expect(screen.getByTestId('day-progress').textContent).toBe('2026-10-21 / 2');
    });
});
