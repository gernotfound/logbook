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
import { invalidateSession } from '../src/lib/sync/session';
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
    expect(data.showConfirm.mock.invocationCallOrder[0]).toBeLessThan(data.reauth.mock.invocationCallOrder[0]);
    expect(data.reauth.mock.invocationCallOrder[0]).toBeLessThan(data.revoke.mock.invocationCallOrder[0]);
    expect(data.revoke.mock.invocationCallOrder[0]).toBeLessThan(data.logout.mock.invocationCallOrder[0]);
  });

  it('does not log out the successor of an in-flight revocation with the same UID', async () => {
    let finishRevocation!: () => void;
    data.revoke.mockImplementationOnce(() => new Promise<void>(resolve => { finishRevocation = resolve; }));
    const { result } = renderHook(() => useSettings());
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleLogoutEverywhere(); });
    await vi.waitFor(() => expect(data.revoke).toHaveBeenCalledOnce());

    invalidateSession();
    (auth as any).currentUser = { ...data.account };
    finishRevocation();
    await act(async () => { await pending; });

    expect(data.logout).not.toHaveBeenCalled();
    expect(data.showAlert).not.toHaveBeenCalled();
  });

  it('refuses global revocation when the durable cloud integrity fence is present', async () => {
    data.readLocal.mockResolvedValue({ pending: [], cloudIntegrityFence: 'unverified-cloud' });
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleLogoutEverywhere());
    expect(data.revoke).not.toHaveBeenCalled();
    expect(data.logout).not.toHaveBeenCalled();
    expect(data.showAlert).toHaveBeenCalledWith(expect.stringContaining('Snapshot cloud non verificato'));
  });

  it('rechecks the cloud integrity fence after reauthentication, before remote revocation', async () => {
    data.readLocal.mockResolvedValueOnce({ pending: [] })
      .mockResolvedValueOnce({ pending: [] })
      .mockResolvedValueOnce({ pending: [], cloudIntegrityFence: 'new-fence' });
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleLogoutEverywhere());
    expect(data.reauth).toHaveBeenCalledOnce();
    expect(data.revoke).not.toHaveBeenCalled();
    expect(data.logout).not.toHaveBeenCalled();
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
