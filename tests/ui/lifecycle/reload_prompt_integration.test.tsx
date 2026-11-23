import React from 'react';
import type { Exercise, UserData, WorkoutSession } from '../../../src/types';
import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import ReloadPrompt from '../../../src/components/UI/ReloadPrompt';
import { useRegisterSW } from '../../../src/lib/pwaRegistration';
import App from '../../../src/App';
import { emptyUserData, renderWithAuthenticatedTestOwner } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { useAppStore } from '../../../src/store/useAppStore';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import { captureSession } from '../../../src/lib/sync/session';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import * as pwaUpdateModule from '../../../src/lib/pwaUpdate';
import { setupReloadPromptTest, teardownReloadPromptTest, mockSetNeedRefresh, mockUpdateServiceWorker } from './reloadPromptTestFixture';

describe('PWA reload integration, accessibility and failures', () => {
  beforeEach(setupReloadPromptTest);
  afterEach(teardownReloadPromptTest);

  test('R3: the global ReloadPrompt coexists with App and renders the update banner', async () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    renderWithAuthenticatedTestOwner(<><ReloadPrompt /><App /></>);
    expect(await screen.findByRole('navigation', { name: 'Navigazione principale' })).toBeDefined();

    // Verify the root-level prompt is independent from App early-return states
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();
    expect(screen.getByRole('button', { name: /Aggiorna/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Chiudi/i })).toBeDefined();
  });

  test('keeps a real workout set editable while the PWA update prompt is visible', async () => {
    const owner = captureSession().owner;
    if (owner.startsWith('user:')) {
      localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
    }
    await prepareUnlockedTestArchive(owner);

    const activeWorkout: WorkoutSession = {
      id: 'pwa-editor-session',
      routineId: 'r1',
      routineName: 'Scheda A - Upper',
      date: '2026-08-20',
      globalStartTime: Date.now(),
      exercises: [{
        id: 'session-ex1',
        exId: 'ex1',
        sessionNote: '',
        sets: [{ id: 's1', kg: '80', reps: '10' }],
      }],
    };
    const library: Exercise[] = [{
      id: 'ex1', name: 'Panca Piana', setsCount: 1, sets: [], trackingType: 'weight_reps',
    }];
    const userData: UserData = {
      ...emptyUserData,
      library,
      activeWorkout,
      routines: [{ id: 'r1', name: 'Scheda A - Upper', exercises: [{ exId: 'ex1', setsCount: 1 }] }],
    };
    await initializeLocal(owner, userData);
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    renderWithAuthenticatedTestOwner(<><ReloadPrompt /><TrainingSession /></>, {
      localWorkout: activeWorkout, userData,
    });
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();

    const exercise = screen.getByRole('button', { name: /Panca Piana/i });
    fireEvent.click(exercise);
    expect(exercise.getAttribute('aria-expanded')).toBe('true');
    const weight = screen.getByPlaceholderText('Kg') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(weight, { target: { value: '82' } });
      fireEvent.blur(weight);
    });
    await waitFor(() => expect(useAppStore.getState().localWorkout?.exercises[0].sets[0].kg).toBe('82'));

    expect(weight.value).toBe('82');
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
    expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
  });

  test('Edge Case: shows an activation rejection without reloading or hiding the prompt', async () => {
    await prepareUnlockedTestArchive('user:test-user-id');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const rejectingUpdate = vi.spyOn(pwaUpdateModule, 'applyPWAUpdate')
      .mockRejectedValue(new Error('Failed to postMessage to SW'));

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    render(<ReloadPrompt />);

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    expect(rejectingUpdate).toHaveBeenCalledOnce();
    expect(screen.getByText('Failed to postMessage to SW')).toBeDefined();
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('Edge Case: Handles navigator.serviceWorker.getRegistration() promise rejection on visibilitychange', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockGetRegistration = vi.fn().mockRejectedValue(new Error('Security error'));

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: mockGetRegistration,
      },
      writable: true,
      configurable: true,
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { unmount } = render(<ReloadPrompt />);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockGetRegistration).toHaveBeenCalledOnce();
    expect(mockSetNeedRefresh).not.toHaveBeenCalledWith(true);
    expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    unmount();
    consoleSpy.mockRestore();
  });

  test('Edge Case: Periodic timer handles SW registration update rejection gracefully', async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let registeredCallback: ((scriptUrl: string, r: any) => void) | undefined;

    vi.mocked(useRegisterSW).mockImplementation((options) => {
      registeredCallback = options?.onRegisteredSW;
      return {
        needRefresh: [false, mockSetNeedRefresh],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: mockUpdateServiceWorker,
      };
    });

    const { unmount } = render(<ReloadPrompt />);

    const mockRegistration = {
      update: vi.fn().mockRejectedValue(new Error('Network error during periodic update')),
    };

    act(() => {
      registeredCallback!('/sw.js', mockRegistration);
    });

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(mockRegistration.update).toHaveBeenCalledTimes(2);
    await act(async () => { await Promise.resolve(); });
    expect(consoleSpy).toHaveBeenCalledWith('SW update error:', expect.any(Error));

    unmount();
    consoleSpy.mockRestore();
    vi.useRealTimers();
  });

  test('Mobile Accessibility: Verifies accessibility, aria-labels and aria-live announcements', () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { container } = render(<ReloadPrompt />);

    // Scope accessibility assertions to this component. Other independent
    // live regions (including a protected-vault storage failure) must not be
    // mistaken for the update toast or mask its aria-live contract.
    const alertContainer = within(container).getByRole('alert');
    expect(alertContainer.getAttribute('aria-live')).toBe('polite');
    expect(alertContainer.getAttribute('aria-atomic')).toBe('true');

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    const closeBtn = screen.getByRole('button', { name: /Chiudi/i });

    expect(updateBtn.getAttribute('aria-label')).toBe('Aggiorna applicazione');
    expect(closeBtn.getAttribute('aria-label')).toBe('Chiudi notifica');
    expect(updateBtn.className).toContain('btn-primary');
    expect(closeBtn.className).toContain('btn-secondary');
  });

  test('Edge Case: Handles synchronous exception thrown by r.update() in periodic timer', async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let registeredCallback: ((scriptUrl: string, r: any) => void) | undefined;

    vi.mocked(useRegisterSW).mockImplementation((options) => {
      registeredCallback = options?.onRegisteredSW;
      return {
        needRefresh: [false, mockSetNeedRefresh],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: mockUpdateServiceWorker,
      };
    });

    const { unmount } = render(<ReloadPrompt />);

    const mockRegistration = {
      update: vi.fn().mockImplementation(() => {
        throw new Error('Sync throw during update');
      }),
    };

    act(() => {
      registeredCallback!('/sw.js', mockRegistration);
    });

    // Advance 60 minutes - should not crash
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(mockRegistration.update).toHaveBeenCalledTimes(2);
    await act(async () => { await Promise.resolve(); });
    expect(consoleSpy).toHaveBeenCalledWith('SW update error:', expect.any(Error));

    unmount();
    consoleSpy.mockRestore();
    vi.useRealTimers();
  });

  test('Edge Case: Handles synchronous exception thrown by reg.update() on visibilitychange', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockGetRegistration = vi.fn().mockResolvedValue({
      update: vi.fn().mockImplementation(() => {
        throw new Error('Sync throw on visibility update');
      }),
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: mockGetRegistration,
      },
      writable: true,
      configurable: true,
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { unmount } = render(<ReloadPrompt />);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockGetRegistration).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('SW visibility update error:', expect.any(Error));

    unmount();
    consoleSpy.mockRestore();
  });

  test('Edge Case: Handles synchronous exception in manual worker activation on click', async () => {
    await prepareUnlockedTestArchive('user:test-user-id');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const throwingUpdate = vi.spyOn(pwaUpdateModule, 'applyPWAUpdate').mockImplementation(() => {
      throw new Error('Immediate sync throw');
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    render(<ReloadPrompt />);

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    expect(throwingUpdate).toHaveBeenCalledOnce();
    expect(screen.getByText('Immediate sync throw')).toBeDefined();
    consoleSpy.mockRestore();
  });
});
