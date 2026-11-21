import { describe, test, expect, beforeEach } from 'vitest';
import { captureSession } from '../../../src/lib/sync/session';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import React from 'react';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders, renderWithAuthenticatedTestOwner, emptyUserData } from '../../setup';
import { parseManualDuration } from '../../../src/lib/utils/date';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import TrainingHistory from '../../../src/components/Training/TrainingHistory';
import TrainingView from '../../../src/components/Training/TrainingView';
import type { WorkoutSession, TrainingSubTab } from '../../../src/types';

describe('Historical workout editing flow', () => {
  beforeEach(() => { localStorage.clear(); });

  describe('4. Historical Workout Editing Flow', () => {
    test('TrainingHistory renders edit button and triggers onEditWorkout callback', () => {
      let editedWorkout: WorkoutSession | null = null;

      const mockHistory: WorkoutSession[] = [
        {
          id: 'w_hist_1',
          routineId: 'r1',
          routineName: 'Push Day A',
          date: '2026-08-01',
          globalStartTime: 1722500000000,
          globalEndTime: 1722503600000,
          globalDurationStr: '01:00:00',
          moodRating: 4,
          pumpRating: 5,
          fatigueRating: 4,
          waterLiters: 1.5,
          exercises: [
            {
              exId: 'ex1',
              sets: [{ id: 's1', kg: '80', reps: '10' }],
              sessionNote: 'Good focus'
            }
          ]
        }
      ];

      const { container } = renderWithProviders(
        <TrainingHistory onEditWorkout={(w) => { editedWorkout = w; }} />,
        {
          userData: { ...emptyUserData, history: mockHistory }
        }
      );

      expect(container.textContent).toContain('Push Day A');
      const triggerBtn = screen.getByRole('button', { name: /opzioni/i });
      expect(triggerBtn).not.toBeNull();

      act(() => {
        fireEvent.click(triggerBtn);
      });

      const editBtn = screen.getByRole('menuitem', { name: /modifica allenamento/i });
      expect(editBtn).not.toBeNull();

      act(() => {
        fireEvent.click(editBtn);
      });

      expect(editedWorkout).not.toBeNull();
      expect(editedWorkout).toMatchObject({ id: 'w_hist_1' });
    });

    test('strict manual-duration parsing rejects malformed timestamps without silently changing them', () => {
      expect(parseManualDuration('01:23:45')).toBe('01:23:45');
      expect(parseManualDuration('75 min')).toBe('01:15:00');
      expect(parseManualDuration('75:15')).toBe('01:15:15');
      expect(parseManualDuration('0')).toBe('00:00:00');
      expect(parseManualDuration('')).toBe('00:00:00');
      for (const value of ['00:90:00', '10:99', '1:2:3:4', '45 min junk', '1abc', '-1', 'Infinity', '999999999999999999999 min']) {
        expect(parseManualDuration(value)).toBeNull();
      }
    });

    test('history duration input preserves the draft while editing and on invalid blur', async () => {
      const owner = captureSession().owner;
      if (owner.startsWith('user:')) {
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
      }
      await prepareUnlockedTestArchive(owner);
      const editingSession = {
        id: 'duration-draft', originalHistoryId: 'duration-draft', isEditingHistory: true,
        date: '2026-08-01', routineName: 'Durata',
        globalDurationStr: '00:45:00', manualDurationStr: '00:45:00', exercises: [],
      } as WorkoutSession;
      const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
        localWorkout: editingSession, userData: { ...emptyUserData } as any, dataOwner: owner,
      });
      const input = container.querySelector('#workout-manual-duration') as HTMLInputElement;
      act(() => { fireEvent.change(input, { target: { value: '00:90:00' } }); });
      expect(input.value).toBe('00:90:00');
      act(() => { fireEvent.blur(input); });
      expect(input.value).toBe('00:90:00');
      act(() => { fireEvent.change(input, { target: { value: '75 min' } }); });
      act(() => { fireEvent.blur(input); });
      expect(input.value).toBe('01:15:00');
    });

    test('TrainingSession in isEditingHistory mode renders banner, manual duration and "Salva Modifica"', () => {
      const editingSession: WorkoutSession = {
        id: 'w_editing',
        originalHistoryId: 'w_hist_1',
        isEditingHistory: true,
        routineId: 'r1',
        routineName: 'Push Day Modificata',
        date: '2026-08-01',
        globalDurationStr: '00:45:00',
        manualDurationStr: '00:45:00',
        moodRating: 4,
        pumpRating: 5,
        fatigueRating: 5,
        waterLiters: 2.0,
        exercises: [
          {
            exId: 'ex1',
            sets: [{ id: 's1', kg: '85', reps: '8' }],
            sessionNote: 'Modificato'
          }
        ]
      };

      const { container } = renderWithProviders(<TrainingSession />, {
        localWorkout: editingSession,
        userData: { ...emptyUserData, library: [{ id: 'ex1', name: 'Panca Piana', setsCount: 3, sets: [] }] }
      });

      // Verify banner
      expect(container.textContent).toContain('Modifica allenamento dello storico');

      // Verify manual duration input exists
      const durationInput = container.querySelector('#workout-manual-duration') as HTMLInputElement;
      expect(durationInput).not.toBeNull();
      expect(durationInput.value).toBe('00:45:00');

      // Verify "Salva modifiche" button is present instead of "Termina sessione"
      expect(screen.getByText(/Salva modifiche/i)).not.toBeNull();
      expect(screen.queryByText(/Termina sessione/i)).toBeNull();
    });

    test('TrainingView full integration: edit from history switches sub-tab to session in edit mode', async () => {
      const owner = captureSession().owner;
      if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
      await prepareUnlockedTestArchive(owner);
      const mockHistory: WorkoutSession[] = [
        {
          id: 'w_hist_test',
          routineId: 'r1',
          routineName: 'Gambe Hardcore',
          date: '2026-08-02',
          globalStartTime: 1722500000000,
          globalEndTime: 1722504000000,
          globalDurationStr: '01:06:40',
          exercises: []
        }
      ];

      const ControlledTrainingView = () => {
        const [subTab, setSubTab] = React.useState<TrainingSubTab>('history');
        return <TrainingView subTab={subTab} setSubTab={setSubTab} />;
      };

      renderWithProviders(
        <ControlledTrainingView />,
        {
          localWorkout: null,
          userData: { ...emptyUserData, activeWorkout: null, history: mockHistory } as any
        }
      );

      const triggerBtn = await screen.findByRole('button', { name: /opzioni/i });
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const editBtn = screen.getByRole('menuitem', { name: /modifica allenamento/i });
      await act(async () => {
        fireEvent.click(editBtn);
      });

      expect(screen.getByRole('tab', { name: 'Sessione' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('tabpanel', { name: 'Sessione' })).toBeDefined();
      expect(screen.getByText('Modifica allenamento dello storico')).toBeDefined();
      expect(screen.getByText(/Salva modifiche/i)).toBeDefined();
    });
  });
});
