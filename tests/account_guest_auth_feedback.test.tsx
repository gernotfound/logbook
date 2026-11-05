import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  linkGoogleAccount: vi.fn(),
  registerWithEmail: vi.fn(),
  showAlert: vi.fn(async () => {}),
}));
vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: null, isGuest: true,
    linkGoogleAccount: fixture.linkGoogleAccount,
    registerWithEmail: fixture.registerWithEmail,
  }),
}));
vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({ handleLogout: vi.fn() }),
}));
vi.mock('../src/store/useDialogStore', () => ({
  useDialogStore: () => ({ showAlert: fixture.showAlert }),
}));
vi.mock('../src/lib/auth/passwordPolicy', () => ({
  validatePasswordAgainstPolicy: vi.fn(async () => null),
}));
import { AccountCard } from '../src/components/UI/AccountCard';

beforeEach(() => {
  vi.clearAllMocks();
  fixture.linkGoogleAccount.mockResolvedValue(undefined);
  fixture.registerWithEmail.mockResolvedValue(undefined);
});

describe('guest account actions surface pre-provider coordination failures', () => {
  it('awaits Google, rejects duplicate clicks and makes a rejected reservation visible without raw provider details', async () => {
    let reject!: (reason: unknown) => void;
    fixture.linkGoogleAccount.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<AccountCard />);
    const button = screen.getByRole('button', { name: 'Crea account con Google' });
    fireEvent.click(button);
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(fixture.linkGoogleAccount).toHaveBeenCalledExactlyOnceWith('merge');

    await act(async () => { reject(new Error('PRIVATE_AUTH_COORDINATION_DETAILS')); });
    await waitFor(() => expect(fixture.showAlert).toHaveBeenCalledWith(expect.stringContaining('Impossibile avviare l’accesso Google')));
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(JSON.stringify(fixture.showAlert.mock.calls)).not.toContain('PRIVATE_AUTH_COORDINATION_DETAILS');
    expect(screen.getByRole('heading', { name: 'Modalità locale' })).toBeTruthy();

    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(fixture.linkGoogleAccount).toHaveBeenCalledTimes(2);
  });

  it('surfaces a rejected email reservation and leaves the registration form available for correction', async () => {
    fixture.registerWithEmail.mockRejectedValueOnce(new Error('PRIVATE_EMAIL_RESERVATION_DETAILS'));
    render(<AccountCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Crea account con Email e Password' }));
    fireEvent.change(screen.getByPlaceholderText('La tua Email'), { target: { value: 'guest@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('Nuova Password'), { target: { value: 'SyntheticPassword123!' } });
    const submit = screen.getByRole('button', { name: 'Registrati' });
    fireEvent.click(submit);

    await waitFor(() => expect(fixture.registerWithEmail).toHaveBeenCalledExactlyOnceWith(
      'guest@example.test', 'SyntheticPassword123!', 'merge',
    ));
    await waitFor(() => expect(fixture.showAlert).toHaveBeenCalledWith(expect.stringContaining('Impossibile completare la registrazione')));
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
    expect(screen.getByPlaceholderText('La tua Email')).toBeTruthy();
    expect(JSON.stringify(fixture.showAlert.mock.calls)).not.toContain('PRIVATE_EMAIL_RESERVATION_DETAILS');
  });
});
