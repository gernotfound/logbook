import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  linkGoogleAccount: vi.fn(),
  registerWithEmail: vi.fn(),
  showAlert: vi.fn(async () => {}),
}));
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: null, isGuest: true,
    linkGoogleAccount: fixture.linkGoogleAccount,
    registerWithEmail: fixture.registerWithEmail,
  }),
}));
vi.mock('../../../src/hooks/useSettings', () => ({
  useSettings: () => ({ handleLogout: vi.fn() }),
}));
vi.mock('../../../src/store/useDialogStore', () => ({
  useDialogStore: () => ({ showAlert: fixture.showAlert }),
}));
import { auth } from '../../../src/lib/firebase';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../../src/lib/sync/session';
import { safeHardReload } from '../../../src/lib/sync/safeReload';
vi.mock('../../../src/lib/sync/safeReload', () => ({ safeHardReload: vi.fn(async () => {}) }));
import { AccountCard } from '../../../src/components/UI/AccountCard';

beforeEach(() => {
  vi.clearAllMocks();
  (auth as { currentUser: unknown }).currentUser = null;
  localStorage.setItem('logbook_is_guest', 'true');
  localStorage.setItem(GUEST_SESSION_KEY, 'guest-account-feedback');
  activateGuestSession('guest-account-feedback');
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
      'guest@example.test', 'SyntheticPassword123!', 'merge', expect.any(Function),
    ));
    await waitFor(() => expect(fixture.showAlert).toHaveBeenCalledWith(expect.stringContaining('Impossibile completare la registrazione')));
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
    expect(screen.getByPlaceholderText('La tua Email')).toBeTruthy();
    expect(JSON.stringify(fixture.showAlert.mock.calls)).not.toContain('PRIVATE_EMAIL_RESERVATION_DETAILS');
  });
});

it('leaves verification and navigation to AuthProvider after a guest registration returns', async () => {
  render(<AccountCard />);
  fireEvent.click(screen.getByRole('button', { name: 'Crea account con Email e Password' }));
  fireEvent.change(screen.getByPlaceholderText('La tua Email'), { target: { value: 'guest@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('Nuova Password'), { target: { value: 'SyntheticPassword123!' } });
  const submit = screen.getByRole('button', { name: 'Registrati' });
  fireEvent.click(submit);
  await waitFor(() => expect(fixture.registerWithEmail).toHaveBeenCalledOnce());
  await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
  expect(safeHardReload).not.toHaveBeenCalled();
});

it('passes a guest generation fence to the single registration validator', async () => {
  render(<AccountCard />);
  fireEvent.click(screen.getByRole('button', { name: 'Crea account con Email e Password' }));
  fireEvent.change(screen.getByPlaceholderText('La tua Email'), { target: { value: 'guest@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('Nuova Password'), { target: { value: 'SyntheticPassword123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrati' }));
  await waitFor(() => expect(fixture.registerWithEmail).toHaveBeenCalledOnce());
  const isCurrent = fixture.registerWithEmail.mock.calls[0][3] as () => boolean;
  expect(isCurrent()).toBe(true);
  localStorage.setItem(GUEST_SESSION_KEY, 'next-guest-generation');
  activateGuestSession('next-guest-generation');
  expect(isCurrent()).toBe(false);
  expect(fixture.showAlert).not.toHaveBeenCalled();
  expect(safeHardReload).not.toHaveBeenCalled();
});

it('cancels a guest registration when its account modal closes', async () => {
  render(<AccountCard />);
  fireEvent.click(screen.getByRole('button', { name: 'Crea account con Email e Password' }));
  fireEvent.change(screen.getByPlaceholderText('La tua Email'), { target: { value: 'guest@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('Nuova Password'), { target: { value: 'SyntheticPassword123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrati' }));
  await waitFor(() => expect(fixture.registerWithEmail).toHaveBeenCalledOnce());
  const isCurrent = fixture.registerWithEmail.mock.calls[0][3] as () => boolean;
  expect(isCurrent()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
  expect(isCurrent()).toBe(false);
});

it.each(['auth-owner', 'guest-generation'] as const)(
  'does not expose an old guest Google failure after %s changes', async boundary => {
    let fail!: (error: unknown) => void;
    fixture.linkGoogleAccount.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    render(<AccountCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Crea account con Google' }));
    expect(fixture.linkGoogleAccount).toHaveBeenCalledOnce();
    if (boundary === 'auth-owner') (auth as { currentUser: unknown }).currentUser = { uid: 'next-account' };
    else {
      localStorage.setItem(GUEST_SESSION_KEY, 'next-guest-generation');
      activateGuestSession('next-guest-generation');
    }
    await act(async () => { fail(new Error('obsolete reservation failure')); });
    expect(fixture.showAlert).not.toHaveBeenCalled();
  },
);
