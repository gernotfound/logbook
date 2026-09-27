import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialogStore } from '../src/store/useDialogStore';

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

import { DB } from '../src/lib/db';
import { useSettings } from '../src/hooks/useSettings';

const initialDialogState = useDialogStore.getState();
describe('account deletion recent authentication', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    useDialogStore.setState(initialDialogState);
    vi.restoreAllMocks();
  });

  it('prompts password-only users and deletes only after successful reauthentication', async () => {
    const showConfirm = vi.fn().mockResolvedValue(true);
    const showPasswordPrompt = vi.fn().mockResolvedValue('Secret1!');
    useDialogStore.setState({
      showConfirm,
      showPasswordPrompt,
      showAlert: vi.fn().mockResolvedValue(undefined),
    });

    reauth.run
      .mockResolvedValueOnce('password-required')
      .mockResolvedValueOnce('reauthenticated');
    const deleteSpy = vi.spyOn(DB, 'deleteAccount').mockResolvedValue({ status: 'complete' });

    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleDeleteAccount());

    expect(showConfirm).toHaveBeenCalledTimes(2);
    expect(showPasswordPrompt).toHaveBeenCalledTimes(1);
    expect(reauth.run).toHaveBeenNthCalledWith(1, expect.objectContaining({ uid: 'test-user-id' }));
    expect(reauth.run).toHaveBeenNthCalledWith(2, expect.objectContaining({ uid: 'test-user-id' }), 'Secret1!');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });
  it('cancels safely when the password prompt is dismissed', async () => {
    useDialogStore.setState({
      showConfirm: vi.fn().mockResolvedValue(true),
      showPasswordPrompt: vi.fn().mockResolvedValue(null),
      showAlert: vi.fn().mockResolvedValue(undefined),
    });

    reauth.run.mockResolvedValue('password-required');
    const deleteSpy = vi.spyOn(DB, 'deleteAccount').mockResolvedValue({ status: 'complete' });

    const { result } = renderHook(() => useSettings());
    await act(async () => result.current.handleDeleteAccount());

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(result.current.deletingAccount).toBe(false);
  });
});
