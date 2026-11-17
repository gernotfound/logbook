import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithAuthenticatedTestOwner, renderWithProviders, emptyUserData } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import WorkoutTimer from '../../../src/components/Training/WorkoutTimer';
import { stoppedWorkoutTimer, writeWorkoutTimerSnapshot } from '../../../src/lib/utils/timer';
import { storageOwner } from '../../../src/lib/sync/session';
import { useAuth } from '../../../src/hooks/useAuth';

const ReadyOwner = () => {
  const { currentUser, loading } = useAuth();
  return <output data-testid="authenticated-owner">{!loading && currentUser ? currentUser.uid : 'pending'}</output>;
};

describe('Workout timer and session fail-safe', () => {
  beforeEach(async () => { await prepareUnlockedTestArchive(); });

    test('WorkoutTimer handles absent, stopped and future device-timer snapshots', () => {
      const owner = storageOwner();
      const { container: c1, unmount: unmount1 } = renderWithProviders(<WorkoutTimer />);
      expect(c1.textContent).toContain('00:00');
      unmount1();

      writeWorkoutTimerSnapshot(stoppedWorkoutTimer(), owner);
      const { container: c2, unmount: unmount2 } = renderWithProviders(<WorkoutTimer />);
      expect(c2.textContent).toContain('00:00');
      unmount2();

      // A clock value in the future must not render a negative duration.
      writeWorkoutTimerSnapshot({
        version: 1, state: 'running',
        startTime: Date.now() + 10000, accumulated: 0,
      }, owner);
      const { container: c3 } = renderWithProviders(<WorkoutTimer />);
      expect(c3.textContent).toContain('00:00');
    });

    test('WorkoutTimer rest controls (Play, Pause, Reset, Stop) operate cleanly without state crashes', async () => {
      // The previous case deliberately leaves a running future snapshot. Start
      // from a known *durably committed* stopped timer, not leaked test state.
      writeWorkoutTimerSnapshot(stoppedWorkoutTimer(), storageOwner());
      const { container } = renderWithProviders(<><ReadyOwner /><WorkoutTimer /></>);
      await waitFor(() => expect(screen.getByTestId('authenticated-owner').textContent).toBe('test-user-id'));

      const playBtn = container.querySelector('.timer-btn.play') as HTMLButtonElement;
      expect(playBtn).not.toBeNull();

      act(() => {
        fireEvent.click(playBtn);
      });

      const pauseBtn = container.querySelector('.timer-btn.pause') as HTMLButtonElement;
      expect(pauseBtn).not.toBeNull();

      act(() => {
        fireEvent.click(pauseBtn);
      });

      const resetBtn = container.querySelector('.timer-btn.reset') as HTMLButtonElement;
      expect(resetBtn).not.toBeNull();
      act(() => {
        fireEvent.click(resetBtn);
      });

      const stopBtn = container.querySelector('.timer-btn.stop') as HTMLButtonElement;
      expect(stopBtn).not.toBeNull();
      act(() => {
        fireEvent.click(stopBtn);
      });

      expect(container.textContent).toContain('00:00');
    });

    test('TrainingSession handles active workout with empty sets and non-numeric inputs', () => {
      const emptySetWorkout = {
        id: 'w_empty',
        routineId: 'r1',
        routineName: 'Scheda Test Empty',
        date: '2026-07-26',
        globalStartTime: Date.now(),
        exercises: [
          {
            exId: 'ex1',
            sets: [],
            sessionNote: ''
          },
          {
            exId: 'ex2',
            sets: [{ id: 's1', kg: '', reps: '' }, { id: 's2', kg: '-10', reps: '0' }],
            sessionNote: null
          }
        ]
      };

      const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, { 
        localWorkout: emptySetWorkout,
        userData: { ...emptyUserData, activeWorkout: emptySetWorkout } as any
      });
      expect(container.textContent).toContain('Scheda Test Empty');
    });
});
