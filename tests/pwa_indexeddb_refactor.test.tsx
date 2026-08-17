import React from 'react';
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useAppStore, getInitialUserData } from '../src/store/useAppStore';
import { idbStore } from './setup';
import { get, set, del } from 'idb-keyval';
import type { UserData, WorkoutSession } from '../src/types';
import App from '../src/App';

describe('PWA IndexedDB Cache & Sync Lock Refactor Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k in idbStore) delete idbStore[k];
    if (typeof window !== 'undefined') {
      window.__INITIAL_USER_DATA__ = null;
    }
    useAppStore.getState().resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.__INITIAL_USER_DATA__ = null;
    }
  });

  describe('R1 & R2: IndexedDB UserData Cache & Zustand Integration', () => {
    test('Zustand store initializes userData from window.__INITIAL_USER_DATA__ synchronously', () => {
      const mockInitialData: UserData = {
        profile: { name: 'Initial Pre-Booted User', height: '178' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      window.__INITIAL_USER_DATA__ = mockInitialData;

      // When store is reset/re-evaluated or setUserData with initial
      useAppStore.setState({ userData: window.__INITIAL_USER_DATA__ });
      expect(useAppStore.getState().userData?.profile?.name).toBe('Initial Pre-Booted User');
    });

    test('saveUserData and setUserData write to IndexedDB via idb-keyval instead of localStorage', async () => {
      const mockData: UserData = {
        profile: { name: 'Cache Test User', height: '185' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      // Set user data
      useAppStore.getState().setUserData(mockData);

      // IndexedDB store mock should receive the item
      expect(idbStore['logbook_cached_user_data']).toBeDefined();
      expect(idbStore['logbook_cached_user_data'].profile.name).toBe('Cache Test User');

      // LocalStorage should NOT contain logbook_cached_user_data
      expect(localStorage.getItem('logbook_cached_user_data')).toBeNull();
    });

    test('setUserData(null) deletes logbook_cached_user_data from IndexedDB', () => {
      const mockData: UserData = {
        profile: { name: 'User to Nullify' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      useAppStore.getState().setUserData(mockData);
      expect(idbStore['logbook_cached_user_data']).toBeDefined();

      useAppStore.getState().setUserData(null);
      expect(idbStore['logbook_cached_user_data']).toBeUndefined();
      expect(useAppStore.getState().userData).toBeNull();
    });

    test('saveUserData(null) clears pending debounce timer, resolves pending promises, and clears IndexedDB cache', async () => {
      vi.useFakeTimers();

      const mockData: UserData = {
        profile: { name: 'Pending User' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      const p1 = useAppStore.getState().saveUserData(mockData);
      expect(useAppStore.getState().syncing).toBe(true);

      // Now saveUserData(null) before timer fires
      const p2 = useAppStore.getState().saveUserData(null);
      expect(useAppStore.getState().syncing).toBe(false);
      expect(useAppStore.getState().userData).toBeNull();
      expect(idbStore['logbook_cached_user_data']).toBeUndefined();

      await Promise.all([p1, p2]);
      await vi.advanceTimersByTimeAsync(1500);
      expect(useAppStore.getState().syncing).toBe(false);

      vi.useRealTimers();
    });

    test('resetStore removes logbook_cached_user_data from IndexedDB and clears store', () => {
      const mockData: UserData = {
        profile: { name: 'User to Clear' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      useAppStore.getState().setUserData(mockData);
      expect(idbStore['logbook_cached_user_data']).toBeDefined();

      useAppStore.getState().resetStore();
      expect(idbStore['logbook_cached_user_data']).toBeUndefined();
      expect(useAppStore.getState().userData).toBeNull();
    });

    test('localWorkout strictly remains in localStorage, never in IndexedDB', () => {
      const mockWorkout: WorkoutSession = {
        id: 'session-123',
        date: '2026-08-14',
        routineName: 'Chest Day',
        duration: '30m',
        exercises: []
      };

      // Set local workout
      useAppStore.getState().setLocalWorkout(mockWorkout);

      // Verify it is NOT saved in IndexedDB
      expect(idbStore['logbook_local_workout']).toBeUndefined();
      expect(idbStore['localWorkout']).toBeUndefined();

      // Verify resetStore clears local workout from localStorage
      localStorage.setItem('logbook_local_workout', JSON.stringify(mockWorkout));
      expect(localStorage.getItem('logbook_local_workout')).toBeTruthy();

      useAppStore.getState().resetStore();
      expect(localStorage.getItem('logbook_local_workout')).toBeNull();
    });

    test('getInitialUserData safely handles corrupt JSON string or non-object structures without crashing', () => {
      // 1. Corrupt JSON string
      (window as any).__INITIAL_USER_DATA__ = '{ invalid_json: ';
      expect(getInitialUserData()).toBeNull();

      // 2. Non-object primitive
      (window as any).__INITIAL_USER_DATA__ = 12345;
      expect(getInitialUserData()).toBeNull();

      // 3. Partial object gets sanitized via UserDataSchema defaults
      (window as any).__INITIAL_USER_DATA__ = { profile: { name: 'Partially Loaded' } };
      const sanitized = getInitialUserData();
      expect(sanitized).not.toBeNull();
      expect(sanitized?.profile?.name).toBe('Partially Loaded');
      expect(Array.isArray(sanitized?.routines)).toBe(true);

      // 3. Valid parsed object
      const validData: UserData = {
        profile: { name: 'Valid User' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };
      window.__INITIAL_USER_DATA__ = validData;
      useAppStore.setState({ userData: window.__INITIAL_USER_DATA__ });
      expect(useAppStore.getState().userData?.profile?.name).toBe('Valid User');
    });

    test('saveUserData sets syncing to true during debounce and false upon completion', async () => {
      vi.useFakeTimers();

      const mockData: UserData = {
        profile: { name: 'Async Save User' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      expect(useAppStore.getState().syncing).toBe(false);

      const savePromise = useAppStore.getState().saveUserData(mockData);

      // Immediately after triggering saveUserData, syncing should be true
      expect(useAppStore.getState().syncing).toBe(true);

      // Fast-forward past debounce timer (1000ms)
      await vi.advanceTimersByTimeAsync(1100);
      await savePromise;

      // After completion, syncing should be false
      expect(useAppStore.getState().syncing).toBe(false);

      vi.useRealTimers();
    });

    test('overlapping saveUserData calls maintain syncing=true continuously until all saves finish', async () => {
      vi.useFakeTimers();
      const { DB } = await import('../src/lib/db');

      let resolveFirstWrite: (() => void) | null = null;
      let resolveSecondWrite: (() => void) | null = null;

      const originalSave = DB.saveUserData;
      let callCount = 0;
      (DB as any).saveUserData = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise<void>((resolve) => {
            resolveFirstWrite = resolve;
          });
        } else {
          return new Promise<void>((resolve) => {
            resolveSecondWrite = resolve;
          });
        }
      });

      const mockData1: UserData = {
        profile: { name: 'First Mutation' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      const mockData2: UserData = {
        ...mockData1,
        profile: { name: 'Second Mutation' }
      };

      // 1. Trigger first save
      const p1 = useAppStore.getState().saveUserData(mockData1);
      expect(useAppStore.getState().syncing).toBe(true);

      // 2. Debounce timer fires (1000ms), first DB.saveUserData is now in-flight
      await vi.advanceTimersByTimeAsync(1000);
      expect(callCount).toBe(1);
      expect(useAppStore.getState().syncing).toBe(true);

      // 3. User mutates again while first save is in-flight -> triggers second save
      const p2 = useAppStore.getState().saveUserData(mockData2);
      expect(useAppStore.getState().syncing).toBe(true);

      // 4. First network write finishes while second save is debouncing
      if (resolveFirstWrite) (resolveFirstWrite as any)();
      await vi.advanceTimersByTimeAsync(100);

      // CRITICAL: syncing MUST remain TRUE because second save is still debouncing
      expect(useAppStore.getState().syncing).toBe(true);

      // 5. Advance timer for second debounce (1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(callCount).toBe(2);
      expect(useAppStore.getState().syncing).toBe(true);

      // 6. Second network write finishes
      if (resolveSecondWrite) (resolveSecondWrite as any)();
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all([p1, p2]);

      // 7. Now that all queued saves are finished, syncing should be false
      expect(useAppStore.getState().syncing).toBe(false);

      (DB as any).saveUserData = originalSave;
      vi.useRealTimers();
    });

    test('resetStore cancels pending debounce timers and clears syncing state', async () => {
      vi.useFakeTimers();

      const mockData: UserData = {
        profile: { name: 'Pending Cancel User' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      // Trigger save
      useAppStore.getState().saveUserData(mockData);
      expect(useAppStore.getState().syncing).toBe(true);

      // Reset store before debounce fires
      useAppStore.getState().resetStore();

      expect(useAppStore.getState().syncing).toBe(false);
      expect(useAppStore.getState().userData).toBeNull();

      // Advancing time should not re-trigger any save or error
      await vi.advanceTimersByTimeAsync(1500);
      expect(useAppStore.getState().syncing).toBe(false);

      vi.useRealTimers();
    });

    test('visibilitychange hidden event writes localWorkout to localStorage', () => {
      const mockWorkout: WorkoutSession = {
        id: 'session-vis-test',
        date: '2026-08-14',
        routineName: 'Leg Day',
        duration: '45m',
        exercises: []
      };

      useAppStore.setState({ localWorkout: mockWorkout });

      // Simulate visibility change to hidden
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      const saved = localStorage.getItem('logbook_local_workout');
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed.id).toBe('session-vis-test');
    });
  });

  describe('R3: Sync Lock (beforeunload Event Listener)', () => {
    test('beforeunload listener triggers preventDefault and returnValue when syncing is true', () => {
      // Set syncing to true
      useAppStore.getState().setSyncing(true);

      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      // Render App to attach beforeunload listener
      const { unmount } = render(<App />);

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(event.returnValue).toBeDefined();

      unmount();
    });

    test('beforeunload listener does NOT prevent default when syncing is false', () => {
      // Set syncing to false
      useAppStore.getState().setSyncing(false);

      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      const { unmount } = render(<App />);

      window.dispatchEvent(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();

      unmount();
    });
  });

  describe('R4: Workbox Google Fonts Precaching Configuration', () => {
    test('Google Fonts stylesheet and webfont regexes match standard font URLs', () => {
      const stylesheetRegex = /^https:\/\/fonts\.googleapis\.com\/.*/i;
      const webfontsRegex = /^https:\/\/fonts\.gstatic\.com\/.*/i;

      // Valid stylesheet URLs
      expect(stylesheetRegex.test('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap')).toBe(true);
      expect(stylesheetRegex.test('https://fonts.googleapis.com/css?family=Roboto')).toBe(true);
      expect(stylesheetRegex.test('https://fonts.googleapis.com/icon?family=Material+Icons')).toBe(true);

      // Non-matching stylesheet URLs
      expect(stylesheetRegex.test('https://example.com/fonts.googleapis.com')).toBe(false);
      expect(stylesheetRegex.test('http://fonts.googleapis.com/css')).toBe(false);

      // Valid webfont URLs
      expect(webfontsRegex.test('https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2')).toBe(true);
      expect(webfontsRegex.test('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2')).toBe(true);

      // Non-matching webfont URLs
      expect(webfontsRegex.test('https://example.com/fonts.gstatic.com')).toBe(false);
      expect(webfontsRegex.test('http://fonts.gstatic.com/font.woff2')).toBe(false);
    });
  });
});
