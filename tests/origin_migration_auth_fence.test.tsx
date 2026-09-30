import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { auth, onAuthStateChanged, signOut } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAppStore } from '../src/store/useAppStore';

const wrongUser = {
  uid: 'wrong-account',
  email: 'wrong@example.test',
  displayName: 'Wrong Account',
} as any;

describe('origin migration authenticated identity fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.getState().resetStore({ force: true });
    (auth as any).currentUser = wrongUser;
    vi.mocked(signOut).mockResolvedValue(undefined);
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
      callback(wrongUser);
      return () => {};
    });
  });

  it('signs out and does not hydrate a different account while transferred data is pending', async () => {
    localStorage.setItem('logbook_origin_migration_pending_uid_v1', 'expected-account');

    render(<AuthProvider><div>app</div></AuthProvider>);

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith(auth);
    });

    expect(DB.loadCloudPayload).not.toHaveBeenCalled();
    expect(useAppStore.getState().saveError).toContain('altro account');
  });
});
