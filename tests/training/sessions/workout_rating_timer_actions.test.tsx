import { describe, test, expect, beforeEach } from 'vitest';
import { deviceKey, protectedDeviceKey } from '../../../src/lib/sync/deviceStorage';
import { captureSession } from '../../../src/lib/sync/session';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import React from 'react';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders, renderWithAuthenticatedTestOwner } from '../../setup';
import { Logic } from '../../../src/lib/logic';
import WorkoutTimer from '../../../src/components/Training/WorkoutTimer';
import { readWorkoutTimerSnapshot, resetGlobalWorkoutTimer, writeWorkoutTimerSnapshot } from '../../../src/lib/utils/timer';

describe('Workout rating validation and owner-scoped timer actions', () => {
  beforeEach(() => { localStorage.clear(); });

  describe('1. Optional Session Rating Validation', () => {
    test('validateWorkoutRatings rejects the retired object-shaped rating aliases', () => {
      const result = Logic.validateWorkoutRatings({ moodRating: 4, pumpRating: 5, fatigueRating: 3 });
      expect(result.isValid).toBe(false);
      expect(result.mood).toBeNull();
      expect(result.pump).toBeNull();
      expect(result.fatigue).toBeNull();
      expect(result.errors.mood).not.toBeNull();
    });

    test('validateWorkoutRatings allows completely empty ratings', () => {
      const res = Logic.validateWorkoutRatings('', '', '');
      expect(res.isValid).toBe(true);
      expect(res.mood).toBeNull();
      expect(res.pump).toBeNull();
      expect(res.fatigue).toBeNull();
      expect(res.errors.mood).toBeNull();
      expect(res.errors.pump).toBeNull();
      expect(res.errors.fatigue).toBeNull();
    });

    test('validateWorkoutRatings allows null or undefined ratings', () => {
      const res = Logic.validateWorkoutRatings(null, undefined, null);
      expect(res.isValid).toBe(true);
      expect(res.mood).toBeNull();
      expect(res.pump).toBeNull();
      expect(res.fatigue).toBeNull();
    });

    test('validateWorkoutRatings allows partial ratings', () => {
      const res = Logic.validateWorkoutRatings(4, '', null);
      expect(res.isValid).toBe(true);
      expect(res.mood).toBe(4);
      expect(res.pump).toBeNull();
      expect(res.fatigue).toBeNull();
    });

    test('validateWorkoutRatings rejects out of range numbers', () => {
      const res = Logic.validateWorkoutRatings(15, 0, -2);
      expect(res.isValid).toBe(false);
      expect(res.errors.mood).not.toBeNull();
      expect(res.errors.pump).not.toBeNull();
      expect(res.errors.fatigue).not.toBeNull();
    });

    test('validateWorkoutRatings accepts only integer values from 1 to 5', () => {
      const outOfScale = Logic.validateWorkoutRatings('8', '5.5', 6);
      expect(outOfScale.isValid).toBe(false);
      expect(outOfScale.mood).toBeNull();
      expect(outOfScale.pump).toBeNull();
      expect(outOfScale.fatigue).toBeNull();
      expect(outOfScale.errors.mood).toContain('1 a 5');


      const res = Logic.validateWorkoutRatings('1', '5', '3');
      expect(res.isValid).toBe(true);
      expect(res.mood).toBe(1);
      expect(res.pump).toBe(5);
      expect(res.fatigue).toBe(3);
    });
  });

  describe('2. Top Timer Reset on Session Actions', () => {
    test('ignores a reset event for another owner without falsifying the displayed timer', async () => {
      const owner = captureSession().owner;
      await prepareUnlockedTestArchive(owner);
      const running = {
        version: 1 as const, state: 'running' as const,
        startTime: Date.now() - 70000, accumulated: 0,
      };
      writeWorkoutTimerSnapshot(running, owner);
      const { container } = renderWithAuthenticatedTestOwner(<WorkoutTimer />, { dataOwner: owner });
      expect(container.textContent).toContain('01:10');

      act(() => {
        window.dispatchEvent(new CustomEvent('logbook_reset_timer', {
          detail: { owner: 'user:another-account' },
        }));
      });
      expect(container.textContent).toContain('01:10');
      expect(readWorkoutTimerSnapshot(owner)).toEqual(running);
    });

    test('refuses a stale timer action instead of overwriting a newer device snapshot', async () => {
      const owner = captureSession().owner;
      await prepareUnlockedTestArchive(owner);
      writeWorkoutTimerSnapshot({ version: 1, state: 'stopped', startTime: 0, accumulated: 0 }, owner);
      renderWithAuthenticatedTestOwner(<WorkoutTimer />, { dataOwner: owner });
      expect(screen.getByRole('button', { name: 'Avvia recupero' })).toBeDefined();

      // Another tab wrote this state without notifying the mounted React component.
      const newer = {
        version: 1 as const, state: 'running' as const,
        startTime: Date.now() - 6000, accumulated: 0,
      };
      writeWorkoutTimerSnapshot(newer, owner);
      fireEvent.click(screen.getByRole('button', { name: 'Avvia recupero' }));

      expect(readWorkoutTimerSnapshot(owner)).toEqual(newer);
      expect(screen.getByText("Timer aggiornato da un'altra scheda. Ripeti l'azione per modificarlo.")).toBeDefined();
      expect(screen.getByRole('button', { name: 'Pausa recupero' })).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Pausa recupero' }));
      expect(readWorkoutTimerSnapshot(owner)).toMatchObject({
        version: 1, state: 'paused', startTime: 0,
      });
      expect(screen.queryByText("Timer aggiornato da un'altra scheda. Ripeti l'azione per modificarlo.")).toBeNull();
    });

    test('resetGlobalWorkoutTimer persists stopped snapshot and updates displayed timer', async () => {
      const owner = captureSession().owner;
      await prepareUnlockedTestArchive(owner);
      const running = { version: 1 as const, state: 'running' as const, startTime: Date.now() - 5000, accumulated: 0 };
      writeWorkoutTimerSnapshot(running, owner);
      const sealedKey = protectedDeviceKey('timer', owner);
      const before = localStorage.getItem(sealedKey);
      expect(before).toMatch(/^tlb-sealed:v1:/);
      expect(localStorage.getItem(deviceKey('timer', owner))).toBeNull();

      const { container } = renderWithProviders(<WorkoutTimer />);
      expect(readWorkoutTimerSnapshot(owner)).toEqual(running);

      act(() => {
        expect(resetGlobalWorkoutTimer(owner)).toBe(true);
      });

      expect(readWorkoutTimerSnapshot(owner)).toEqual({
        version: 1, state: 'stopped', startTime: 0, accumulated: 0,
      });
      expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
      expect(localStorage.getItem(sealedKey)).not.toBe(before);
      expect(localStorage.getItem(deviceKey('timer', owner))).toBeNull();
      expect(container.textContent).toContain('00:00');
    });
  });
});
