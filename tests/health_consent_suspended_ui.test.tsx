import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { HealthConsentSuspended } from '../src/components/UI/HealthConsentSuspended';
import { finishHealthConsentReacceptance, registerInitialHealthConsent, reacceptHealthConsent, reacceptHealthConsentLocally, refreshHealthConsent } from '../src/lib/healthConsent';
import { safeHardReload } from '../src/lib/sync/safeReload';
import { UnverifiedTabSnapshotError } from '../src/lib/sync/reloadBarrier';
import { useDialogStore } from '../src/store/useDialogStore';
vi.mock('../src/lib/sync/safeReload', () => ({ safeHardReload: vi.fn(async () => {}) }));

const backupUi = vi.hoisted(() => ({
  url: null as string | null,
  prepare: vi.fn(async () => {}),
  release: vi.fn(),
}));
vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({
    handlePrepareBackup: backupUi.prepare,
    preparedBackupUrl: backupUi.url,
    releasePreparedBackup: backupUi.release,
    handleDeleteAccount: vi.fn(),
    handleLogout: vi.fn(),
    exportingData: false,
  }),
}));

const account = { uid: 'consent-ui-account' } as User;
const checkboxInputs = () => screen.getAllByRole('checkbox') as HTMLInputElement[];
const reacceptButton = () => screen.getByRole('button', { name: 'Presta un nuovo consenso' }) as HTMLButtonElement;

beforeEach(() => { vi.clearAllMocks(); backupUi.url = null; });

