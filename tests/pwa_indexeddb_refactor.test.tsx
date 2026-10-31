import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { createDataSlice } from '../src/store/slices/createDataSlice';
import { createWorkoutSlice } from '../src/store/slices/createWorkoutSlice';
import { createSyncSlice } from '../src/store/slices/createSyncSlice';
import { createStore } from 'zustand/vanilla';
import type { AppState } from '../src/store/useAppStore';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
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
    vi.useRealTimers();
    localStorage.clear();
    for (const k in idbStore) delete idbStore[k];
    if (typeof window !== 'undefined') {
      window.__INITIAL_USER_DATA__ = null;
    }
    useAppStore.getState().resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (typeof window !== 'undefined') {
      window.__INITIAL_USER_DATA__ = null;
    }
  });

  describe('R1 & R2: IndexedDB UserData Cache & Zustand Integration', () => {
    test('a fresh production store initializer parses window.__INITIAL_USER_DATA__ without a manual setState', () => {
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

      const freshStore = createStore<AppState>()((...args) => ({
        ...createDataSlice(...args),
        ...createWorkoutSlice(...args),
        ...createSyncSlice(...args),
      }));
      expect(freshStore.getState().userData?.profile?.height).toBe('178');
      expect(freshStore.getState().userData).not.toBe(mockInitialData);
      window.__INITIAL_USER_DATA__ = '{bad json' as unknown as UserData;
      const invalidStore = createStore<AppState>()((...args) => ({
        ...createDataSlice(...args),
        ...createWorkoutSlice(...args),
        ...createSyncSlice(...args),
      }));
      expect(invalidStore.getState().userData).toBeNull();
    });

    test('setUserData persists authenticated ciphertext through the production vault gateway', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
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

      const raw = idbStore['logbook:v2:user:test-user-id'];
      expect(raw).toMatch(/^tlb-sealed:v1:/);
      expect(raw).not.toContain('"height":"185"');
      expect((await readLocal('user:test-user-id'))?.data.profile?.height).toBe('185');
      expect(localStorage.getItem('logbook_cached_user_data')).toBeNull();
    });

    test('setUserData(null) clears the view and preserves the durable archive', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
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
      const ciphertext = idbStore['logbook:v2:user:test-user-id'];
      expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
      expect((await readLocal('user:test-user-id'))?.data.profile?.height).toBe('170');

      useAppStore.getState().setUserData(null);
      await new Promise(r => setTimeout(r, 0));
      // Clearing the view is never an instruction to delete or reseal its archive.
      expect(idbStore['logbook:v2:user:test-user-id']).toBe(ciphertext);
      expect(useAppStore.getState().userData).toBeNull();
    });

    test('saveUserData(null) cancels the timer, rejects callers and preserves the staged edit', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
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
      expect(idbStore['logbook:v2:user:test-user-id']).toMatch(/^tlb-sealed:v1:/);
      expect((await readLocal('user:test-user-id'))?.pending).toHaveLength(1);

      await Promise.all([canceled, p2]);
      await vi.advanceTimersByTimeAsync(1500);
      expect(useAppStore.getState().syncing).toBe(false);

      vi.useRealTimers();
    });

    test('explicit purge removes the owner archive and clears the view', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
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

      // The ordinary purge must see a real, clean journal; a pending edit
      // would correctly block logout/purge under the current lifecycle.
      await initializeLocal('user:test-user-id', mockData);
      useAppStore.getState().setUserData(mockData);
      await new Promise(r => setTimeout(r, 0));
      expect(idbStore['logbook:v2:user:test-user-id']).toMatch(/^tlb-sealed:v1:/);
      expect((await readLocal('user:test-user-id'))?.pending).toHaveLength(0);

      await DB.purgeAllLocalUserData();
      useAppStore.getState().resetStore();
      expect(idbStore['logbook:v2:user:test-user-id']).toBeUndefined();
      expect(useAppStore.getState().userData).toBeNull();
    });

    test('localWorkout is sealed in owner-scoped localStorage, not IDB or plaintext keys', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
      const mockWorkout: WorkoutSession = {
        id: 'session-123',
        date: '2026-08-14',
        routineName: 'Chest Day',
        manualDurationStr: '00:30:00',
        exercises: []
      };

      // Set local workout
      useAppStore.getState().setLocalWorkout(mockWorkout);

      expect(idbStore[deviceKey('workout')]).toBeUndefined();
      expect(idbStore['localWorkout']).toBeUndefined();
      const sealed = localStorage.getItem(protectedDeviceKey('workout'));
      expect(sealed).toMatch(/^tlb-sealed:v1:/);
      expect(sealed).not.toContain('session-123');
      expect(localStorage.getItem(deviceKey('workout'))).toBeNull();
      expect(JSON.parse(readDeviceValueStrict('workout')!)).toMatchObject({ id: 'session-123' });

      await DB.purgeAllLocalUserData();
      useAppStore.getState().resetStore();
      expect(localStorage.getItem(protectedDeviceKey('workout'))).toBeNull();
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
      await prepareUnlockedTestArchive('user:test-user-id');
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
      await prepareUnlockedTestArchive('user:test-user-id');
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

    test('visibilitychange hidden flushes localWorkout as authenticated device ciphertext', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
      const mockWorkout: WorkoutSession = {
        id: 'session-vis-test',
        date: '2026-08-14',
        routineName: 'Leg Day',
        manualDurationStr: '00:45:00',
        exercises: []
      };

      useAppStore.setState({ localWorkout: null, dataOwner: 'user:test-user-id' });
      // A synchronous input flush publishes new RAM data that is not yet
      // present on disk; the background boundary must durably save it.
      const flush = () => useAppStore.setState({ localWorkout: mockWorkout });
      draftRegistry.register(flush);
      try {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        const sealed = localStorage.getItem(protectedDeviceKey('workout'));
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(sealed).not.toContain('session-vis-test');
        expect(localStorage.getItem(deviceKey('workout'))).toBeNull();
        expect(JSON.parse(readDeviceValueStrict('workout')!).id).toBe('session-vis-test');
      } finally { draftRegistry.unregister(flush); }
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
