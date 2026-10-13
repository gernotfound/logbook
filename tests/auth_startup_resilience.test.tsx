import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { useAppStore } from '../src/store/useAppStore';
import { DB } from '../src/lib/db';
import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { refreshHealthConsent } from '../src/lib/healthConsent';
import * as localRepository from '../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../src/lib/sync/secureArchiveSession';
import type { UserData } from '../src/types';

import { idbStore, localStorageMock } from './setup';

const TestAuthConsumer = () => {
  const { currentUser, loading } = useAuth();
  const userData = useAppStore(s => s.userData);
  return (
    <div>
      <div data-testid="loading-state">{loading ? 'LOADING' : 'READY'}</div>
      <div data-testid="user-state">{currentUser ? currentUser.email : 'ANONYMOUS'}</div>
      <div data-testid="data-state">{userData ? (userData.profile?.height || 'HAS_DATA') : 'NO_DATA'}</div>
    </div>
  );
};

describe('PWA & iPhone Startup Resilience Tests', () => {
  beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    for (const k in idbStore) delete idbStore[k];
    if (typeof window !== 'undefined') {
      window.__INITIAL_USER_DATA__ = null;
    }
    useAppStore.getState().resetStore();
    (auth as any).currentUser = {
      uid: 'test-user-id',
      email: 'test@example.com',
      emailVerified: true,
      providerData: [{ providerId: 'password' }],
      getIdToken: vi.fn().mockResolvedValue('test-token'),
    };
    vi.clearAllMocks();
    await createAndMigrateVault('user:test-user-id');
  });

  test('auth becomes READY only after the authenticated owner has been hydrated', async () => {
    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading-state').textContent).toBe('READY'));
    expect(screen.getByTestId('user-state').textContent).toBe('test@example.com');
  });

  test('does not hydrate or register fitness replicas when the trusted consent state is withdrawn', async () => {
    vi.mocked(refreshHealthConsent).mockResolvedValueOnce('withdrawn');
    useAppStore.setState({ userData: null, dataOwner: null });
    render(<AuthProvider><TestAuthConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading-state').textContent).toBe('READY'));
    expect(screen.getByTestId('user-state').textContent).toBe('test@example.com');
    expect(screen.getByTestId('data-state').textContent).toBe('NO_DATA');
    expect(DB.loadCloudPayload).not.toHaveBeenCalled();
    expect(DB.loadUserData).not.toHaveBeenCalled();
  });

  test('rechecks consent when the browser window regains focus', async () => {
    render(<AuthProvider><TestAuthConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading-state').textContent).toBe('READY'));
    const previousChecks = vi.mocked(refreshHealthConsent).mock.calls.length;

    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(vi.mocked(refreshHealthConsent).mock.calls.length).toBe(previousChecks + 1));
  });

  test('rechecks the trusted consent before loading cloud data after reconnect', async () => {
    render(<AuthProvider><TestAuthConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading-state').textContent).toBe('READY'));
    const previousChecks = vi.mocked(refreshHealthConsent).mock.calls.length;
    const previousCloudReads = vi.mocked(DB.loadCloudPayload).mock.calls.length;
    vi.mocked(refreshHealthConsent).mockResolvedValueOnce('withdrawn');

    await act(async () => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(vi.mocked(refreshHealthConsent).mock.calls.length).toBe(previousChecks + 1));
    expect(vi.mocked(DB.loadCloudPayload).mock.calls.length).toBe(previousCloudReads);
  });

  test('fences the previous owner while a different authenticated owner is still hydrating', async () => {
    const previousData = {
      profile: { name: 'Account A' },
      library: [],
      routines: [],
      history: [],
      nutrition: {},
      customFoods: [],
      activeWorkout: null,
      nutritionPlanning: {} as any,
    } as UserData;
    useAppStore.setState({ userData: previousData, dataOwner: 'user:account-a' });

    const userB = {
      uid: 'account-b',
      email: 'b@example.com',
      emailVerified: true,
      providerData: [{ providerId: 'password' }],
    } as any;
    let authCallback!: (user: any) => Promise<void>;
    vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth, callback: any) => {
      authCallback = callback;
      return () => {};
    });
    (auth as any).currentUser = null;
    // Owner B needs its own independent unlocked vault before its async hydration.
    await createAndMigrateVault('user:account-b');

    const originalRead = localRepository.readLocal;
    let releaseRead!: () => void;
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    vi.spyOn(localRepository, 'readLocal').mockImplementation(async owner => {
      if (owner === 'user:account-b') {
        await readGate;
        return undefined;
      }
      return originalRead(owner);
    });

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    let authRun!: Promise<void>;
    act(() => {
      (auth as any).currentUser = userB;
      authRun = authCallback(userB);
    });

    // Device-key hydration is asynchronous even with a cached Firebase UID.
    // B is exposed only after its own vault is ready, while A data stays fenced
    // and B's intentionally delayed business hydration remains in progress.
    await waitFor(() => expect(screen.getByTestId('user-state').textContent).toBe('b@example.com'));
    expect(screen.getByTestId('loading-state').textContent).toBe('LOADING');
    expect(screen.getByTestId('data-state').textContent).toBe('NO_DATA');
    expect(useAppStore.getState().dataOwner).toBeNull();

    releaseRead();
    await act(async () => { await authRun; });
    await waitFor(() => expect(screen.getByTestId('loading-state').textContent).toBe('READY'));
    expect(useAppStore.getState().dataOwner).not.toBe('user:account-a');
  });

  test('fails closed if guest ownership storage becomes unreadable during an account transition', async () => {
    const previousData = {
      profile: { name: 'Account A' },
      library: [],
      routines: [],
      history: [],
      nutrition: {},
      customFoods: [],
      activeWorkout: null,
      nutritionPlanning: {} as any,
    } as UserData;
    useAppStore.setState({ userData: previousData, dataOwner: 'user:account-a', localPersistenceBlocked: false });

    let authCallback!: (user: any) => Promise<void>;
    vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth, callback: any) => {
      authCallback = callback;
      return () => {};
    });
    (auth as any).currentUser = null;

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(authCallback).toBeDefined());

    localStorageMock.getItem.mockImplementationOnce((key: string) => {
      if (key === 'logbook_is_guest') throw new DOMException('blocked', 'SecurityError');
      return null;
    });

    const userB = {
      uid: 'account-b',
      email: 'b@example.com',
      emailVerified: true,
      providerData: [{ providerId: 'password' }],
      getIdToken: vi.fn().mockResolvedValue('test-token'),
    } as any;

    await act(async () => {
      (auth as any).currentUser = userB;
      await authCallback(userB);
    });

    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(useAppStore.getState().userData).toBeNull();
    expect(useAppStore.getState().dataOwner).toBeNull();
    expect(useAppStore.getState().saveError).toContain('non può determinare in sicurezza');
  });

  test('IndexedDB Cache Snapshot: stores cached userData in IndexedDB for instant offline start', async () => {
    const mockCache: UserData = {
      profile: { height: '180' },
      library: [{ id: 'ex1', name: 'Panca Piana', muscles: ['chest'], setsCount: 3, sets: [], notes: '' }],
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
    expect(cachedInStorage).toMatch(/^tlb-sealed:v1:/);
    expect(cachedInStorage).not.toContain('Panca Piana');
    expect((await localRepository.readLocal('user:test-user-id'))?.data.profile?.height).toBe('180');
  });

  test('Save and Reset Store manages local cached data correctly', async () => {
    const sampleData: UserData = {
      profile: { height: '176' },
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
    expect(idbStore['logbook:v2:user:test-user-id']).toMatch(/^tlb-sealed:v1:/);
    expect((await localRepository.readLocal('user:test-user-id'))?.data.profile?.height).toBe('176');

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

    // App should still become READY without crashing
    await waitFor(() => expect(screen.getByTestId('loading-state').textContent).toBe('READY'));

    DB.loadUserData = originalLoad;
  });
});
