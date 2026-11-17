import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  login: vi.fn(),
  linkGoogleAccount: vi.fn(),
  registerWithEmail: vi.fn(),
  logout: vi.fn(),
  showAlert: vi.fn(),
}));
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: null, isGuest: true, login: actions.login,
    linkGoogleAccount: actions.linkGoogleAccount,
    registerWithEmail: actions.registerWithEmail,
  }),
}));
vi.mock('../../../src/hooks/useSettings', () => ({
  useSettings: () => ({
    handleLogout: actions.logout, handleLogoutEverywhere: vi.fn(),
    revokingSessions: false,
  }),
}));
vi.mock('../../../src/store/useDialogStore', () => ({
  useDialogStore: () => ({ showAlert: actions.showAlert }),
}));
import { AccountCard } from '../../../src/components/UI/AccountCard';

describe('guest account panel excludes Firebase login during Kinde cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem('logbook_guest_session_id_v1', 'current-guest-generation');
  });

  it('does not expose legacy account creation or mutate guest storage', () => {
    const view = render(<AccountCard />);
    expect(screen.getByRole('heading', { name: 'Modalità locale' })).toBeTruthy();
    expect(screen.getByText(/Il passaggio a un account Kinde/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crea account con Google' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crea account con Email e Password' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrati' })).toBeNull();
    expect(screen.queryByPlaceholderText('Nuova Password')).toBeNull();
    expect(localStorage.getItem('logbook_is_guest')).toBe('true');
    expect(localStorage.getItem('logbook_guest_session_id_v1')).toBe('current-guest-generation');
    view.unmount();
    expect(actions.login).not.toHaveBeenCalled();
    expect(actions.linkGoogleAccount).not.toHaveBeenCalled();
    expect(actions.registerWithEmail).not.toHaveBeenCalled();
    expect(actions.showAlert).not.toHaveBeenCalled();
  });

  it('retains the guarded guest logout delegation without purging the marker itself', () => {
    render(<AccountCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Esci dalla modalità locale' }));
    expect(actions.logout).toHaveBeenCalledOnce();
    expect(localStorage.getItem('logbook_is_guest')).toBe('true');
    expect(actions.login).not.toHaveBeenCalled();
    expect(actions.linkGoogleAccount).not.toHaveBeenCalled();
    expect(actions.registerWithEmail).not.toHaveBeenCalled();
  });
});
