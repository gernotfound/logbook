import { captureSession } from '../src/lib/sync/session';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import * as Sentry from '@sentry/react';
import { getTelemetryContext } from '../src/lib/telemetrySanitizer';
import { renderHook, act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { telemetryHub } from '../src/lib/telemetryHub';
import { seedCurrentTelemetryQueue } from './telemetry/seedCurrentQueue';
import { usePWAInstall } from '../src/hooks/usePWAInstall';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import SettingsView from '../src/components/SettingsView';
import type { UserData } from '../src/types';

describe('Milestone 2: PWA, offline workout and telemetry boundaries', () => {
  let mockSentryTransport: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();

    mockSentryTransport = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    telemetryHub.reset();
    window.dispatchEvent(new Event('appinstalled'));
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    telemetryHub.reset();
  });

  // =========================================================================
  // 1. PWA install behavior
  // =========================================================================
  describe('1. PWA install behavior without proprietary usage telemetry', () => {
    it('the real Sentry boundary accepts standalone events without capturing usage telemetry', async () => {
      // Queue stress tests mock the adapter to control latency. This test
      // separately verifies the actual external privacy boundary.
      mockSentryTransport.mockRestore();
      const exception = vi.spyOn(Sentry, 'captureException');
      const message = vi.spyOn(Sentry, 'captureMessage');
      const event = vi.spyOn(Sentry, 'captureEvent');

      const result = await sentryClient.sendTelemetryToSentry('event', {
        timestamp: Date.now(),
        type: 'workout_saved',
        context: getTelemetryContext(),
        userId: 'synthetic-uid',
        sessionId: 'synthetic-session',
      });
      expect(result).toBe(true);
      expect(exception).not.toHaveBeenCalled();
      expect(message).not.toHaveBeenCalled();
      expect(event).not.toHaveBeenCalled();
    });

    it('retains beforeinstallprompt even when it fires before Settings/usePWAInstall mounts', () => {
      const earlyEvent = new Event('beforeinstallprompt');
      Object.assign(earlyEvent, {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      });
      act(() => {
        window.dispatchEvent(earlyEvent);
      });

      const { result } = renderHook(() => usePWAInstall());
      expect(result.current.isInstallable).toBe(true);
      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });
    });

    it('handles beforeinstallprompt without emitting a proprietary usage event', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_pwa_test');

      const { result } = renderHook(() => usePWAInstall());
      expect(result.current.isInstallable).toBe(false);

      const mockPromptEvent = new Event('beforeinstallprompt');
      Object.assign(mockPromptEvent, {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });

      act(() => {
        window.dispatchEvent(mockPromptEvent);
      });

      expect(result.current.isInstallable).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSentryTransport.mock.calls.some((c: any) => c[1].type === 'pwa_install_impression')).toBe(false);
    });

    it('runs promptInstall for an accepted choice without proprietary funnel telemetry', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_pwa_test');

      const { result } = renderHook(() => usePWAInstall());

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const mockPromptEvent = new Event('beforeinstallprompt');
      Object.assign(mockPromptEvent, {
        prompt: mockPrompt,
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });

      act(() => {
        window.dispatchEvent(mockPromptEvent);
      });

      expect(result.current.isInstallable).toBe(true);

      await act(async () => {
        await result.current.promptInstall();
      });

      expect(mockPrompt).toHaveBeenCalled();
      expect(result.current.isInstallable).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 0));
      const types = mockSentryTransport.mock.calls.map((c: any) => c[1].type);
      expect(types).not.toContain('pwa_install_click');
      expect(types).not.toContain('pwa_install_prompt_outcome');
    });

    it('handles a dismissed install choice without proprietary funnel telemetry', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_pwa_test');

      const { result } = renderHook(() => usePWAInstall());

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const mockPromptEvent = new Event('beforeinstallprompt');
      Object.assign(mockPromptEvent, {
        prompt: mockPrompt,
        userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      });

      act(() => {
        window.dispatchEvent(mockPromptEvent);
      });

      await act(async () => {
        await result.current.promptInstall();
      });

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSentryTransport.mock.calls.some((c: any) => c[1].type === 'pwa_install_prompt_outcome')).toBe(false);
    });

    it('prevents duplicate prompt calls on rapid consecutive promptInstall invocations', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_pwa_test');

      const { result } = renderHook(() => usePWAInstall());

      let resolveUserChoice: any;
      const userChoicePromise = new Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>((res) => {
        resolveUserChoice = res;
      });

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const mockPromptEvent = new Event('beforeinstallprompt');
      Object.assign(mockPromptEvent, {
        prompt: mockPrompt,
        userChoice: userChoicePromise,
      });

      act(() => {
        window.dispatchEvent(mockPromptEvent);
      });

      expect(result.current.isInstallable).toBe(true);

      let p1: Promise<void>;
      let p2: Promise<void>;

      await act(async () => {
        p1 = result.current.promptInstall();
        p2 = result.current.promptInstall();
      });

      act(() => {
        resolveUserChoice({ outcome: 'accepted', platform: 'web' });
      });

      await act(async () => {
        await Promise.all([p1, p2]);
      });

      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(result.current.isInstallable).toBe(false);

      const clickCalls = mockSentryTransport.mock.calls.filter((c: any) => c[1].type === 'pwa_install_click');
      expect(clickCalls.length).toBe(0);
    });

    it('handles native appinstalled without proprietary funnel telemetry', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_pwa_test');

      renderHook(() => usePWAInstall());

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSentryTransport.mock.calls.some((c: any) => c[1].type === 'pwa_appinstalled')).toBe(false);
    });

    it('handles prompt error gracefully and clears deferredPrompt', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_pwa_test');

      const { result } = renderHook(() => usePWAInstall());

      const rejectedUserChoice = Promise.reject(new Error('NotAllowedError'));
      // Prevent Node unhandled rejection event
      rejectedUserChoice.catch(() => {});

      const mockPromptEvent = new Event('beforeinstallprompt');
      Object.assign(mockPromptEvent, {
        prompt: vi.fn().mockImplementation(() => {
          throw new Error('NotAllowedError');
        }),
        userChoice: rejectedUserChoice,
      });

      act(() => {
        window.dispatchEvent(mockPromptEvent);
      });

      expect(result.current.isInstallable).toBe(true);

      await act(async () => {
        await expect(result.current.promptInstall()).resolves.not.toThrow();
      });

      expect(result.current.isInstallable).toBe(false);
    });

    it('detects iOS installation instructions availability for non-standalone iOS users', () => {
      const originalUserAgent = navigator.userAgent;
      try {
        Object.defineProperty(navigator, 'userAgent', {
          value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          configurable: true,
        });

        const { result } = renderHook(() => usePWAInstall());
        expect(result.current.isIOSInstallable).toBe(true);
        expect(result.current.isStandalone).toBe(false);
      } finally {
        Object.defineProperty(navigator, 'userAgent', {
          value: originalUserAgent,
          configurable: true,
        });
      }
    });

    it('SettingsView renders install button and triggers promptInstall on click', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_settings_test');

      useAppStore.setState({
        dataOwner: captureSession().owner,
        userData: {
          profile: { name: 'Mario Rossi' },
          routines: [],
          library: [],
          history: [],
        } as unknown as UserData,
      });

      const { unmount } = render(React.createElement(SettingsView));

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const mockPromptEvent = new Event('beforeinstallprompt');
      Object.assign(mockPromptEvent, {
        prompt: mockPrompt,
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });

      act(() => {
        window.dispatchEvent(mockPromptEvent);
      });

      fireEvent.click(screen.getByRole('button', { name: /Aspetto e applicazione/i }));
      const installBtn = await screen.findByRole('button', { name: /Installa app/i });
      expect(installBtn).not.toBeNull();

      await act(async () => {
        fireEvent.click(installBtn);
      });

      expect(mockPrompt).toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSentryTransport.mock.calls.some((c: any) => c[1].type === 'pwa_install_click')).toBe(false);

      unmount();
    });
  });

  // =========================================================================
  // 2. Offline workout lifecycle
  // =========================================================================
  describe('2. Offline workout lifecycle without proprietary usage telemetry', () => {
    const mockUserData: UserData = {
      profile: { name: 'Athlete' },
      routines: [
        {
          id: 'routine_push_1',
          name: 'Push Day A',
          exercises: [
            { exId: 'bench_press', setsCount: 4, minReps: 6, maxReps: 8 },
            { exId: 'incline_db', setsCount: 3, minReps: 8, maxReps: 10 },
          ],
        },
      ],
      library: [
        { id: 'bench_press', name: 'Panca piana', primaryMuscle: 'chest', trackingType: 'weight_reps' },
        { id: 'incline_db', name: 'Manubri inclinata', primaryMuscle: 'chest', trackingType: 'weight_reps' },
      ],
      history: [],
    } as unknown as UserData;

    it('starts an online workout without emitting workout usage telemetry', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_athlete_online');

      useAppStore.setState({
        dataOwner: captureSession().owner,
        userData: mockUserData,
        localWorkout: null,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await result.current.startWorkout('routine_push_1');
      });

      expect(useAppStore.getState().localWorkout).not.toBeNull();
      expect(useAppStore.getState().localWorkout?.routineId).toBe('routine_push_1');

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSentryTransport.mock.calls.some((c: any) => c[1].type === 'workout_started')).toBe(false);
    });

    it('starts an offline workout without buffering workout usage telemetry', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_athlete_offline');

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      useAppStore.setState({
        dataOwner: captureSession().owner,
        userData: mockUserData,
        localWorkout: null,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await result.current.startWorkout('routine_push_1');
      });

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.some(item => item.payload.type === 'workout_started')).toBe(false);
    });

    it('saves an online workout without emitting workout usage telemetry', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_athlete_online');

      // Auto-confirm end workout
      useDialogStore.setState({
        showConfirm: vi.fn().mockResolvedValue(true),
        showAlert: vi.fn().mockResolvedValue(undefined),
      });

      useAppStore.setState({
        dataOwner: captureSession().owner,
        userData: mockUserData,
        localWorkout: {
          id: 'w_test_1',
          routineId: 'routine_push_1',
          routineName: 'Push Day A',
          date: '2026-08-24',
          globalStartTime: Date.now() - 3600000, // 1 hour ago
          exercises: [
            { id: 'se1', exId: 'bench_press', sets: [{ id: 's1', kg: '100', reps: '8' }] },
            { id: 'se2', exId: 'incline_db', sets: [{ id: 's2', kg: '32', reps: '10' }] },
          ],
        } as any,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await result.current.endWorkout();
      });

      expect(useAppStore.getState().localWorkout).toBeNull();

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSentryTransport.mock.calls.some((c: any) => c[1].type === 'workout_saved')).toBe(false);
    });

    it('saves an offline workout without buffering workout usage telemetry', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_athlete_offline');

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      useDialogStore.setState({
        showConfirm: vi.fn().mockResolvedValue(true),
        showAlert: vi.fn().mockResolvedValue(undefined),
      });

      useAppStore.setState({
        dataOwner: captureSession().owner,
        userData: mockUserData,
        localWorkout: {
          id: 'w_offline_1',
          routineId: 'routine_push_1',
          routineName: 'Push Day A',
          date: '2026-08-24',
          globalStartTime: Date.now() - 1800000, // 30 min ago
          exercises: [
            { id: 'se1', exId: 'bench_press', sets: [{ id: 's1', kg: '90', reps: '10' }] },
          ],
        } as any,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await result.current.endWorkout();
      });

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.some(item => item.payload.type === 'workout_saved')).toBe(false);
    });

  });

  // =========================================================================
  // 3. Offline Queueing & Auto-Replay Engine
  // =========================================================================
  describe('3. Offline Queueing & Auto-Replay Engine', () => {
    it('keeps offline events in owner RAM without persisting plaintext', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_offline_queue');

      telemetryHub.trackEvent('event_alpha', { item: 1 });
      telemetryHub.trackEvent('event_beta', { item: 2 });
      telemetryHub.trackEvent('event_gamma', { item: 3 });

      // A locked vault keeps technical reports in memory; it must never
      // recreate the obsolete owner-scoped plaintext localStorage queue.
      expect(localStorage.getItem(telemetryHub.getQueueStorageKey())).toBeNull();
      const queued = telemetryHub.getQueuedEvents();
      expect(queued).toHaveLength(3);
      expect(queued.map(item => item.payload.type)).toEqual([
        'event_alpha', 'event_beta', 'event_gamma',
      ]);
    });

    it('replays queued technical errors on the online event', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_replay_test');

      telemetryHub.trackError(new TypeError('Offline profile diagnostic'));
      telemetryHub.trackError(new RangeError('Offline history diagnostic'));
      expect(telemetryHub.getQueuedEvents().length).toBe(2);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      await waitFor(() => {
        expect(mockSentryTransport).toHaveBeenCalledTimes(2);
        expect(mockSentryTransport.mock.calls.every((call: any) => call[0] === 'error')).toBe(true);
        expect(telemetryHub.getQueuedEvents().length).toBe(0);
      });
    });

    it('replays an encrypted technical error on online bootstrap', async () => {
      telemetryHub.setUserId('user_boot_test');
      // Seed a pre-existing queue for the same authenticated owner.
      await seedCurrentTelemetryQueue('user_boot_test', [
          {
            id: 'item_boot_1',
            timestamp: Date.now() - 10000,
            itemType: 'error',
            payload: {
              id: 'err_boot_1',
              timestamp: Date.now() - 10000,
              type: 'BootstrapDiagnostic',
              message: 'Queued diagnostic before bootstrap',
              source: 'custom',
              count: 1,
              firstSeen: Date.now() - 10000,
              lastSeen: Date.now() - 10000,
              context: { appVersion: '1.0.0', platform: 'other', displayMode: 'browser', online: false },
              userId: 'user_boot_test',
              sessionId: 'sess_1',
            },
          },
        ]);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      telemetryHub.init();

      await waitFor(() => {
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        expect(mockSentryTransport.mock.calls[0][1].type).toBe('BootstrapDiagnostic');
        expect(telemetryHub.getQueuedEvents().length).toBe(0);
      });
    });

    it('retains a queued error after Sentry transport rejection', async () => {
      telemetryHub.setUserId('user_failing');
      await seedCurrentTelemetryQueue('user_failing', [
          {
            id: 'item_failing_1',
            timestamp: Date.now(),
            itemType: 'error',
            payload: {
              id: 'err_failing_1',
              timestamp: Date.now(),
              type: 'ReplayFailure',
              message: 'Technical Sentry transport rejected',
              source: 'custom',
              count: 1,
              firstSeen: Date.now(),
              lastSeen: Date.now(),
              context: { appVersion: '1.0.0', platform: 'other', displayMode: 'browser', online: true },
              userId: 'user_failing',
              sessionId: 'sess_1',
            },
          },
        ]);

      mockSentryTransport.mockRejectedValueOnce(new Error('Network drop during replay'));

      await telemetryHub.flushQueue();

      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe('item_failing_1');
      expect(remaining[0].retryCount).toBe(1);
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
      expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
    });
  });

});
