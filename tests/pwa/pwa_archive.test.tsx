import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { readLocal } from '../../src/lib/sync/localRepository';
import { createDataSlice, parseInitialUserData } from '../../src/store/slices/createDataSlice';
import { createWorkoutSlice } from '../../src/store/slices/createWorkoutSlice';
import { createSyncSlice } from '../../src/store/slices/createSyncSlice';
import { createStore } from 'zustand/vanilla';
import type { AppState } from '../../src/store/useAppStore';
import { useAppStore } from '../../src/store/useAppStore';
import { idbStore } from '../setup';
import { DB } from '../../src/lib/db';
import type { UserData, WorkoutSession } from '../../src/types';
import { setupPwaIndexeddbTest, teardownPwaIndexeddbTest, makeUserData } from './pwaIndexeddbTestFixture';

describe('PWA encrypted storage', () => {
  beforeEach(setupPwaIndexeddbTest);
  afterEach(teardownPwaIndexeddbTest);

    test('fresh stores never implicitly hydrate an unverified owner', () => {
      const raw: UserData = makeUserData('178');
      const freshStore = createStore<AppState>()((...args) => ({
        ...createDataSlice(...args), ...createWorkoutSlice(...args), ...createSyncSlice(...args),
      }));
      expect(freshStore.getState().userData).toBeNull();
      const parsed = parseInitialUserData(raw);
      expect(parsed?.profile?.height).toBe('178');
      expect(parsed).not.toBe(raw);
      expect(freshStore.getState().userData).toBeNull();
    });

    test('setUserData persists authenticated ciphertext through the production vault gateway', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
      const mockData: UserData = makeUserData('185');

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
      const mockData: UserData = makeUserData('170');

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

      const mockData: UserData = makeUserData('171');

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

    test('localWorkout is sealed in owner-scoped localStorage, not IDB or plaintext keys', async () => {
      localStorage.setItem('logbook:v2:user:test-user-id:health-consent-generation', '1');
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
      expect(JSON.parse(readDeviceValueStrict('workout')!)).toMatchObject({
        __logbookWorkoutSnapshot: 1, owner: 'user:test-user-id', consentRevision: 1,
        workout: { id: 'session-123' },
      });

      await DB.purgeAllLocalUserData();
      useAppStore.getState().resetStore();
      expect(localStorage.getItem(protectedDeviceKey('workout'))).toBeNull();
    });

    test('parseInitialUserData rejects invalid inputs and sanitizes partial objects', () => {
      expect(parseInitialUserData('{ invalid_json: ')).toBeNull();
      expect(parseInitialUserData(12345)).toBeNull();
      expect(parseInitialUserData(null)).toBeNull();
      const sanitized = parseInitialUserData({ profile: { height: '173' } });
      expect(sanitized?.profile?.height).toBe('173');
      expect(Array.isArray(sanitized?.routines)).toBe(true);
    });
});
