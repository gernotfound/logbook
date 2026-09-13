import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { useAppStore } from '../src/store/useAppStore';
import { DB } from '../src/lib/db';
import type { UserData } from '../src/types';

import { idbStore } from './setup';

const TestAuthConsumer = () => {
  const { currentUser, loading } = useAuth();
  const userData = useAppStore(s => s.userData);
  return (
    <div>
      <div data-testid="loading-state">{loading ? 'LOADING' : 'READY'}</div>
      <div data-testid="user-state">{currentUser ? currentUser.email : 'ANONYMOUS'}</div>
      <div data-testid="data-state">{userData ? (userData.profile?.name || 'HAS_DATA') : 'NO_DATA'}</div>
    </div>
  );
};

describe('PWA & iPhone Startup Resilience Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k in idbStore) delete idbStore[k];
    if (typeof window !== 'undefined') {
      window.__INITIAL_USER_DATA__ = null;
    }
    useAppStore.getState().resetStore();
    vi.clearAllMocks();
  });

  test('Instant Auth State Transition: loading becomes READY immediately on auth state change', async () => {
    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    // Initial state after onAuthStateChanged fired in setup mock
    expect(screen.getByTestId('loading-state').textContent).toBe('READY');
    expect(screen.getByTestId('user-state').textContent).toBe('test@example.com');
  });

  test('IndexedDB Cache Snapshot: stores cached userData in IndexedDB for instant offline start', async () => {
    const mockCache: UserData = {
      profile: { name: 'Mario Rossi', height: '180' },
      library: [{ id: 'ex1', name: 'Panca Piana', targetMuscle: 'petto', notes: '' }],
      routines: [],
      history: [],
      nutrition: {},
      customFoods: [],
      activeWorkout: null,
      nutritionPlanning: {} as any
    };

    // When store is updated or loaded, it syncs with IndexedDB cache
    useAppStore.getState().setUserData(mockCache);
    await new Promise(r => setTimeout(r, 0));

    const cachedInStorage = idbStore['logbook:v2:user:test-user-id'];
    expect(cachedInStorage).toBeTruthy();
    expect(cachedInStorage.data.profile.name).toBe('Mario Rossi');
  });

  test('Save and Reset Store manages local cached data correctly', async () => {
    const sampleData: UserData = {
      profile: { name: 'Luigi' },
      library: [],
      routines: [],
      history: [],
      nutrition: {},
      customFoods: [],
      activeWorkout: null,
      nutritionPlanning: {} as any
    };

    useAppStore.getState().setUserData(sampleData);
    await new Promise(r => setTimeout(r, 0));
    expect(idbStore['logbook:v2:user:test-user-id']?.data.profile?.name).toBe('Luigi');

    await DB.purgeAllLocalUserData();
    useAppStore.getState().resetStore();
    expect(idbStore['logbook:v2:user:test-user-id']).toBeUndefined();
    expect(useAppStore.getState().userData).toBeNull();
  });

  test('Network slow or hanging DB.loadUserData does not throw unhandled exception or lock syncing', async () => {
    const originalLoad = DB.loadUserData;
    DB.loadUserData = vi.fn().mockRejectedValue(new Error('Network timeout'));

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    // App should still be in READY state without crashing
    expect(screen.getByTestId('loading-state').textContent).toBe('READY');

    DB.loadUserData = originalLoad;
  });
});
