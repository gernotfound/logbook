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

    test('WorkoutTimer pauses display repaint on an inactive section and refreshes on return', async () => {
        vi.useRealTimers();
        function Host() {
            const [active, setActive] = React.useState(true);
            return <><button onClick={() => setActive(value => !value)}>Cambia sezione</button><WorkoutTimer isActive={active} /></>;
        }
        renderWithProviders(<Host />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Avvia recupero' })).toBeDefined());
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-18T12:00:00'));
        fireEvent.click(screen.getByRole('button', { name: 'Avvia recupero' }));
        act(() => { vi.advanceTimersByTime(1500); });
        expect(screen.getByText('00:01')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Cambia sezione' }));
        act(() => { vi.advanceTimersByTime(3000); });
        expect(screen.getByText('00:01')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Cambia sezione' }));
        expect(screen.getByText('00:04')).toBeDefined();
    });

    test('useHomeView updates the recovery window without rescanning historical workout sets', () => {
        const now = Date.now();
        const exercises = [{ exId: 'ex_test', sets: [{ id: 'set-1', kg: '60', reps: '10' }] }];
        let exerciseReads = 0;
        const oldWorkout = {
            id: 'old-workout', globalStartTime: now - 365 * 24 * 60 * 60 * 1000,
            get exercises() { exerciseReads++; return exercises; },
        };
        const upcomingWorkout = {
            id: 'upcoming', globalStartTime: now + 30_000,
            exercises,
        };
        let current: ReturnType<typeof useHomeView> | null = null;
        function Consumer() {
            const value = useHomeView();
            React.useEffect(() => { current = value; });
            return <div />;
        }
        renderWithProviders(<Consumer />, {
            userData: {
                ...emptyUserData,
                library: [{ id: 'ex_test', name: 'Panca', muscles: ['chest_lower'], secondaryMuscles: [], setsCount: 1, sets: [] }],
                history: [oldWorkout, upcomingWorkout],
            } as any,
        });
        expect(exerciseReads).toBeGreaterThan(0);
        const readsAtInitialRender = exerciseReads;
        expect((current as any).muscleColors.chest_lower).toBeUndefined();

        act(() => { vi.advanceTimersByTime(60_000); });
        expect((current as any).muscleColors.chest_lower).toBe('var(--muscle-recent)');
        expect(exerciseReads).toBe(readsAtInitialRender);

        act(() => {
            vi.setSystemTime(new Date(now + 73 * 60 * 60 * 1000));
            vi.advanceTimersByTime(60_000);
        });
        expect((current as any).muscleColors.chest_lower).toBeUndefined();
        expect(exerciseReads).toBe(readsAtInitialRender);
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
