import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { HealthConsentSuspended } from '../../src/components/UI/HealthConsentSuspended';
import { isVerifiedHealthWithdrawal, registerInitialHealthConsent, reacceptHealthConsent } from '../../src/lib/healthConsent';
import { mockFirebaseAuth } from '../setup';
import { safeHardReload } from '../../src/lib/sync/safeReload';
import { UnverifiedTabSnapshotError } from '../../src/lib/sync/reloadBarrier';
import { useDialogStore } from '../../src/store/useDialogStore';
import { useAppStore } from '../../src/store/useAppStore';
import { invalidateSession } from '../../src/lib/sync/session';
vi.mock('../../src/lib/sync/safeReload', () => ({ safeHardReload: vi.fn(async () => {}) }));

const backupUi = vi.hoisted(() => ({
  url: null as string | null,
  prepare: vi.fn(async () => {}),
  release: vi.fn(),
  erase: vi.fn(async () => {}),
  deleteAccount: vi.fn(async () => {}),
}));
vi.mock('../../src/hooks/useSettings', () => ({
  useSettings: () => ({
    handlePrepareBackup: backupUi.prepare,
    preparedBackupUrl: backupUi.url,
    releasePreparedBackup: backupUi.release,
    handleDeleteAccount: backupUi.deleteAccount,
    handleDeleteHealthData: backupUi.erase,
    erasingHealthData: false,
    handleLogout: vi.fn(),
    exportingData: false,
  }),
}));

const automaticPurge = vi.hoisted(() => ({
  progress: vi.fn(async () => ({ status: 'complete', complete: true } as const)),
  verifyServerCompletion: vi.fn(async (_uid: string) => {}),
  local: vi.fn(async (owner: string) => {
    // Mirror the real purge's durable postcondition, not just a resolved Promise.
    localStorage.setItem('logbook:local-purge-fence:v1:' + owner, 'purge-complete:v1');
  }),
}));
// The empty-device branch requires a successful, readable local archive scan.
// A missing locked vault is NOT proof of emptiness and must remain fail-closed in production.
const localArchive = vi.hoisted(() => ({ read: vi.fn(async () => undefined) }));
vi.mock('../../src/lib/sync/localRepository', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/sync/localRepository')>()),
  readLocal: localArchive.read,
}));
vi.mock('../../src/lib/healthDataErasure', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/healthDataErasure')>()),
  readHealthDataErasureProgress: automaticPurge.progress,
  assertCurrentHealthDataErasureCompleted: automaticPurge.verifyServerCompletion,
}));
vi.mock('../../src/lib/db/db_account', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/db/db_account')>()),
  purgeCompletedHealthDataLocal: automaticPurge.local,
}));

const account = { uid: 'consent-ui-account' } as User;
const checkboxInputs = () => screen.getAllByRole('checkbox') as HTMLInputElement[];
const temporarilyEmptyAccountMemory = () => {
  const { userData, dataOwner } = useAppStore.getState();
  useAppStore.setState({ userData: null, dataOwner: null });
  return () => useAppStore.setState({ userData, dataOwner });
};

beforeEach(() => {
  vi.clearAllMocks();
  backupUi.url = null;
  vi.mocked(isVerifiedHealthWithdrawal).mockReturnValue(false);
});

