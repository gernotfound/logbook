import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { A, REPLACEMENT_CSRF, browserWitness, principal, confirmed } from './KindeAccountEntryTestFixture';
import { KindeAccountEntry } from './KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import { readKindeCandidateAccess } from '../../lib/auth/kindeCandidateClient';
import { unlockVaultForOwner } from '../../lib/sync/secureArchiveSession';
import { isKindeAccountLocalFitnessClear } from '../../lib/sync/kindeOwnerLocalFitnessFence';
import { prepareKindeCandidatePortableBackupJson } from '../../lib/auth/kindeCandidatePortableBackup';
import { withdrawKindeCandidateHealthConsent, reconcileKindeCandidateWithdrawal } from '../../lib/auth/kindeCandidateWithdrawal';
import { prepareKindeCandidateRightsJson } from '../../lib/auth/kindeCandidateRightsExport';

describe('Kinde candidate entry: backup, revocation and rights', () => {
    it('prepares a voluntary Schema 3 download using only an existing vault in the isolated candidate', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        const release = vi.fn();
        vi.mocked(unlockVaultForOwner).mockResolvedValue({
            isCurrent: () => true, release,
        });
        render(<KindeAccountEntry candidateMode="preparation" />);
        const prepare = await screen.findByRole('button', { name: 'Prepara backup JSON' });
        expect(prepareKindeCandidatePortableBackupJson).not.toHaveBeenCalled();
        fireEvent.click(prepare);
        const download = await screen.findByRole('link', { name: 'Scarica backup JSON' });
        expect(download.getAttribute('href')).toBe('blob:kinde-candidate-export');
        expect(download.getAttribute('download')).toMatch(/^thelogbook_backup_prima_revoca_/);
        expect(unlockVaultForOwner).toHaveBeenCalledWith('user:' + A, expect.any(Function));
        expect(prepareKindeCandidatePortableBackupJson).toHaveBeenCalledWith({
            expected: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
            stillCurrent: expect.any(Function),
        });
        expect(release).toHaveBeenCalledOnce();
        expect(screen.getByText(/File preparato/)).toBeDefined();
        expect(screen.queryByText(/Backup salvato/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Scarta il file temporaneo' }));
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:kinde-candidate-export');
        expect(screen.queryByRole('link', { name: 'Scarica backup JSON' })).toBeNull();
    });

    it('rejects a stale cookie at download time and releases the temporary file', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Prepara backup JSON' }));
        const download = await screen.findByRole('link', { name: 'Scarica backup JSON' });
        browserWitness.csrf = REPLACEMENT_CSRF;
        fireEvent.click(download);
        expect(screen.queryByRole('link', { name: 'Scarica backup JSON' })).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:kinde-candidate-export');
        expect(await screen.findByRole('alert')).toHaveProperty('textContent',
            expect.stringContaining('sessione cambiata'));
    });

    it('does not publish a file when a device vault is unavailable or consent is locally fenced', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        vi.mocked(unlockVaultForOwner).mockRejectedValueOnce(new Error('vault locked'));
        render(<KindeAccountEntry candidateMode="preparation" />);
        const button = await screen.findByRole('button', { name: 'Prepara backup JSON' });
        fireEvent.click(button);
        await screen.findByRole('alert');
        expect(prepareKindeCandidatePortableBackupJson).not.toHaveBeenCalled();
        expect(screen.queryByRole('link', { name: 'Scarica backup JSON' })).toBeNull();
        vi.mocked(isKindeAccountLocalFitnessClear).mockReturnValue(false);
        fireEvent.click(button);
        await screen.findByRole('alert');
        expect(prepareKindeCandidatePortableBackupJson).not.toHaveBeenCalled();
    });

    it('offers optional backup before destructive confirmation, never silently withdrawing', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        render(<KindeAccountEntry candidateMode="preparation" candidateLifecycleEnabled />);
        const backup = await screen.findByRole('button', { name: 'Prepara backup JSON' });
        expect(backup).toBeDefined();
        const revoke = screen.getByRole('button', { name: 'Revoca consenso e avvia cancellazione' });
        expect(revoke.hasAttribute('disabled')).toBe(true);
        expect(withdrawKindeCandidateHealthConsent).not.toHaveBeenCalled();

        fireEvent.click(backup);
        await screen.findByRole('link', { name: 'Scarica backup JSON' });
        expect(withdrawKindeCandidateHealthConsent).not.toHaveBeenCalled();

        vi.mocked(withdrawKindeCandidateHealthConsent).mockImplementationOnce(async () => {
            localStorage.setItem('logbook:v2:user:' + A + ':health-consent-withdrawal', 'withdrawn');
            return { kind: 'withdrawal-recorded', deletionStatus: 'pending' };
        });
        fireEvent.click(screen.getByRole('checkbox', {
            name: /Confermo di voler revocare il consenso/,
        }));
        fireEvent.click(revoke);
        await waitFor(() => expect(withdrawKindeCandidateHealthConsent).toHaveBeenCalledTimes(1));
        expect(withdrawKindeCandidateHealthConsent).toHaveBeenCalledWith({
            confirmsErasure: true,
            expected: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
            stillCurrent: expect.any(Function),
        });
        await waitFor(() => expect(URL.revokeObjectURL)
            .toHaveBeenCalledWith('blob:kinde-candidate-export'));
        expect(screen.queryByRole('link', { name: 'Scarica backup JSON' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Revoca consenso e avvia cancellazione' })).toBeNull();
    });

    it('reconciles a lost withdrawal response without issuing another destructive POST, also after remount', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        vi.mocked(withdrawKindeCandidateHealthConsent).mockImplementationOnce(async () => {
            localStorage.setItem('logbook:v2:user:' + A + ':health-consent-withdrawal', 'pending:1');
            throw new Error('response lost after D1 commit');
        });
        const screenA = render(<KindeAccountEntry candidateMode="preparation" candidateLifecycleEnabled />);
        const checkbox = await screen.findByRole('checkbox', { name: /Confermo di voler revocare/ });
        fireEvent.click(checkbox);
        fireEvent.click(screen.getByRole('button', { name: 'Revoca consenso e avvia cancellazione' }));
        const verify = await screen.findByRole('button', { name: 'Verifica stato della revoca' });
        expect(withdrawKindeCandidateHealthConsent).toHaveBeenCalledTimes(1);
        fireEvent.click(verify);
        await waitFor(() => expect(reconcileKindeCandidateWithdrawal).toHaveBeenCalledTimes(1));
        expect(withdrawKindeCandidateHealthConsent).toHaveBeenCalledTimes(1);
        screenA.unmount();

        render(<KindeAccountEntry candidateMode="preparation" candidateLifecycleEnabled />);
        expect(await screen.findByRole('button', { name: 'Verifica stato della revoca' })).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Revoca consenso e avvia cancellazione' })).toBeNull();
        vi.mocked(reconcileKindeCandidateWithdrawal).mockImplementationOnce(async () => {
            localStorage.setItem('logbook:v2:user:' + A + ':health-consent-withdrawal', 'withdrawn');
            return { kind: 'withdrawal-proven' };
        });
        fireEvent.click(screen.getByRole('button', { name: 'Verifica stato della revoca' }));
        await waitFor(() => expect(reconcileKindeCandidateWithdrawal).toHaveBeenCalledTimes(2));
        expect(withdrawKindeCandidateHealthConsent).toHaveBeenCalledTimes(1);
    });

    it('denies withdrawal on corrupted owner marker and in public identity-only mode', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        const publicEntry = render(<KindeAccountEntry identityOnly candidateMode="preparation" candidateLifecycleEnabled />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: 'Revoca consenso e avvia cancellazione' })).toBeNull();
        publicEntry.unmount();
        localStorage.setItem('logbook:v2:user:' + A + ':health-consent-withdrawal', 'unexpected');
        render(<KindeAccountEntry candidateMode="preparation" candidateLifecycleEnabled />);
        await screen.findByText(/Stato locale della revoca non verificabile/);
        expect(screen.queryByRole('button', { name: 'Revoca consenso e avvia cancellazione' })).toBeNull();
        expect(withdrawKindeCandidateHealthConsent).not.toHaveBeenCalled();
    });

    it('offers rights-only JSON without device vault for an already withdrawn owner', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue({
            kind: 'consent-suspended', principal: confirmed.principal, status: 'withdrawn',
        });
        render(<KindeAccountEntry candidateMode="preparation" candidateLifecycleEnabled />);
        const button = await screen.findByRole('button', { name: 'Verifica dati cloud ancora disponibili' });
        expect(screen.queryByRole('button', { name: 'Prepara backup JSON' })).toBeNull();
        expect(unlockVaultForOwner).not.toHaveBeenCalled();
        fireEvent.click(button);
        const download = await screen.findByRole('link', { name: 'Scarica documenti cloud disponibili' });
        expect(download.getAttribute('download')).toBe('thelogbook_diritti_cloud_2026-11-19.json');
        expect(prepareKindeCandidateRightsJson).toHaveBeenCalledWith({
            expected: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
            stillCurrent: expect.any(Function),
        });
        expect(unlockVaultForOwner).not.toHaveBeenCalled();
        browserWitness.csrf = REPLACEMENT_CSRF;
        fireEvent.click(download);
        expect(screen.queryByRole('link', { name: 'Scarica documenti cloud disponibili' })).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:kinde-candidate-export');
    });

    it('reconciles a local lost withdrawal ACK even when the next trusted SQL view is already suspended', async () => {
        localStorage.setItem('logbook:v2:user:' + A + ':health-consent-withdrawal', 'pending:1');
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue({
            kind: 'consent-suspended', principal: confirmed.principal, status: 'withdrawn',
        });
        vi.mocked(reconcileKindeCandidateWithdrawal).mockImplementationOnce(async () => {
            localStorage.setItem('logbook:v2:user:' + A + ':health-consent-withdrawal', 'withdrawn');
            return { kind: 'withdrawal-proven' };
        });
        render(<KindeAccountEntry candidateMode="preparation" candidateLifecycleEnabled />);
        const readback = await screen.findByRole('button', { name: 'Verifica stato della revoca' });
        expect(screen.getByRole('button', { name: 'Verifica dati cloud ancora disponibili' })).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Revoca consenso e avvia cancellazione' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Prepara backup JSON' })).toBeNull();
        fireEvent.click(readback);
        await waitFor(() => expect(reconcileKindeCandidateWithdrawal).toHaveBeenCalledOnce());
        expect(withdrawKindeCandidateHealthConsent).not.toHaveBeenCalled();
        expect(localStorage.getItem('logbook:v2:user:' + A + ':health-consent-withdrawal')).toBe('withdrawn');
        expect(unlockVaultForOwner).not.toHaveBeenCalled();
    });

    it('permits explicit withdrawal even after email verification is lost, without granting a backup vault', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-unverified', principal: { ...principal, healthConsentRevision: 1, emailVerified: false },
        });
        vi.mocked(withdrawKindeCandidateHealthConsent).mockImplementationOnce(async () => {
            localStorage.setItem('logbook:v2:user:' + A + ':health-consent-withdrawal', 'withdrawn');
            return { kind: 'withdrawal-recorded', deletionStatus: 'processing' };
        });
        render(<KindeAccountEntry candidateMode="preparation" candidateLifecycleEnabled />);
        expect(await screen.findByRole('button', {
            name: 'Revoca consenso e avvia cancellazione',
        })).toHaveProperty('disabled', true);
        expect(screen.queryByRole('button', { name: 'Prepara backup JSON' })).toBeNull();
        expect(unlockVaultForOwner).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('checkbox', { name: /Confermo di voler revocare/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Revoca consenso e avvia cancellazione' }));
        await waitFor(() => expect(withdrawKindeCandidateHealthConsent).toHaveBeenCalledWith({
            confirmsErasure: true,
            expected: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
            stillCurrent: expect.any(Function),
        }));
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(unlockVaultForOwner).not.toHaveBeenCalled();
    });

    it('permits the rights-only request after email verification is lost, never enabling fitness or vault', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-unverified', principal: { ...principal, healthConsentRevision: 1, emailVerified: false },
        });
        render(<KindeAccountEntry candidateMode="preparation" candidateLifecycleEnabled />);
        fireEvent.click(await screen.findByRole('button', { name: 'Verifica dati cloud ancora disponibili' }));
        await screen.findByRole('link', { name: 'Scarica documenti cloud disponibili' });
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(unlockVaultForOwner).not.toHaveBeenCalled();
        expect(withdrawKindeCandidateHealthConsent).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Revoca consenso e avvia cancellazione' }))
            .toHaveProperty('disabled', true);
    });
});
