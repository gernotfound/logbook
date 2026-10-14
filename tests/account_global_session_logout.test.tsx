import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({
  account: {
    uid: 'owner-a',
    email: 'owner@example.com',
    emailVerified: true,
    providerData: [{ providerId: 'password' }],
  },
  logout: vi.fn(),
  reauth: vi.fn(),
  revoke: vi.fn(),
  readLocal: vi.fn(),
  showConfirm: vi.fn(),
  showAlert: vi.fn(),
  showPasswordPrompt: vi.fn(),
}));

vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({ currentUser: data.account, isGuest: false, logout: data.logout }),
}));
vi.mock('../src/lib/auth/recentAuth', () => ({
  reauthenticateForSensitiveAction: data.reauth,
  isSensitiveReauthCancellation: () => false,
}));
vi.mock('../src/lib/auth/revokeSessions', () => ({
  revokeSessionsOnServer: data.revoke,
}));
vi.mock('../src/lib/sync/localRepository', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/sync/localRepository')>()),
  readLocal: data.readLocal,
}));
vi.mock('../src/store/useDialogStore', () => ({
  useDialogStore: (selector: (value: any) => unknown) => selector(data),
}));

import { auth } from '../src/lib/firebase';
import { useSettings } from '../src/hooks/useSettings';
import { useAppStore } from '../src/store/useAppStore';

describe('all-device session revocation UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (auth as any).currentUser = data.account;
    useAppStore.getState().resetStore({ force: true });
    data.readLocal.mockResolvedValue({ pending: [] });
    data.showConfirm.mockResolvedValue(true);
    data.showAlert.mockResolvedValue(undefined);
    data.reauth.mockResolvedValue('reauthenticated');
    data.revoke.mockResolvedValue(undefined);
    data.logout.mockImplementation(async () => { (auth as any).currentUser = null; });
  });

  it('asks explicit confirmation, reauthenticates and only then revokes and logs out', async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleLogoutEverywhere());
    expect(data.showConfirm).toHaveBeenCalledTimes(1);
    expect(data.reauth).toHaveBeenCalledTimes(1);
    expect(data.revoke).toHaveBeenCalledWith(data.account);
    expect(data.logout).toHaveBeenCalledWith({ mode: 'normal' });
  });

  it('does not touch remote sessions after canceling the confirmation', async () => {
    data.showConfirm.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleLogoutEverywhere());
    expect(data.reauth).not.toHaveBeenCalled();
    expect(data.revoke).not.toHaveBeenCalled();
  });

  it('preserves pending offline journal entries without revoking or purging', async () => {
    data.readLocal.mockResolvedValue({ pending: [{ type: 'workout.add' }] });
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleLogoutEverywhere());
    expect(data.reauth).not.toHaveBeenCalled();
    expect(data.revoke).not.toHaveBeenCalled();
    expect(data.logout).not.toHaveBeenCalled();
    expect(data.showAlert).toHaveBeenCalledWith(expect.stringContaining('non ancora sincronizzati'));
  });

  it('requires a password for accounts without federated reauthentication', async () => {
    data.reauth.mockResolvedValueOnce('password-required').mockResolvedValueOnce('reauthenticated');
    data.showPasswordPrompt.mockResolvedValueOnce('CurrentPassword123!');
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleLogoutEverywhere());
    expect(data.showPasswordPrompt).toHaveBeenCalledTimes(1);
    expect(data.reauth).toHaveBeenNthCalledWith(2, expect.anything(), 'CurrentPassword123!');
    expect(data.revoke).toHaveBeenCalledTimes(1);
  });

  it('never signs out or claims success if backend revocation is ambiguous', async () => {
    data.revoke.mockRejectedValueOnce(new Error('Revoca non confermata dal server.'));
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleLogoutEverywhere());
    expect(data.logout).not.toHaveBeenCalled();
    expect(data.showAlert).toHaveBeenCalledWith('Revoca non confermata dal server.');
  });

  it('reports a partial local logout without hiding completed remote revocation', async () => {
    data.logout.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleLogoutEverywhere());
    expect(data.revoke).toHaveBeenCalledTimes(1);
    expect(data.showAlert).toHaveBeenCalledWith(expect.stringContaining('Il logout locale non è completo'));
  });
});