describe('suspended health-consent screen', () => {

  it('shows trusted automatic erasure status only after confirmed account withdrawal', () => {
    const { rerender } = render(<HealthConsentSuspended status="pending" user={account} />);
    expect(screen.queryByRole('region', { name: 'Cancellazione automatica dei dati' })).toBeNull();
    rerender(<HealthConsentSuspended status="withdrawn" user={null} />);
    expect(screen.queryByRole('region', { name: 'Cancellazione automatica dei dati' })).toBeNull();
    rerender(<HealthConsentSuspended status="withdrawn" user={account} />);
    const region = screen.getByRole('region', { name: 'Cancellazione automatica dei dati' });
    expect(region.textContent).toMatch(/avvia automaticamente la cancellazione/i);
    const verify = screen.getByRole('button', { name: 'Verifica stato cancellazione' }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    expect(screen.getByText(/Verifica del server ancora necessaria prima di confermare la cancellazione/i)).toBeDefined();
    fireEvent.click(verify);
    expect(backupUi.erase).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Elimina definitivamente i miei dati' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Prepara backup JSON' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Presta un nuovo consenso' })).toBeNull();
  });

  it('resumes interrupted local erasure before opening an archive fenced by a prior purge', async () => {
    const actor = mockFirebaseAuth.currentUser as unknown as User;
    const owner = 'user:' + actor.uid;
    const fence = 'logbook:local-purge-fence:v1:' + owner;
    localStorage.setItem(fence, 'purge-in-progress:v1');
    vi.mocked(isVerifiedHealthWithdrawal).mockReturnValue(true);

    render(<HealthConsentSuspended status="withdrawn" user={actor} />);

    await waitFor(() => expect(automaticPurge.local).toHaveBeenCalledWith(owner));
    expect(automaticPurge.progress).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(fence)).toBe('purge-complete:v1');
  });

  it('does not offer a new account consent from a completed job without purge authorization', async () => {
    const actor = mockFirebaseAuth.currentUser as unknown as User;
    vi.mocked(isVerifiedHealthWithdrawal).mockReturnValue(true);
    automaticPurge.verifyServerCompletion.mockRejectedValueOnce(new Error('Prova trusted incompleta'));
    const restoreStore = temporarilyEmptyAccountMemory();
    try {
      render(<HealthConsentSuspended status="withdrawn" user={actor} />);

      await waitFor(() => expect(automaticPurge.verifyServerCompletion).toHaveBeenCalledWith(actor.uid));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Prova trusted incompleta'));
      expect(screen.queryByRole('button', { name: 'Presta un nuovo consenso' })).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(automaticPurge.local).not.toHaveBeenCalled();
      expect(screen.getByText(/Serve ancora la verifica finale di cancellazione/)).toBeDefined();
    } finally {
      restoreStore();
    }
  });

  it('allows a new account consent only after a fresh trusted proof on an empty device', async () => {
    const actor = mockFirebaseAuth.currentUser as unknown as User;
    vi.mocked(isVerifiedHealthWithdrawal).mockReturnValue(true);
    const restoreStore = temporarilyEmptyAccountMemory();
    try {
      render(<HealthConsentSuspended status="withdrawn" user={actor} />);

      await waitFor(() => expect(automaticPurge.verifyServerCompletion).toHaveBeenCalledWith(actor.uid));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Presta un nuovo consenso' })).toBeDefined());
      expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    } finally {
      restoreStore();
    }
  });

  it('hides an old reacceptance authorization if current withdrawal proof is invalidated', async () => {
    const actor = mockFirebaseAuth.currentUser as unknown as User;
    vi.mocked(isVerifiedHealthWithdrawal).mockReturnValue(true);
    const restoreStore = temporarilyEmptyAccountMemory();
    try {
      const { rerender } = render(<HealthConsentSuspended status="withdrawn" user={actor} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Presta un nuovo consenso' })).toBeDefined());
      expect(automaticPurge.verifyServerCompletion).toHaveBeenCalledWith(actor.uid);

      vi.mocked(isVerifiedHealthWithdrawal).mockReturnValue(false);
      rerender(<HealthConsentSuspended status="withdrawn" user={actor} />);
      expect(screen.queryByRole('button', { name: 'Presta un nuovo consenso' })).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
    } finally {
      restoreStore();
    }
  });

  it('does not display a stale erasure failure after a same-UID session replacement', async () => {
    const actor = mockFirebaseAuth.currentUser as unknown as User;
    vi.mocked(isVerifiedHealthWithdrawal).mockReturnValue(true);
    let rejectProgress!: (error: Error) => void;
    automaticPurge.progress.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectProgress = reject;
    }));

    render(<HealthConsentSuspended status="withdrawn" user={actor} />);
    await waitFor(() => expect(automaticPurge.progress).toHaveBeenCalledTimes(1));
    invalidateSession();
    rejectProgress(new Error('Errore della sessione precedente'));

    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'Verifica stato cancellazione' }) as HTMLButtonElement).disabled,
    ).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Errore della sessione precedente')).toBeNull();
  });

  it('allows guest deletion after withdrawal without submitting a cloud erasure', () => {
    render(<HealthConsentSuspended status="withdrawn" user={null} />);
    const button = screen.getByRole('button', { name: 'Elimina dati di questo dispositivo' });
    expect(screen.getByRole('region', { name: 'Cancellazione dei dati locali dopo la revoca' }).contains(button)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Elimina definitivamente i miei dati' })).toBeNull();
    fireEvent.click(button);
    expect(backupUi.deleteAccount).toHaveBeenCalledTimes(1);
    expect(backupUi.erase).not.toHaveBeenCalled();
  });


  it('does not expose cloud erasure verification or new consent without trusted withdrawal', () => {
    const { rerender } = render(<HealthConsentSuspended status="unregistered" user={account} />);
    for (const status of ['unregistered', 'checking', 'error', 'pending', 'stale-request', 'reaccepting', 'recovery-required', 'erasure-required'] as const) {
      rerender(<HealthConsentSuspended status={status} user={account} />);
      expect(screen.queryByRole('region', { name: 'Cancellazione automatica dei dati' })).toBeNull();
      if (status !== 'unregistered') expect(screen.queryByRole('button', { name: 'Presta un nuovo consenso' })).toBeNull();
    }
    expect(backupUi.erase).not.toHaveBeenCalled();
  });

  it('renders explicit first acceptance separately from revocation and does not submit unchecked choices', async () => {
    vi.mocked(registerInitialHealthConsent).mockRejectedValue(new Error('Rete non disponibile'));
    render(<HealthConsentSuspended status="unregistered" user={account} />);
    expect(screen.getByRole('heading', { name: 'Primo consenso richiesto' })).toBeDefined();
    expect(screen.getByText(/Il backup JSON esportato non è cifrato/i)).toBeDefined();
    const submit = screen.getByRole('button', { name: 'Accetta e continua' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.click(checkboxInputs()[1]);
    fireEvent.click(checkboxInputs()[2]);
    expect(submit.disabled).toBe(true);
    fireEvent.click(checkboxInputs()[0]);
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(registerInitialHealthConsent).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toContain('Rete non disponibile');
  });


  it('blocks reacceptance during pending and scheduled erasure without consent checkboxes', () => {
    const { rerender } = render(<HealthConsentSuspended status="pending" user={account} />);
    expect(screen.getByRole('status').textContent).toContain('In attesa della conferma cloud');
    expect(screen.queryByRole('checkbox')).toBeNull();
    rerender(<HealthConsentSuspended status="withdrawn" user={account} />);
    expect(screen.getByRole('region', { name: 'Cancellazione automatica dei dati' })).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: "Elimina definitivamente l'account" })).toBeDefined();
    expect(reacceptHealthConsent).not.toHaveBeenCalled();
  });

  it('shows erased local archives separately from recoverable offline journals, without a replay button', () => {
    render(<HealthConsentSuspended status="erasure-required" user={account} />);
    expect(screen.getByText(/cancellazione dei dati eseguita sul cloud include la generazione/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Prepara backup JSON' })).toBeDefined();
    expect(screen.getByRole('button', { name: "Esci dall'account" })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Recupera modifiche e riattiva' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });



  it('offers retry on verification failure without reacceptance', () => {
    const onRetry = vi.fn();
    window.addEventListener('logbook:retry-health-consent', onRetry);
    try {
      render(<HealthConsentSuspended status="error" user={account} />);
      expect(screen.queryByRole('checkbox')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Riprova la verifica' }));
      expect(onRetry).toHaveBeenCalledOnce();
      expect(reacceptHealthConsent).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('logbook:retry-health-consent', onRetry);
    }
  });

  it('does not offer premature reacceptance for unverified, failed, stale or recovery states', () => {
    const { rerender } = render(<HealthConsentSuspended status="checking" user={account} />);
    for (const status of ['checking', 'error', 'stale-request', 'recovery-required', 'erasure-required'] as const) {
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





  it('does not allow restarting guest fitness from the old withdrawn archive', () => {
    render(<HealthConsentSuspended status="withdrawn" user={null} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Elimina dati di questo dispositivo' })).toBeDefined();
  });


  it('does not authorize an interrupted reacceptance without a completed erasure', () => {
    render(<HealthConsentSuspended status="reaccepting" user={account} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(reacceptHealthConsent).not.toHaveBeenCalled();
  });

});

describe('account consent withdrawal offline', () => {

  it('blocks account reacceptance offline while the erasure is not verified', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      render(<HealthConsentSuspended status="pending" user={account} />);
      expect(screen.queryByRole('button', { name: 'Riattiva solo su questo dispositivo' })).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
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
    expect((screen.getByRole('button', { name: 'Prepara backup JSON' }) as HTMLButtonElement).disabled).toBe(true);
    expect(backupUi.prepare).not.toHaveBeenCalled();
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
