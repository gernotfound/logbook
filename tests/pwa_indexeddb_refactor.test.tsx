import { deviceKey } from '../src/lib/sync/deviceStorage';
import React from 'react';
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useAppStore, getInitialUserData } from '../src/store/useAppStore';
import { idbStore } from './setup';
import { DB } from '../src/lib/db';

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
        profile: { height: '178' },
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
      expect(useAppStore.getState().userData?.profile?.height).toBe('178');
    });

    test('saveUserData and setUserData write to IndexedDB via idb-keyval instead of localStorage', async () => {
      const mockData: UserData = {
        profile: { height: '185' },
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
      await new Promise(r => setTimeout(r, 0));

      // IndexedDB store mock should receive the item
      expect(idbStore['logbook:v2:user:test-user-id']).toBeDefined();
      expect(idbStore['logbook:v2:user:test-user-id'].data.profile.height).toBe('185');

      // LocalStorage should NOT contain logbook_cached_user_data
      expect(localStorage.getItem('logbook_cached_user_data')).toBeNull();
    });

    test('setUserData(null) clears the view and preserves the durable archive', async () => {
      const mockData: UserData = {
        profile: { height: '170' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      useAppStore.getState().setUserData(mockData);
      await new Promise(r => setTimeout(r, 0));
      expect(idbStore['logbook:v2:user:test-user-id']).toBeDefined();

      useAppStore.getState().setUserData(null);
      await new Promise(r => setTimeout(r, 0));
      expect(idbStore['logbook:v2:user:test-user-id']).toBeDefined();
      expect(useAppStore.getState().userData).toBeNull();
    });

    test('saveUserData(null) cancels the timer, rejects callers and preserves the staged edit', async () => {
      vi.useFakeTimers();

      const mockData: UserData = {
        profile: { height: '171' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      const p1 = useAppStore.getState().saveUserData(mockData);
      await vi.advanceTimersByTimeAsync(0);
      const canceled = expect(p1).rejects.toThrow('cambio sessione');
      expect(useAppStore.getState().syncing).toBe(true);

      // Now saveUserData(null) before timer fires
      const p2 = useAppStore.getState().saveUserData(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(useAppStore.getState().syncing).toBe(false);
      expect(useAppStore.getState().userData).toBeNull();
      expect(idbStore['logbook:v2:user:test-user-id'].pending).toHaveLength(1);

      await Promise.all([canceled, p2]);
      await vi.advanceTimersByTimeAsync(1500);
      expect(useAppStore.getState().syncing).toBe(false);

      vi.useRealTimers();
    });

    test('explicit purge removes the owner archive and clears the view', async () => {
      const mockData: UserData = {
        profile: { height: '172' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      useAppStore.getState().setUserData(mockData);
      await new Promise(r => setTimeout(r, 0));
      expect(idbStore['logbook:v2:user:test-user-id']).toBeDefined();

      await DB.purgeAllLocalUserData();
      useAppStore.getState().resetStore();
      expect(idbStore['logbook:v2:user:test-user-id']).toBeUndefined();
      expect(useAppStore.getState().userData).toBeNull();
    });

    test('localWorkout strictly remains in localStorage, never in IndexedDB', async () => {
      const mockWorkout: WorkoutSession = {
        id: 'session-123',
        date: '2026-08-14',
        routineName: 'Chest Day',
        manualDurationStr: '00:30:00',
        exercises: []
      };

      // Set local workout
      useAppStore.getState().setLocalWorkout(mockWorkout);

      // Verify it is NOT saved in IndexedDB
      expect(idbStore[deviceKey('workout')]).toBeUndefined();
      expect(idbStore['localWorkout']).toBeUndefined();

      // Verify purgeAllLocalUserData clears local workout from localStorage
      localStorage.setItem(deviceKey('workout'), JSON.stringify(mockWorkout));
      expect(localStorage.getItem(deviceKey('workout'))).toBeTruthy();

      await DB.purgeAllLocalUserData();
      useAppStore.getState().resetStore();
      expect(localStorage.getItem(deviceKey('workout'))).toBeNull();
    });

    test('getInitialUserData safely handles corrupt JSON string or non-object structures without crashing', () => {
      // 1. Corrupt JSON string
      (window as any).__INITIAL_USER_DATA__ = '{ invalid_json: ';
      expect(getInitialUserData()).toBeNull();

      // 2. Non-object primitive
      (window as any).__INITIAL_USER_DATA__ = 12345;
      expect(getInitialUserData()).toBeNull();

      // 3. Partial object gets sanitized via UserDataSchema defaults
      (window as any).__INITIAL_USER_DATA__ = { profile: { height: '173' } };
      const sanitized = getInitialUserData();
      expect(sanitized).not.toBeNull();
      expect(sanitized?.profile?.height).toBe('173');
      expect(Array.isArray(sanitized?.routines)).toBe(true);

      // 3. Valid parsed object
      const validData: UserData = {
        profile: { height: '174' },
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
      expect(useAppStore.getState().userData?.profile?.height).toBe('174');
    });

    test('saveUserData sets syncing to true during debounce and false upon completion', async () => {
      vi.useFakeTimers();

      const mockData: UserData = {
        profile: { height: '175' },
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

      const pendingResolvers: Array<(val: any) => void> = [];

      const originalSave = DB.saveUserData;
      let callCount = 0;
      (DB as any).saveUserData = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise<any>((resolve) => {
            pendingResolvers.push(resolve);
          });
        } else {
          return new Promise<any>((resolve) => {
            pendingResolvers.push(resolve);
          });
        }
      });

      const mockData1: UserData = {
        profile: { height: '176' },
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
        profile: { height: '177' }
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
      pendingResolvers[0]?.({ ok: true, status: 'synced' });
      await vi.advanceTimersByTimeAsync(100);

      // CRITICAL: syncing MUST remain TRUE because second save is still debouncing
      expect(useAppStore.getState().syncing).toBe(true);

      // 5. Advance timer for second debounce (1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(callCount).toBe(2);
      expect(useAppStore.getState().syncing).toBe(true);

      // 6. Second network write finishes
      pendingResolvers[1]?.({ ok: true, status: 'synced' });
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
        profile: { height: '178' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
      };

      // Trigger save. Catch the promise rejection since resetStore cancels it.
      useAppStore.getState().saveUserData(mockData).catch(() => {});
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
        manualDurationStr: '00:45:00',
        exercises: []
      };

      useAppStore.setState({ localWorkout: mockWorkout, dataOwner: 'user:test-user-id' });

      // Simulate visibility change to hidden
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      const saved = localStorage.getItem(deviceKey('workout'));
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

});
