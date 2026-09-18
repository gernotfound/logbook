import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { useHomeView } from '../src/hooks/useHomeView';
import { emptyUserData, renderWithProviders } from './setup';

describe('Audit regression: React time boundaries', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-18T12:00:00'));
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('WorkoutTimer derives elapsed display from timestamps and freezes cleanly when paused', () => {
        renderWithProviders(<WorkoutTimer />);

        expect(screen.getByText('00:00')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Avvia recupero' }));

        act(() => {
            vi.advanceTimersByTime(1500);
        });
        expect(screen.getByText('00:01')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'Pausa recupero' }));
        const pausedDisplay = screen.getByText('00:01').textContent;

        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(screen.getByText('00:01').textContent).toBe(pausedDisplay);
    });

    test('useHomeView expires fatigue as wall-clock time advances without store mutations', () => {
        const now = Date.now();
        const workoutTime = now - (((50 * 60 + 23) * 60 + 30) * 1000);
        let hookResult: ReturnType<typeof useHomeView> | null = null;

        function TestHomeConsumer() {
            hookResult = useHomeView();
            return <div data-testid="home-clock-consumer" />;
        }

        renderWithProviders(<TestHomeConsumer />, {
            userData: {
                ...emptyUserData,
                library: [{
                    id: 'ex_bench',
                    name: 'Panca piana',
                    muscles: ['chest_lower'],
                    secondaryMuscles: [],
                    setsCount: 1,
                    sets: []
                }],
                history: [{
                    id: 'w_recent',
                    date: '2026-09-16',
                    globalStartTime: workoutTime,
                    exercises: [{
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '80', reps: '8' }]
                    }]
                }]
            } as any
        });

        expect(hookResult).not.toBeNull();
        expect((hookResult as any).muscleColors.chest_lower).toBe('#f97316');

        act(() => {
            vi.advanceTimersByTime(60_000);
        });

        expect((hookResult as any).muscleColors.chest_lower).toBeUndefined();
    });
});
