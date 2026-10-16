import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NutritionView from '../src/components/Nutrition/NutritionView';

vi.mock('../src/components/Nutrition/NutritionMeals', () => ({
    default: ({ selectedDate, setSelectedDate }: {
        selectedDate: string;
        setSelectedDate: (day: string) => void;
    }) => (
        <div>
            <output data-testid="selected-nutrition-day">{selectedDate}</output>
            <button type="button" onClick={() => setSelectedDate('2026-10-18')}>Select history day</button>
            <button type="button" onClick={() => setSelectedDate('2026-10-21')}>Return to today</button>
        </div>
    ),
}));
vi.mock('../src/hooks/useNutritionMeals', () => ({ useNutritionMeals: () => ({}) }));
vi.mock('../src/hooks/useNutritionHistory', () => ({ useNutritionHistory: () => ({ nutritionHistory: [] }) }));
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ currentUser: null }) }));
vi.mock('../src/store/useAppStore', () => ({
    useAppStore: (select: (state: unknown) => unknown) => select({
        userData: { pendingConflicts: undefined },
        resolveNutritionConflict: vi.fn(),
    }),
}));
vi.mock('../src/store/useDialogStore', () => ({
    useDialogStore: (select: (state: unknown) => unknown) => select({ showAlert: vi.fn() }),
}));

describe('NutritionView follows the current local day', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('advances at midnight but preserves a deliberately chosen historical date', async () => {
        vi.useFakeTimers();
        vi.stubEnv('TZ', 'Europe/Rome');
        vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 58));
        render(<NutritionView />);
        const selectedDay = screen.getByTestId('selected-nutrition-day');
        expect(selectedDay.textContent).toBe('2026-10-19');

        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
        expect(selectedDay.textContent).toBe('2026-10-20');

        fireEvent.click(screen.getByRole('button', { name: 'Select history day' }));
        expect(selectedDay.textContent).toBe('2026-10-18');

        await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); });
        expect(selectedDay.textContent).toBe('2026-10-18');

        fireEvent.click(screen.getByRole('button', { name: 'Return to today' }));
        expect(selectedDay.textContent).toBe('2026-10-21');
    });
});
