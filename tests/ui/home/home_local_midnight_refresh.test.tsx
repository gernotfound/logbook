import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHomeView } from '../../../src/hooks/useHomeView';
import { useAppStore } from '../../../src/store/useAppStore';
import { emptyUserData } from '../../setup';

afterEach(() => {
    vi.useRealTimers();
});

describe('Home daily summary at local midnight', () => {
    it('switches the displayed nutrition day at midnight without waiting for the minute-based muscle refresh', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 58));

        useAppStore.setState({
            userData: {
                ...emptyUserData,
                history: [],
                nutrition: {
                    '2026-10-19': { date: '2026-10-19', kcal: 1200, carbs: 130, pro: 70, fat: 30 },
                    '2026-10-20': { date: '2026-10-20', kcal: 250, carbs: 20, pro: 15, fat: 5 },
                },
            },
        });

        const view = renderHook(() => useHomeView(true));
        expect(view.result.current.loading).toBe(false);
        if (view.result.current.loading) throw new Error('Home data unavailable');
        expect(view.result.current.kcalEaten).toBe(1200);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(view.result.current.loading).toBe(false);
        if (view.result.current.loading) throw new Error('Home data unavailable');
        expect(view.result.current.kcalEaten).toBe(250);

        view.unmount();
    });
});
