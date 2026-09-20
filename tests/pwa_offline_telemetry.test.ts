import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import { renderHook, act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { telemetryHub, TELEMETRY_QUEUE_KEY, TELEMETRY_QUEUE_CAPACITY, type TelemetryEventPayload } from '../src/lib/telemetryHub';
import { usePWAInstall } from '../src/hooks/usePWAInstall';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import SettingsView from '../src/components/SettingsView';
import type { UserData } from '../src/types';

describe('Milestone 2: PWA Analytics & Offline Workout Usage Suite', () => {
  let mockSetDoc: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();

    mockSetDoc = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {
      return { path: pathSegments.join('/') } as any;
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    telemetryHub.reset();
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
  // 1. PWA Install Funnel Analytics
  // =========================================================================
  describe('1. PWA Install Funnel Analytics', () => {
    it('tracks beforeinstallprompt event as pwa_install_impression and sets isInstallable', async () => {
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

      await waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalled();
        const calls = mockSetDoc.mock.calls;
        const lastCall = calls[calls.length - 1][1] as TelemetryEventPayload;
        expect(lastCall.type).toBe('pwa_install_impression');
        expect(lastCall.userId).toBe('user_pwa_test');
      });
    });

    it('tracks promptInstall click and accepted user choice outcome', async () => {
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

      await waitFor(() => {
        const types = mockSetDoc.mock.calls.map((c: any) => c[1].type);
        expect(types).toContain('pwa_install_click');
        expect(types).toContain('pwa_install_prompt_outcome');

        const outcomeCall = mockSetDoc.mock.calls.find((c: any) => c[1].type === 'pwa_install_prompt_outcome');
        expect(outcomeCall[1].details?.outcome).toBe('accepted');
      });
    });

    it('tracks promptInstall click and dismissed user choice outcome', async () => {
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

      await waitFor(() => {
        const outcomeCall = mockSetDoc.mock.calls.find((c: any) => c[1].type === 'pwa_install_prompt_outcome');
        expect(outcomeCall).toBeDefined();
        expect(outcomeCall[1].details?.outcome).toBe('dismissed');
      });
    });

    it('prevents duplicate prompt calls and telemetry emissions on rapid consecutive promptInstall invocations before userChoice settles', async () => {
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

      const clickCalls = mockSetDoc.mock.calls.filter((c: any) => c[1].type === 'pwa_install_click');
      expect(clickCalls.length).toBe(1);
    });

    it('tracks native appinstalled event completing install funnel', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_pwa_test');

      renderHook(() => usePWAInstall());

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      await waitFor(() => {
        const calls = mockSetDoc.mock.calls;
        const installedCall = calls.find((c: any) => c[1].type === 'pwa_appinstalled');
        expect(installedCall).toBeDefined();
      });
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

      const installBtn = await screen.findByRole('button', { name: /Installa app/i });
      expect(installBtn).not.toBeNull();

      await act(async () => {
        fireEvent.click(installBtn);
      });

      expect(mockPrompt).toHaveBeenCalled();

      await waitFor(() => {
        const types = mockSetDoc.mock.calls.map((c: any) => c[1].type);
        expect(types).toContain('pwa_install_click');
      });

      unmount();
    });
  });

  // =========================================================================
  // 2. Offline Workout Lifecycle Analytics
  // =========================================================================
  describe('2. Offline Workout Lifecycle Analytics', () => {
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

    it('tracks workout_started event with offline: false when online', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_athlete_online');

      useAppStore.setState({
        userData: mockUserData,
        localWorkout: null,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await result.current.startWorkout('routine_push_1');
      });

      expect(useAppStore.getState().localWorkout).not.toBeNull();
      expect(useAppStore.getState().localWorkout?.routineId).toBe('routine_push_1');

      await waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalled();
        const workoutStartedCall = mockSetDoc.mock.calls.find((c: any) => c[1].type === 'workout_started');
        expect(workoutStartedCall).toBeDefined();
        expect(workoutStartedCall[1].details?.offline).toBe(false);
        expect(workoutStartedCall[1].details?.routineId).toBe('routine_push_1');
        expect(workoutStartedCall[1].details?.routineName).toBeUndefined();
      });
    });

    it('tracks workout_started event with offline: true and buffers in localStorage when offline', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_athlete_offline');

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      useAppStore.setState({
        userData: mockUserData,
        localWorkout: null,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await result.current.startWorkout('routine_push_1');
      });

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      expect(queue[0].payload.type).toBe('workout_started');
      expect((queue[0].payload as TelemetryEventPayload).details?.offline).toBe(true);
      expect((queue[0].payload as TelemetryEventPayload).details?.routineId).toBe('routine_push_1');
      expect((queue[0].payload as TelemetryEventPayload).details?.routineName).toBeUndefined();
    });

    it('tracks workout_saved event with offline: false, duration, and exerciseCount when online', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_athlete_online');

      // Auto-confirm end workout
      useDialogStore.setState({
        showConfirm: vi.fn().mockResolvedValue(true),
        showAlert: vi.fn().mockResolvedValue(undefined),
      });

      useAppStore.setState({
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

      await waitFor(() => {
        const workoutSavedCall = mockSetDoc.mock.calls.find((c: any) => c[1].type === 'workout_saved');
        expect(workoutSavedCall).toBeDefined();
        expect(workoutSavedCall[1].details?.offline).toBe(false);
        expect(workoutSavedCall[1].details?.exerciseCount).toBe(2);
        expect(workoutSavedCall[1].details?.duration).toBeDefined();
      });
    });

    it('tracks workout_saved event with offline: true and buffers in localStorage when offline', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_athlete_offline');

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      useDialogStore.setState({
        showConfirm: vi.fn().mockResolvedValue(true),
        showAlert: vi.fn().mockResolvedValue(undefined),
      });

      useAppStore.setState({
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
      expect(queue.length).toBe(1);
      expect(queue[0].payload.type).toBe('workout_saved');
      expect((queue[0].payload as TelemetryEventPayload).details?.offline).toBe(true);
      expect((queue[0].payload as TelemetryEventPayload).details?.exerciseCount).toBe(1);
    });

    it('ensures workout saving is never interrupted if telemetry dispatch throws or times out', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_throw_test');

      mockSetDoc.mockRejectedValue(new Error('Firestore network failure'));

      useDialogStore.setState({
        showConfirm: vi.fn().mockResolvedValue(true),
        showAlert: vi.fn().mockResolvedValue(undefined),
      });

      useAppStore.setState({
        userData: mockUserData,
        localWorkout: {
          id: 'w_fail_safe_1',
          routineId: 'routine_push_1',
          date: '2026-08-24',
          globalStartTime: Date.now() - 1200000,
          exercises: [],
        } as any,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await expect(result.current.endWorkout()).resolves.not.toThrow();
      });

      expect(useAppStore.getState().localWorkout).toBeNull();
    });
  });

  // =========================================================================
  // 3. Offline Queueing & Auto-Replay Engine
  // =========================================================================
  describe('3. Offline Queueing & Auto-Replay Engine', () => {
    it('buffers multiple offline events in localStorage in FIFO order', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_offline_queue');

      telemetryHub.trackEvent('event_alpha', { item: 1 });
      telemetryHub.trackEvent('event_beta', { item: 2 });
      telemetryHub.trackEvent('event_gamma', { item: 3 });

      const raw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.length).toBe(3);
      expect(parsed[0].payload.type).toBe('event_alpha');
      expect(parsed[1].payload.type).toBe('event_beta');
      expect(parsed[2].payload.type).toBe('event_gamma');
    });

    it('enforces maximum capacity of 50 items, dropping oldest items (FIFO eviction)', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_cap_test');

      for (let i = 1; i <= 60; i++) {
        telemetryHub.trackEvent(`event_${i}`, { index: i });
      }

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(TELEMETRY_QUEUE_CAPACITY);
      expect(queue[0].payload.type).toBe('event_11');
      expect(queue[queue.length - 1].payload.type).toBe('event_60');
    });

    it('automatically replays queued events and empties buffer when window online event is dispatched', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_replay_test');

      telemetryHub.trackEvent('workout_started', { offline: true, routineId: 'r1' });
      telemetryHub.trackEvent('workout_saved', { offline: true, duration: '00:45:00' });
      expect(telemetryHub.getQueuedEvents().length).toBe(2);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      await waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
        expect(telemetryHub.getQueuedEvents().length).toBe(0);
      });
    });

    it('automatically replays queued items upon telemetryHub.init() if online at bootstrap', async () => {
      // Seed pre-existing queue in localStorage
      localStorage.setItem(
        TELEMETRY_QUEUE_KEY,
        JSON.stringify([
          {
            id: 'item_boot_1',
            timestamp: Date.now() - 10000,
            itemType: 'event',
            payload: {
              timestamp: Date.now() - 10000,
              type: 'pwa_install_impression',
              context: { appVersion: '1.0.0', platform: 'other', displayMode: 'browser', online: false },
              userId: 'user_boot_test',
              sessionId: 'sess_1',
            },
          },
        ])
      );

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      telemetryHub.setUserId('user_boot_test');
      telemetryHub.init();

      await waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect(telemetryHub.getQueuedEvents().length).toBe(0);
      });
    });

    it('does not attach the current userId to guest queued items after login', async () => {
      localStorage.setItem(
        TELEMETRY_QUEUE_KEY,
        JSON.stringify([
          {
            id: 'item_guest_1',
            timestamp: Date.now() - 5000,
            itemType: 'event',
            payload: {
              timestamp: Date.now() - 5000,
              type: 'workout_started',
              context: { appVersion: '1.0.0', platform: 'other', displayMode: 'browser', online: false },
              userId: null,
              sessionId: 'sess_guest',
              details: { offline: true },
            },
          },
        ])
      );

      telemetryHub.setUserId('user_logged_in_123');
      await telemetryHub.flushQueue();

      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(telemetryHub.getQueuedEvents()).toHaveLength(1);
      expect(telemetryHub.getQueuedEvents()[0].payload.userId).toBeNull();
    });

    it('retains failing items in queue if Firestore write fails during flush', async () => {
      localStorage.setItem(
        TELEMETRY_QUEUE_KEY,
        JSON.stringify([
          {
            id: 'item_failing_1',
            timestamp: Date.now(),
            itemType: 'event',
            payload: {
              timestamp: Date.now(),
              type: 'failing_event',
              context: { appVersion: '1.0.0', platform: 'other', displayMode: 'browser', online: true },
              userId: 'user_failing',
              sessionId: 'sess_1',
            },
          },
        ])
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Network drop during replay'));

      telemetryHub.setUserId('user_failing');
      await telemetryHub.flushQueue();

      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe('item_failing_1');
    });
  });

  // =========================================================================
  // 4. Convenience Helpers
  // =========================================================================
  describe('4. TelemetryHub Convenience Helpers', () => {
    it('dispatches PWA helpers correctly', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_helpers');

      telemetryHub.trackPWAImpression({ platform: 'ios' });
      telemetryHub.trackPWAInstallClick({ source: 'settings' });
      telemetryHub.trackPWAOutcome('accepted', { durationSec: 5 });
      telemetryHub.trackPWAInstalled({ promptUsed: true });

      await waitFor(() => {
        const types = mockSetDoc.mock.calls.map((c: any) => c[1].type);
        expect(types).toContain('pwa_install_impression');
        expect(types).toContain('pwa_install_click');
        expect(types).toContain('pwa_install_prompt_outcome');
        expect(types).toContain('pwa_appinstalled');
      });
    });

    it('dispatches Workout helpers with offline auto-detection', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_helpers');

      telemetryHub.trackWorkoutStarted({ routineId: 'r_leg_day', routineName: 'Leg Day' });
      telemetryHub.trackWorkoutSaved({ duration: '01:10:00', exerciseCount: 5 });

      await waitFor(() => {
        const started = mockSetDoc.mock.calls.find((c: any) => c[1].type === 'workout_started');
        expect(started).toBeDefined();
        expect(started[1].details?.offline).toBe(false);
        expect(started[1].details?.routineId).toBe('r_leg_day');
        expect(started[1].details?.routineName).toBeUndefined();

        const saved = mockSetDoc.mock.calls.find((c: any) => c[1].type === 'workout_saved');
        expect(saved).toBeDefined();
        expect(saved[1].details?.offline).toBe(false);
        expect(saved[1].details?.duration).toBe('01:10:00');
        expect(saved[1].details?.exerciseCount).toBe(5);
      });
    });
  });
});
