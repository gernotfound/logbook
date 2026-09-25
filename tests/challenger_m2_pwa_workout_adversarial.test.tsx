import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { telemetryHub } from '../src/lib/telemetryHub';
import { usePWAInstall } from '../src/hooks/usePWAInstall';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import SettingsView from '../src/components/SettingsView';
import type { UserData, WorkoutSession } from '../src/types';

describe('Milestone 2 Challenger Suite: PWA and Offline Workout Stress Tests', () => {
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

    useDialogStore.setState({
      showConfirm: vi.fn().mockResolvedValue(true),
      showAlert: vi.fn().mockResolvedValue(undefined),
    });

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
  // 1. PWA Install Adversarial & Edge Cases
  // =========================================================================
  describe('1. PWA Install Funnel Stress & Unusual Events', () => {
    it('handles beforeinstallprompt event where prompt() throws synchronously', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_prompt_sync_err');

      const { result } = renderHook(() => usePWAInstall());

      const mockPromptEvent = new Event('beforeinstallprompt');
      Object.assign(mockPromptEvent, {
        prompt: vi.fn().mockImplementation(() => {
          throw new Error('Immediate DOMException');
        }),
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });

      act(() => {
        window.dispatchEvent(mockPromptEvent);
      });

      expect(result.current.isInstallable).toBe(true);

      await act(async () => {
        await expect(result.current.promptInstall()).resolves.not.toThrow();
      });

      // deferredPrompt should be cleared even after synchronous error
      expect(result.current.isInstallable).toBe(false);
    });

    it('handles fast double-clicks on promptInstall without firing prompt() twice', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_double_click');

      const { result } = renderHook(() => usePWAInstall());

      let resolveUserChoice: any;
      const userChoicePromise = new Promise<{ outcome: 'accepted'; platform: string }>((res) => {
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

      // Fast double click: trigger promptInstall twice concurrently
      let p1: Promise<void>;
      let p2: Promise<void>;

      await act(async () => {
        p1 = result.current.promptInstall();
        p2 = result.current.promptInstall();
      });

      // Now resolve user choice
      act(() => {
        resolveUserChoice({ outcome: 'accepted', platform: 'web' });
      });

      await act(async () => {
        await Promise.all([p1, p2]);
      });

      // prompt() should only have been called once
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(result.current.isInstallable).toBe(false);
    });

    it('handles userChoice resolving to null, undefined, or unexpected shapes gracefully', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_weird_choice');

      const { result } = renderHook(() => usePWAInstall());

      const mockPromptEvent = new Event('beforeinstallprompt');
      Object.assign(mockPromptEvent, {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve(null as any), // Corrupted browser output
      });

      act(() => {
        window.dispatchEvent(mockPromptEvent);
      });

      await act(async () => {
        await result.current.promptInstall();
      });

      expect(result.current.isInstallable).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSetDoc.mock.calls.some((c: any) => c[1].type === 'pwa_install_prompt_outcome')).toBe(false);
    });

    it('handles multiple rapid beforeinstallprompt events and appinstalled sequence', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_rapid_pwa');

      const { result } = renderHook(() => usePWAInstall());

      const event1 = new Event('beforeinstallprompt');
      Object.assign(event1, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) });
      const event2 = new Event('beforeinstallprompt');
      Object.assign(event2, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) });

      act(() => {
        window.dispatchEvent(event1);
        window.dispatchEvent(event2);
      });

      expect(result.current.isInstallable).toBe(true);

      // Now dispatch native appinstalled event
      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      // Should reset isInstallable to false
      expect(result.current.isInstallable).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSetDoc.mock.calls.some((c: any) => c[1].type === 'pwa_appinstalled')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Offline Workout Tracking with Corrupted / 0 Exercises
  // =========================================================================
  describe('2. Offline Workout Lifecycle with 0 Exercises & Corrupted Structures', () => {
    it('handles starting and saving a workout with 0 exercises without throwing or crashing', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_empty_workout');

      const emptyRoutineUserData: UserData = {
        profile: { name: 'Empty Routine User' },
        routines: [
          {
            id: 'routine_empty',
            name: 'Cardio Only / Empty',
            exercises: [], // 0 exercises in routine
          },
        ],
        library: [],
        history: [],
      } as unknown as UserData;

      useAppStore.setState({
        userData: emptyRoutineUserData,
        localWorkout: null,
      });

      const { result } = renderHook(() => useWorkoutSession());

      // Start empty workout
      await act(async () => {
        await result.current.startWorkout('routine_empty');
      });

      const active = useAppStore.getState().localWorkout;
      expect(active).not.toBeNull();
      expect(active?.exercises).toEqual([]);

      // End empty workout
      await act(async () => {
        await result.current.endWorkout();
      });

      expect(useAppStore.getState().localWorkout).toBeNull();
      expect(useAppStore.getState().userData?.activePains).toEqual([]);

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSetDoc.mock.calls.some((c: any) => c[1].type === 'workout_saved')).toBe(false);
    });

    it('handles ending a workout with corrupted/missing exercises array (null/undefined)', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_corrupted_ex');

      const baseUserData: UserData = {
        profile: { name: 'Corrupt Workout User' },
        routines: [],
        library: [],
        history: [],
      } as unknown as UserData;

      useAppStore.setState({
        userData: baseUserData,
        localWorkout: {
          id: 'w_corrupt_1',
          routineId: 'r_unknown',
          routineName: 'Malformed',
          date: '2026-08-24',
          globalStartTime: Date.now() - 600000,
          exercises: null as any, // Corrupted exercises
          pains: null as any, // Corrupted pains
        } as any,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await expect(result.current.endWorkout()).resolves.not.toThrow();
      });

      expect(useAppStore.getState().localWorkout).toBeNull();

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockSetDoc.mock.calls.some((c: any) => c[1].type === 'workout_saved')).toBe(false);
    });

    it('handles workout with invalid ratings and non-numeric water values safely', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_bad_ratings');

      const baseUserData: UserData = {
        profile: { name: 'User' },
        routines: [],
        library: [],
        history: [],
      } as unknown as UserData;

      useAppStore.setState({
        userData: baseUserData,
        localWorkout: {
          id: 'w_bad_ratings',
          routineId: 'r1',
          date: '2026-08-24',
          globalStartTime: Date.now() - 900000,
          moodRating: 'super-happy' as any,
          pumpRating: 'extreme' as any,
          fatigueRating: 'none' as any,
          waterLiters: 'invalid_number' as any,
          exercises: [{ id: 'se1', exId: 'ex1', sets: [] }],
        } as any,
      });

      const { result } = renderHook(() => useWorkoutSession());

      act(() => {
        result.current.setWater('3,5');
        result.current.setMood('bad_input');
      });

      await act(async () => {
        await expect(result.current.endWorkout()).resolves.not.toThrow();
      });

      expect(useAppStore.getState().localWorkout).toBeNull();
    });

    it('does not depend on telemetryHub.trackEvent when saving a workout', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_telemetry_throw');

      // Force telemetryHub.trackEvent to throw a synchronous exception
      const trackEventSpy = vi.spyOn(telemetryHub, 'trackEvent').mockImplementation(() => {
        throw new Error('Telemetry Hub critical crash simulation');
      });

      const baseUserData: UserData = {
        profile: { name: 'Crash Test User' },
        routines: [{ id: 'r1', name: 'Test Routine', exercises: [] }],
        library: [],
        history: [],
      } as unknown as UserData;

      useAppStore.setState({
        userData: baseUserData,
        localWorkout: {
          id: 'w_crash_test',
          routineId: 'r1',
          routineName: 'Test Routine',
          date: '2026-08-24',
          globalStartTime: Date.now() - 300000,
          exercises: [],
        } as any,
      });

      const { result } = renderHook(() => useWorkoutSession());

      // Try ending workout - must not throw and must clean localWorkout
      await act(async () => {
        await expect(result.current.endWorkout()).resolves.not.toThrow();
      });

      expect(useAppStore.getState().localWorkout).toBeNull();
      expect(trackEventSpy).not.toHaveBeenCalled();

      trackEventSpy.mockRestore();
    });

    it('does not depend on telemetryHub.trackEvent when starting a workout', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_telemetry_start_throw');

      const trackEventSpy = vi.spyOn(telemetryHub, 'trackEvent').mockImplementation(() => {
        throw new Error('Telemetry Start Error');
      });

      const baseUserData: UserData = {
        profile: { name: 'Crash Test User' },
        routines: [{ id: 'r1', name: 'Test Routine', exercises: [] }],
        library: [],
        history: [],
      } as unknown as UserData;

      useAppStore.setState({
        userData: baseUserData,
        localWorkout: null,
      });

      const { result } = renderHook(() => useWorkoutSession());

      await act(async () => {
        await expect(result.current.startWorkout('r1')).resolves.not.toThrow();
      });

      expect(useAppStore.getState().localWorkout).not.toBeNull();
      expect(useAppStore.getState().localWorkout?.routineId).toBe('r1');
      expect(trackEventSpy).not.toHaveBeenCalled();

      trackEventSpy.mockRestore();
    });
  });

  // =========================================================================
  // 3. Historical Workout Editing Stress & Resilience
  // =========================================================================
  describe('3. Historical Workout Editing & Pain Persistence Stress', () => {
    it('handles startEditHistoricalWorkout with missing sets/dropsets/isometrics safely', async () => {
      const { result } = renderHook(() => useWorkoutSession());

      const malformedHistorical: WorkoutSession = {
        id: 'hist_123',
        routineId: 'r_legacy',
        date: '2026-08-01',
        globalStartTime: Date.now() - 7200000,
        globalEndTime: Date.now() - 3600000,
        exercises: [
          {
            id: 'ex_legacy_1',
            exId: 'bench',
            sets: [
              { kg: 80, reps: 8 } as any, // Missing id, numeric types
              { kg: null, reps: null, dropsets: null, isometrics: null } as any,
            ],
          } as any,
          {
            id: 'ex_legacy_2',
            exId: 'squat',
            sets: null as any, // Missing sets completely
          } as any,
        ],
      };

      await act(async () => {
        const ok = await result.current.startEditHistoricalWorkout(malformedHistorical);
        expect(ok).toBe(true);
      });

      const active = useAppStore.getState().localWorkout;
      expect(active).not.toBeNull();
      expect(active?.isEditingHistory).toBe(true);
      expect(active?.originalHistoryId).toBe('hist_123');
      expect(active?.exercises[0].sets[0].kg).toBe('80');
      expect(active?.exercises[0].sets[0].id).toBeDefined();
      expect(active?.exercises[1].sets).toEqual([]);
    });

    it('handles saveHistoryEdit when localWorkout has no originalHistoryId or corrupted data', async () => {
      const { result } = renderHook(() => useWorkoutSession());

      useAppStore.setState({
        userData: {
          profile: { name: 'Test' },
          history: [],
          routines: [],
          library: [],
          activePains: ['petto'],
        } as unknown as UserData,
        localWorkout: {
          id: 'w_orphan',
          date: '2026-08-24',
          exercises: [],
        } as any,
      });

      await act(async () => {
        const success = await result.current.saveHistoryEdit();
        expect(success).toBe(true);
      });

      expect(useAppStore.getState().localWorkout).toBeNull();
    });
  });

  // =========================================================================
  // 4. SettingsView UI & Storage Resilience Stress Tests
  // =========================================================================
  describe('4. SettingsView UI & Storage Resilience Stress Tests', () => {
    it('handles rapid clicking on privacy, analytics toggle, and check update', async () => {
      useAppStore.setState({
        userData: {
          profile: { name: 'Settings Tester' },
          routines: [],
          library: [],
          history: [],
        } as unknown as UserData,
      });

      const { unmount } = render(React.createElement(SettingsView));

      // Navigate to Privacy tab to access analytics toggle
      const privacyTab = screen.getByRole('tab', { name: /Privacy/i });
      fireEvent.click(privacyTab);

      const analyticsToggle = screen.getByRole('checkbox');
      expect(analyticsToggle).toBeDefined();

      // Rapid clicking on toggle
      act(() => {
        fireEvent.click(analyticsToggle);
        fireEvent.click(analyticsToggle);
        fireEvent.click(analyticsToggle);
      });

      // Switch back to Account tab to access Cerca aggiornamenti
      const accountTab = screen.getByRole('tab', { name: /Account/i });
      fireEvent.click(accountTab);

      const updateBtn = screen.getByRole('button', { name: /Cerca aggiornamenti/i });
      await act(async () => {
        fireEvent.click(updateBtn);
        fireEvent.click(updateBtn);
      });

      expect(useDialogStore.getState().showAlert).toHaveBeenCalled();

      unmount();
    });

    it('handles localStorage throwing QuotaExceededError during offline telemetry queueing without crashing', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

      expect(() => {
        telemetryHub.trackEvent('offline_overflow_event', { key: 'val' });
      }).not.toThrow();

      setItemSpy.mockRestore();
    });

    it('handles missing window.matchMedia and navigator properties in SSR/worker context without crashing', () => {
      const originalMatchMedia = window.matchMedia;
      try {
        delete (window as any).matchMedia;
        const { result } = renderHook(() => usePWAInstall());
        expect(result.current.isStandalone).toBe(false);
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });
  });
});
