import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: {
    uid: 'unverified-user', email: 'unverified@example.test', emailVerified: false,
    providerData: [{ providerId: 'password' }],
  },
  refreshEmailVerification: vi.fn(),
  resendEmailVerification: vi.fn(),
  continueUnverifiedLocally: vi.fn(),
  showAlert: vi.fn(),
  handleLogout: vi.fn(),
}));

vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: authState.user,
    isGuest: false,
    emailVerificationRequired: true,
    refreshEmailVerification: authState.refreshEmailVerification,
    resendEmailVerification: authState.resendEmailVerification,
    continueUnverifiedLocally: authState.continueUnverifiedLocally,
  }),
}));
vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({ handleLogout: authState.handleLogout }),
}));
vi.mock('../src/store/useDialogStore', () => ({
  useDialogStore: () => ({ showAlert: authState.showAlert }),
}));

import { auth } from '../src/lib/firebase';
import { invalidateSession } from '../src/lib/sync/session';
import { AccountCard } from '../src/components/UI/AccountCard';
import { EmailVerificationGate } from '../src/components/UI/EmailVerificationGate';

beforeEach(() => {
    vi.clearAllMocks();
    (auth as { currentUser: unknown }).currentUser = authState.user;
    invalidateSession();
    authState.showAlert.mockResolvedValue(undefined);
  });

describe('email verification feedback privacy', () => {

  it('does not reveal raw Firebase exceptions after verification refresh fails', async () => {
    authState.refreshEmailVerification.mockRejectedValueOnce(new Error('PRIVATE_AUTH_PROVIDER_DETAILS'));
    render(<AccountCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Ho verificato' }));
    await waitFor(() => expect(authState.showAlert).toHaveBeenCalledWith('Verifica email non riuscita. Riprova.'));
    expect(JSON.stringify(authState.showAlert.mock.calls)).not.toContain('PRIVATE_AUTH_PROVIDER_DETAILS');
  });

  it('does not reveal raw Firebase exceptions when verification email cannot be sent', async () => {
    authState.resendEmailVerification.mockRejectedValueOnce(new Error('PRIVATE_AUTH_PROVIDER_DETAILS'));
    render(<AccountCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Invia di nuovo' }));
    await waitFor(() => expect(authState.showAlert).toHaveBeenCalledWith('Invio email non riuscito. Riprova.'));
    expect(JSON.stringify(authState.showAlert.mock.calls)).not.toContain('PRIVATE_AUTH_PROVIDER_DETAILS');
  });
});

it('does not alert the next session after an old email send resolves', async () => {
  let finish!: () => void;
  authState.resendEmailVerification.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<AccountCard />);
  const button = screen.getByRole('button', { name: 'Invia di nuovo' });
  fireEvent.click(button);
  expect(authState.resendEmailVerification).toHaveBeenCalledOnce();
  invalidateSession();
  await act(async () => { finish(); });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  expect(authState.showAlert).not.toHaveBeenCalled();
});


describe('email verification gate feedback', () => {
  it('shows pending feedback only when Firebase still reports an unverified address', async () => {
    authState.refreshEmailVerification.mockResolvedValueOnce('pending');
    render(<EmailVerificationGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Ho verificato la mia email' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('non risulta ancora completata'));
  });

  it('does not report a pending verification after Firebase confirms it', async () => {
    authState.refreshEmailVerification.mockResolvedValueOnce('verified');
    render(<EmailVerificationGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Ho verificato la mia email' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Email verificata'));
    expect(screen.getByRole('status').textContent).not.toContain('non risulta');
  });

  it('ignores a late result belonging to a previous Auth session', async () => {
    let resolve!: (result: string) => void;
    authState.refreshEmailVerification.mockImplementationOnce(() => new Promise(result => { resolve = result; }));
    render(<EmailVerificationGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Ho verificato la mia email' }));
    (auth as { currentUser: unknown }).currentUser = { uid: 'other-account', emailVerified: false };
    invalidateSession();
    await act(async () => { resolve('pending'); });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