describe('suspended health-consent screen', () => {
  it('renders explicit first acceptance separately from revocation and does not submit unchecked choices', async () => {
    vi.mocked(registerInitialHealthConsent).mockRejectedValue(new Error('Rete non disponibile'));
    render(<HealthConsentSuspended status="unregistered" user={account} />);
    expect(screen.getByRole('heading', { name: 'Primo consenso richiesto' })).toBeDefined();
    expect(screen.getByText(/Il backup JSON esportato non è cifrato/i)).toBeDefined();
    const submit = screen.getByRole('button', { name: 'Accetta e continua' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(checkboxInputs()[0]);
    expect(submit.disabled).toBe(true);
    fireEvent.click(checkboxInputs()[1]);
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(registerInitialHealthConsent).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toContain('Rete non disponibile');
  });

  it('keeps the same reacceptance form visible from pending to server-confirmed withdrawal', () => {
    const { rerender } = render(<HealthConsentSuspended status="pending" user={account} />);
    const [terms, health] = checkboxInputs();
    const submit = reacceptButton();

    expect(screen.getByRole('status').textContent).toContain('In attesa della conferma cloud');
    expect(terms.disabled).toBe(true);
    expect(health.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(reacceptHealthConsent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Prepara backup JSON' })).toBeDefined();
    expect(screen.getByRole('button', { name: "Elimina definitivamente l'account" })).toBeDefined();

    rerender(<HealthConsentSuspended status="withdrawn" user={account} />);
    expect(screen.getByRole('status').textContent).toContain('Revoca confermata sul server');
    const [enabledTerms, enabledHealth] = checkboxInputs();
    const enabledSubmit = reacceptButton();
    expect(enabledTerms.disabled).toBe(false);
    expect(enabledHealth.disabled).toBe(false);
    expect(enabledTerms.checked).toBe(false);
    expect(enabledHealth.checked).toBe(false);
    expect(enabledSubmit.disabled).toBe(true);

    fireEvent.click(enabledTerms);
    expect(enabledSubmit.disabled).toBe(true);
    fireEvent.click(enabledHealth);
    expect(enabledSubmit.disabled).toBe(false);

    rerender(<HealthConsentSuspended status="pending" user={account} />);
    const [pendingTerms, pendingHealth] = checkboxInputs();
    expect(pendingTerms.disabled).toBe(true);
    expect(pendingHealth.disabled).toBe(true);
    expect(pendingTerms.checked).toBe(false);
    expect(pendingHealth.checked).toBe(false);
    expect(reacceptButton().disabled).toBe(true);
    fireEvent.click(reacceptButton());
    expect(reacceptHealthConsent).not.toHaveBeenCalled();

    rerender(<HealthConsentSuspended status="withdrawn" user={account} />);
    expect(checkboxInputs()[0].checked).toBe(false);
    expect(checkboxInputs()[1].checked).toBe(false);
    expect(reacceptButton().disabled).toBe(true);
  });

  it('does not offer premature reacceptance for unverified, failed, stale or recovery states', () => {
    const { rerender } = render(<HealthConsentSuspended status="checking" user={account} />);
    for (const status of ['checking', 'error', 'stale-request', 'recovery-required'] as const) {
      rerender(<HealthConsentSuspended status={status} user={account} />);
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Presta un nuovo consenso' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Prepara backup JSON' })).toBeDefined();
      if (status === 'checking' || status === 'error') {
        expect(screen.queryByRole('heading', { name: 'Accesso a TheLogBook sospeso' })).toBeNull();
        expect(screen.getByText(/non significa che tu abbia revocato il consenso/)).toBeDefined();
      }
    }
  });


  it('does not report a failed consent when the server accepted it but offline data needs recovery', async () => {
    vi.mocked(reacceptHealthConsent).mockResolvedValue('2026-10-12T10:00:00.000Z');
    vi.mocked(refreshHealthConsent).mockResolvedValue('recovery-required');

    render(<HealthConsentSuspended status="withdrawn" user={account} />);
    const [terms, health] = checkboxInputs();
    fireEvent.click(terms);
    fireEvent.click(health);
    fireEvent.click(reacceptButton());

    await waitFor(() => expect(refreshHealthConsent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reacceptButton().textContent).toContain('Presta un nuovo consenso'));
    expect(reacceptHealthConsent).toHaveBeenCalledTimes(1);
    expect(finishHealthConsentReacceptance).not.toHaveBeenCalled();
    expect(screen.queryByText(/Non è stato possibile completare il nuovo consenso/)).toBeNull();
  });

  it('keeps the guest withdrawal form immediately usable without a cloud wait', () => {
    render(<HealthConsentSuspended status="withdrawn" user={null} />);
    expect(checkboxInputs()).toHaveLength(2);
    expect(checkboxInputs().every(input => !input.disabled)).toBe(true);
    expect(reacceptButton().disabled).toBe(true);
  });

  it('allows explicit completion of an interrupted reacceptance without unlocking automatically', () => {
    render(<HealthConsentSuspended status="reaccepting" user={account} />);
    expect(checkboxInputs().every(input => !input.disabled)).toBe(true);
    expect(reacceptButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Nuovo consenso in fase di completamento');
  });
});

describe('account consent withdrawal offline', () => {
  it('offers a separate local-only consent after pending withdrawal and checks both boxes', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      render(<HealthConsentSuspended status="pending" user={account} />);
      const button = screen.getByRole('button', { name: 'Riattiva solo su questo dispositivo' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      const [terms, health] = checkboxInputs();
      expect(terms.disabled).toBe(false);
      expect(health.disabled).toBe(false);
      expect(screen.getByText(/I dati locali restano conservati/i)).toBeDefined();
      expect(screen.getByRole('button', { name: 'Ricarica pagina' })).toBeDefined();
      fireEvent.click(terms);
      expect(button.disabled).toBe(true);
      fireEvent.click(health);
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      await waitFor(() => expect(reacceptHealthConsentLocally).toHaveBeenCalledTimes(1));
      expect(reacceptHealthConsent).not.toHaveBeenCalled();
      expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
      expect(vi.mocked(reacceptHealthConsentLocally).mock.calls[0][1]).toMatchObject({
        acceptedTerms: true, acceptedHealthData: true,
      });
    } finally {
      online.mockRestore();
    }
  });

  it('shows a single transient notice if a server-confirmed revocation is reaccepted offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      render(<HealthConsentSuspended status="withdrawn" user={account} />);
      expect(screen.getByRole('button', { name: 'Riattiva solo su questo dispositivo' })).toBeDefined();
      const [terms, health] = checkboxInputs();
      fireEvent.click(terms);
      fireEvent.click(health);
      fireEvent.click(screen.getByRole('button', { name: 'Riattiva solo su questo dispositivo' }));
      await waitFor(() => expect(reacceptHealthConsentLocally).toHaveBeenCalledTimes(1));
      expect(useDialogStore.getState().showAlert).toHaveBeenCalledTimes(1);
      expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
        expect.stringContaining('revocato sul server'), 'Uso offline riattivato',
      );
    } finally { online.mockRestore(); }
  });

  it('does not display the cross-mode notice when local reacceptance is rejected', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      vi.mocked(reacceptHealthConsentLocally).mockImplementationOnce(() => { throw new Error('Test storage write failed'); });
      render(<HealthConsentSuspended status="withdrawn" user={account} />);
      const [terms, health] = checkboxInputs();
      fireEvent.click(terms);
      fireEvent.click(health);
      fireEvent.click(screen.getByRole('button', { name: 'Riattiva solo su questo dispositivo' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Non è stato possibile completare'));
      expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
    } finally { online.mockRestore(); }
  });

  it('uses the safe persistence barrier for a visible reload action, including after reconnect', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      vi.mocked(safeHardReload).mockRejectedValueOnce(new Error('Salvataggi non completati.'));
      render(<HealthConsentSuspended status="pending" user={account} />);
      fireEvent.click(screen.getByRole('button', { name: 'Ricarica pagina' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Salvataggi non completati.'));
      expect(safeHardReload).toHaveBeenCalledTimes(1);
    } finally { onLine.mockRestore(); }
  });

  it('offers a direct download link only after the backup has been prepared', () => {
    const { rerender } = render(<HealthConsentSuspended status="withdrawn" user={account} />);
    expect(screen.queryByRole('link', { name: 'Scarica backup JSON' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Prepara backup JSON' }));
    expect(backupUi.prepare).toHaveBeenCalledTimes(1);
    backupUi.url = 'blob:https://example.test/prepared-backup';
    rerender(<HealthConsentSuspended status="withdrawn" user={account} />);
    const link = screen.getByRole('link', { name: 'Scarica backup JSON' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(backupUi.url);
    expect(link.getAttribute('download')).toBe('logbook_backup.json');
    fireEvent.click(screen.getByRole('button', { name: 'Elimina il download preparato' }));
    expect(backupUi.release).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit choice before reloading when RAM changes cannot be attributed', async () => {
    vi.mocked(safeHardReload).mockRejectedValueOnce(new UnverifiedTabSnapshotError());
    const confirmation = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValueOnce(true);
    render(<HealthConsentSuspended status="withdrawn" user={account} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ricarica pagina' }));
    await waitFor(() => expect(confirmation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(safeHardReload).toHaveBeenCalledTimes(2));
    expect(vi.mocked(safeHardReload).mock.calls[1][1]).toEqual({ discardUnverifiedInMemoryData: true });
    expect(confirmation.mock.calls[0][0]).toContain('potrebbero andare persi');
    confirmation.mockRestore();
  });

  it('does not discard uncertain memory when the user cancels reloading', async () => {
    vi.mocked(safeHardReload).mockRejectedValueOnce(new UnverifiedTabSnapshotError());
    const confirmation = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValueOnce(false);
    render(<HealthConsentSuspended status="withdrawn" user={account} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ricarica pagina' }));
    await waitFor(() => expect(confirmation).toHaveBeenCalledTimes(1));
    expect(safeHardReload).toHaveBeenCalledTimes(1);
    confirmation.mockRestore();
  });

  it('does not start a redundant consent refresh alongside AuthProvider reconnect checks', () => {
    render(<HealthConsentSuspended status="pending" user={account} />);
    expect(screen.queryByRole('button', { name: 'Riprova a verificare il consenso' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ricarica pagina' })).toBeDefined();
  });
});
