import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NutritionDateNavigator } from './NutritionDateNavigator';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('NutritionDateNavigator', () => {
    it('routes previous, next and today through the same selected-date callback', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 12));
        const setSelectedDate = vi.fn();

        render(<NutritionDateNavigator targetDateStr="2026-10-18" setSelectedDate={setSelectedDate} />);
        fireEvent.click(screen.getByRole('button', { name: /giorno precedente/i }));
        fireEvent.click(screen.getByRole('button', { name: /giorno successivo/i }));
        fireEvent.click(screen.getByRole('button', { name: /torna a oggi/i }));

        expect(setSelectedDate.mock.calls).toEqual([
            ['2026-10-17'],
            ['2026-10-19'],
            ['2026-10-19'],
        ]);
    });

    it('never advances past the local day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 12));
        const setSelectedDate = vi.fn();

        const view = render(<NutritionDateNavigator targetDateStr="2026-10-19" setSelectedDate={setSelectedDate} />);
        const next = screen.getByRole('button', { name: /giorno successivo/i });
        expect(next.hasAttribute('disabled')).toBe(true);
        fireEvent.click(next);
        view.rerender(<NutritionDateNavigator targetDateStr="2026-10-20" setSelectedDate={setSelectedDate} />);
        expect(next.hasAttribute('disabled')).toBe(true);
        fireEvent.click(next);
        expect(setSelectedDate).not.toHaveBeenCalled();
    });

    it('unblocks the next day when the local midnight passes without another data update', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 58));
        const setSelectedDate = vi.fn();

        render(<NutritionDateNavigator targetDateStr="2026-10-19" setSelectedDate={setSelectedDate} />);
        const next = screen.getByRole('button', { name: /giorno successivo/i });
        expect(next.hasAttribute('disabled')).toBe(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
        expect(next.hasAttribute('disabled')).toBe(false);

        fireEvent.click(next);
        expect(setSelectedDate).toHaveBeenCalledWith('2026-10-20');
    });
});
