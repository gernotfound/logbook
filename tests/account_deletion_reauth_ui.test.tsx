import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: {
    uid: 'test-user-id',
    email: 'test@example.com',
    providerData: [{ providerId: 'password' }],
  },
  logout: vi.fn(),
  isGuest: false,
}));

const reauth = vi.hoisted(() => ({
  run: vi.fn(),
}));

const dialog = vi.hoisted(() => ({
  showConfirm: vi.fn(),
  showPasswordPrompt: vi.fn(),
  showAlert: vi.fn(),
}));

vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: authState.user,
    isGuest: authState.isGuest,
    logout: authState.logout,
  }),
}));
vi.mock('../src/lib/auth/recentAuth', () => ({
  reauthenticateForSensitiveAction: reauth.run,
  isSensitiveReauthCancellation: () => false,
}));

vi.mock('../src/store/useDialogStore', () => ({
  useDialogStore: (selector: (state: typeof dialog) => unknown) => selector(dialog),
}));

import { DB } from '../src/lib/db';
import { useSettings } from '../src/hooks/useSettings';
import { localStorageMock } from './setup';
import { activateGuestSession } from '../src/lib/sync/session';

describe('account deletion recent authentication', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    authState.isGuest = false;
    dialog.showConfirm.mockResolvedValue(true);
    dialog.showAlert.mockResolvedValue(undefined);
  });

  it('releases the deletion busy guard when strict session capture fails', async () => {
    dialog.showConfirm.mockResolvedValue(false);

    const { result } = renderHook(() => useSettings());
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await act(async () => result.current.handleDeleteAccount());
    expect(dialog.showAlert).toHaveBeenCalledTimes(1);

    await act(async () => result.current.handleDeleteAccount());
    expect(dialog.showConfirm).toHaveBeenCalledTimes(1);
  });

  it('prompts password-only users and deletes only after successful reauthentication', async () => {
    dialog.showPasswordPrompt.mockResolvedValue('Secret1!');
    reauth.run
      .mockResolvedValueOnce('password-required')
      .mockResolvedValueOnce('reauthenticated');
    const deleteSpy = vi.spyOn(DB, 'deleteAccount').mockResolvedValue({ status: 'complete' });
    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleDeleteAccount());

    expect(dialog.showConfirm).toHaveBeenCalledTimes(2);
    expect(dialog.showPasswordPrompt).toHaveBeenCalledTimes(1);
    expect(reauth.run).toHaveBeenNthCalledWith(1, expect.objectContaining({ uid: 'test-user-id' }));
    expect(reauth.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ uid: 'test-user-id' }),
      'Secret1!',
    );
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(result.current.deletionPhase).toBe('idle');
  });

  it('deletes the authenticated account rather than purging guest data before initial consent', async () => {
    authState.isGuest = true;
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem('logbook_guest_session_id_v1', 'guest-before-consent');
    activateGuestSession('guest-before-consent');
    reauth.run.mockResolvedValue('reauthenticated');
    const deleteSpy = vi.spyOn(DB, 'deleteAccount').mockResolvedValue({ status: 'pending', message: 'Server in corso' });
    const { result } = renderHook(() => useSettings());

    await act(async () => result.current.handleDeleteAccount());

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(authState.logout).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_is_guest')).toBe('true');
    expect(dialog.showConfirm).toHaveBeenCalledTimes(2);
  });

  it('exposes a deleting phase while the server deletion is in progress', async () => {
    reauth.run.mockResolvedValue('reauthenticated');
    let resolveDeletion: ((value: { status: 'complete' }) => void) | undefined;
    vi.spyOn(DB, 'deleteAccount').mockImplementation(() => new Promise(resolve => {
      resolveDeletion = resolve;
    }));

    const { result } = renderHook(() => useSettings());
    let work: Promise<void>;
    act(() => {
      work = result.current.handleDeleteAccount();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.deletingAccount).toBe(true);
    expect(result.current.deletionPhase).toBe('deleting');

    await act(async () => {
      resolveDeletion?.({ status: 'complete' });
      await work!;
    });
    expect(result.current.deletingAccount).toBe(false);
    expect(result.current.deletionPhase).toBe('idle');
  });

  it('cancels safely when the password prompt is dismissed', async () => {
    dialog.showPasswordPrompt.mockResolvedValue(null);
    reauth.run.mockResolvedValue('password-required');
    const deleteSpy = vi.spyOn(DB, 'deleteAccount').mockResolvedValue({ status: 'complete' });

    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleDeleteAccount());

    expect(dialog.showPasswordPrompt).toHaveBeenCalledTimes(1);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(result.current.deletingAccount).toBe(false);
  });
});
