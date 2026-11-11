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
    authState.user.emailVerified = false;
    (auth as { currentUser: unknown }).currentUser = authState.user;
    invalidateSession();
    authState.showAlert.mockResolvedValue(undefined);
    authState.resendEmailVerification.mockResolvedValue('sent');
  });

describe('email verification feedback privacy', () => {

  it('does not reveal raw Firebase exceptions after verification refresh fails', async () => {
    authState.refreshEmailVerification.mockRejectedValueOnce(new Error('PRIVATE_AUTH_PROVIDER_DETAILS'));
    render(<AccountCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Ho verificato' }));
    await waitFor(() => expect(authState.showAlert).toHaveBeenCalledWith('Verifica email non riuscita. Riprova.'));
    expect(JSON.stringify(authState.showAlert.mock.calls)).not.toContain('PRIVATE_AUTH_PROVIDER_DETAILS');
  });

  it('distinguishes verified email from a later refresh barrier failure in the account card', async () => {
    authState.user.emailVerified = true;
    authState.refreshEmailVerification.mockRejectedValueOnce(new Error('PRIVATE_REFRESH_FAILURE'));
    render(<AccountCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Ho verificato' }));
    await waitFor(() => expect(authState.showAlert).toHaveBeenCalledWith(expect.stringContaining('Email verificata')));
    expect(JSON.stringify(authState.showAlert.mock.calls)).not.toContain('PRIVATE_REFRESH_FAILURE');
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
  authState.resendEmailVerification.mockImplementationOnce(() => new Promise<'sent'>(resolve => { finish = () => resolve('sent'); }));
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
  it('does not claim to send an email when Firebase reports it is already verified', async () => {
    authState.resendEmailVerification.mockResolvedValueOnce('already-verified');
    render(<EmailVerificationGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Invia di nuovo la verifica' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Email già verificata'));
    expect(screen.getByRole('status').textContent).not.toContain('Email inviata');
  });

  it('shows an actionable error and avoids Firebase requests when owner storage is unreadable', async () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => {
      throw new Error('private browser storage details');
    });
    try {
      render(<EmailVerificationGate />);
      fireEvent.click(screen.getByRole('button', { name: 'Ho verificato la mia email' }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Archivio locale non disponibile'));
      expect(authState.refreshEmailVerification).not.toHaveBeenCalled();
      expect(screen.getByRole('status').textContent).not.toContain('private browser storage details');
    } finally {
      getItem.mockRestore();
    }
  });

  it('shows pending feedback only when Firebase still reports an unverified address', async () => {
    authState.refreshEmailVerification.mockResolvedValueOnce('pending');
    render(<EmailVerificationGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Ho verificato la mia email' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('non risulta ancora completata'));
  });

  it('reports that verification succeeded but safe account opening is still blocked', async () => {
    authState.user.emailVerified = true;
    authState.refreshEmailVerification.mockRejectedValueOnce(new Error('PRIVATE_REFRESH_FAILURE'));
    render(<EmailVerificationGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Ho verificato la mia email' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Email verificata'));
    expect(screen.getByRole('status').textContent).toContain('non è ancora pronto');
    expect(screen.getByRole('status').textContent).not.toContain('PRIVATE_REFRESH_FAILURE');
  });

  it('does not misreport an already verified email in the account card', async () => {
    authState.resendEmailVerification.mockResolvedValueOnce('already-verified');
    render(<AccountCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Invia di nuovo' }));
    await waitFor(() => expect(authState.showAlert).toHaveBeenCalledWith(expect.stringContaining('Email già verificata')));
    expect(authState.showAlert).not.toHaveBeenCalledWith(expect.stringContaining('Email di verifica inviata'));
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
