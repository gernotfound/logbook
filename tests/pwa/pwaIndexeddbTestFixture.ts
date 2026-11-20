import { vi } from 'vitest';
import { idbStore } from '../setup';
import { useAppStore } from '../../src/store/useAppStore';
import type { UserData } from '../../src/types';

export function makeUserData(height: string): UserData {
  return {
    profile: { height }, library: [], routines: [], history: [],
    nutrition: {}, customFoods: [], activeWorkout: null, nutritionPlanning: {},
  };
}

export function setupPwaIndexeddbTest() {
  vi.useRealTimers();
  localStorage.clear();
  for (const key in idbStore) delete idbStore[key];
  useAppStore.getState().resetStore();
  vi.clearAllMocks();
}

export function teardownPwaIndexeddbTest() {
  vi.restoreAllMocks();
  vi.useRealTimers();
}
