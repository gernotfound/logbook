import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useAuth } from '../src/hooks/useAuth';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { useHomeView } from '../src/hooks/useHomeView';
import { emptyUserData, renderWithProviders } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';

describe('Audit regression: React time boundaries', () => {
    beforeEach(async () => {
        localStorage.clear();
        await prepareUnlockedTestArchive();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-18T12:00:00'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('WorkoutTimer derives elapsed display from timestamps and freezes cleanly when paused', async () => {
        // The standalone timer must wait for the same authenticated owner that
        // unlocks the encrypted device snapshot in the full application.
        vi.useRealTimers();
        function AuthReady() {
            const { currentUser, loading } = useAuth();
            return <output data-testid="timer-auth-ready">{!loading ? currentUser?.uid : ''}</output>;
        }
        renderWithProviders(<><AuthReady /><WorkoutTimer /></>);
        await waitFor(() => expect(screen.getByTestId('timer-auth-ready').textContent).toBe('test-user-id'));
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-18T12:00:00'));

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

    test('useHomeView expires recent exposure at the factual 72-hour boundary without store mutations', () => {
        const now = Date.now();
        const workoutTime = now - (((71 * 60 + 59) * 60 + 30) * 1000);
        let hookResult: ReturnType<typeof useHomeView> | null = null;

        function TestHomeConsumer() {
            const latest = useHomeView();
            React.useEffect(() => { hookResult = latest; });
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
        expect((hookResult as any).muscleColors.chest_lower).toBe('var(--muscle-recent)');

        act(() => {
            vi.advanceTimersByTime(60_000);
        });

        expect((hookResult as any).muscleColors.chest_lower).toBeUndefined();
    });
});
