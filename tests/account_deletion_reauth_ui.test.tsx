import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: {
    uid: 'test-user-id',
    email: 'test@example.com',
    providerData: [{ providerId: 'password' }],
  },
  logout: vi.fn(),
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
    isGuest: false,
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

describe('account deletion recent authentication', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    dialog.showConfirm.mockResolvedValue(true);
    dialog.showAlert.mockResolvedValue(undefined);
  });

  it('releases the deletion busy guard when strict session capture fails', async () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    dialog.showConfirm.mockResolvedValue(false);

    const { result } = renderHook(() => useSettings());
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
