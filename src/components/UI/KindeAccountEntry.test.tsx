import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { KindeAccountEntry } from './KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import {
    readKindeCandidateAccess, revokeKindeCandidateSession, submitKindeHostedSignIn,
} from '../../lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';
import { prepareKindeCandidateOwner } from '../../lib/sync/kindeCandidateOwnerBootstrap';
import { unlockVaultForOwner } from '../../lib/sync/secureArchiveSession';
import { isKindeAccountLocalFitnessClear } from '../../lib/sync/kindeOwnerLocalFitnessFence';
import { prepareKindeCandidatePortableBackupJson } from '../../lib/auth/kindeCandidatePortableBackup';
import {
    withdrawKindeCandidateHealthConsent, reconcileKindeCandidateWithdrawal,
} from '../../lib/auth/kindeCandidateWithdrawal';
import { prepareKindeCandidateRightsJson } from '../../lib/auth/kindeCandidateRightsExport';
import { createBackup } from '../../lib/backup';
import { UserDataSchema } from '../../lib/schema';

vi.mock('../../lib/auth/kindeCandidateIdentity', () => ({
    readKindeCandidateIdentity: vi.fn(),
}));
vi.mock(import('../../lib/auth/kindeCandidateClient'), async importOriginal => ({
    ...await importOriginal(),
    readKindeCandidateAccess: vi.fn(),
    revokeKindeCandidateSession: vi.fn(),
    submitKindeHostedSignIn: vi.fn(),
}));
vi.mock('../../lib/auth/kindeCandidateConsent', () => ({
    acceptKindeCandidateInitialConsent: vi.fn(),
}));
vi.mock('../../lib/sync/kindeCandidateOwnerBootstrap', () => ({
    prepareKindeCandidateOwner: vi.fn(),
}));
vi.mock('../../lib/sync/secureArchiveSession', () => ({
    unlockVaultForOwner: vi.fn(),
}));
vi.mock('../../lib/sync/kindeOwnerLocalFitnessFence', () => ({
    isKindeAccountLocalFitnessClear: vi.fn(),
}));
vi.mock('../../lib/auth/kindeCandidatePortableBackup', () => ({
    prepareKindeCandidatePortableBackupJson: vi.fn(),
}));
vi.mock(import('../../lib/auth/kindeCandidateWithdrawal'), async importOriginal => ({
    ...await importOriginal(),
    withdrawKindeCandidateHealthConsent: vi.fn(),
    reconcileKindeCandidateWithdrawal: vi.fn(),
}));
vi.mock('../../lib/auth/kindeCandidateRightsExport', () => ({
    prepareKindeCandidateRightsJson: vi.fn(),
}));
vi.mock('../../pages/PrivacyPolicy', () => ({
    PrivacyPolicy: () => <p>Informativa privacy di prova</p>,
}));
vi.mock('../../pages/TermsAndConditions', () => ({
    TermsAndConditions: () => <p>Termini di prova</p>,
}));

const A = 'k_' + 'A'.repeat(43);
const B = 'k_' + 'B'.repeat(43);
const FIRST_CSRF = 'A'.repeat(43);
const REPLACEMENT_CSRF = 'B'.repeat(42) + 'A';
let browserCsrf: string;
const principal = { uid: A, fenceEpoch: 1, healthConsentRevision: 0, emailVerified: true };
const verified = { kind: 'email-verified' as const, principal };
const required = { kind: 'consent-required' as const, principal };
const confirmed = {
    kind: 'consent-confirmed' as const,
    principal: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
    legalConsent: {
        hasAcceptedTerms: true, hasAcceptedHealthData: true,
        acceptedAt: '2026-11-15T10:00:00.000Z',
        privacyVersion: '1.3.9', termsVersion: '1.2.5',
    },
};

beforeEach(() => {
    localStorage.clear();
    browserCsrf = FIRST_CSRF;
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => '__Host-logbook_csrf=' + browserCsrf);
    vi.mocked(readKindeCandidateIdentity).mockResolvedValue({ kind: 'signed-out' });
    vi.mocked(readKindeCandidateAccess).mockResolvedValue(required);
    vi.mocked(acceptKindeCandidateInitialConsent).mockResolvedValue(confirmed);
    vi.mocked(revokeKindeCandidateSession).mockResolvedValue();
    vi.mocked(prepareKindeCandidateOwner).mockResolvedValue({
        kind: 'candidate-observed', checkpointRevision: 1, replicaOutcome: 'already-active',
        journalOutcome: 'idle', journalDrained: true,
    });
    vi.mocked(isKindeAccountLocalFitnessClear).mockReturnValue(true);
    vi.mocked(unlockVaultForOwner).mockResolvedValue({
        isCurrent: () => true, release: vi.fn(),
    });
    const backup = createBackup(UserDataSchema.parse({ profile: { height: '182' } }),
        'user:' + A, { scope: 'cloud-and-device', months: [] });
    vi.mocked(prepareKindeCandidatePortableBackupJson).mockResolvedValue({
        filename: 'thelogbook_backup_prima_revoca_2026-11-19.json',
        json: JSON.stringify(backup), backup,
    });
    vi.mocked(withdrawKindeCandidateHealthConsent).mockResolvedValue({
        kind: 'withdrawal-recorded', deletionStatus: 'pending',
    });
    vi.mocked(reconcileKindeCandidateWithdrawal).mockResolvedValue({ kind: 'still-unconfirmed' });
    vi.mocked(prepareKindeCandidateRightsJson).mockResolvedValue({
        filename: 'thelogbook_diritti_cloud_2026-11-19.json',
        json: '{"format":"thelogbook-cloud-rights-export"}',
        documentCount: 0, cloudRevision: 1,
    });
    const OriginalURL = URL;
    const objectURL = vi.fn(() => 'blob:kinde-candidate-export');
    const revokeURL = vi.fn();
    vi.stubGlobal('URL', class extends OriginalURL {
        static createObjectURL = objectURL;
        static revokeObjectURL = revokeURL;
    });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('isolated Kinde account entry candidate', () => {
    it('offers only hosted sign-in after a trusted signed-out read', async () => {
        render(<KindeAccountEntry />);
        const start = await screen.findByRole('button', { name: 'Accedi o registrati' });
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        fireEvent.click(start);
        expect(submitKindeHostedSignIn).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/Identità e consenso verificati/)).toBeNull();
    });

    it('a missing backend is an explicit blocked state, never a guest or fitness success', async () => {
        vi.mocked(readKindeCandidateIdentity).mockRejectedValue(new Error('HTTP 503'));
        render(<KindeAccountEntry />);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(submitKindeHostedSignIn).not.toHaveBeenCalled();
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({ kind: 'signed-out' });
        fireEvent.click(screen.getByRole('button', { name: 'Riprova la verifica' }));
        await screen.findByRole('button', { name: 'Accedi o registrati' });
    });

    it('an unverified email cannot start consent or fitness, but can revoke its session', async () => {
        vi.mocked(readKindeCandidateIdentity)
            .mockResolvedValueOnce({ kind: 'email-unverified', principal: { ...principal, emailVerified: false } })
            .mockResolvedValueOnce({ kind: 'signed-out' });
        render(<KindeAccountEntry />);
        await screen.findByText(/Verifica il tuo indirizzo email/);
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Termina sessione TheLogBook' }));
        await waitFor(() => expect(revokeKindeCandidateSession).toHaveBeenCalledTimes(1));
        await screen.findByRole('button', { name: 'Accedi o registrati' });
    });

    it('requires all three separate decisions and only trusts the consent readback helper', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        render(<KindeAccountEntry />);
        const accept = await screen.findByRole('button', { name: 'Conferma consenso' });
        expect(accept.hasAttribute('disabled')).toBe(true);
        const boxes = screen.getAllByRole('checkbox');
        expect(boxes).toHaveLength(3);
        expect(screen.getByText(/Informativa privacy di prova/)).not.toBeNull();
        expect(screen.getByText(/Termini di prova/)).not.toBeNull();
        fireEvent.click(boxes[0]);
        fireEvent.click(boxes[1]);
        expect(accept.hasAttribute('disabled')).toBe(true);
        fireEvent.click(boxes[2]);
        expect(accept.hasAttribute('disabled')).toBe(false);
        fireEvent.click(accept);
        await waitFor(() => expect(acceptKindeCandidateInitialConsent).toHaveBeenCalledWith(
            expect.objectContaining({
                expectedOwner: expect.objectContaining({ uid: A, fenceEpoch: 1 }),
                decision: {
                    confirmsOver18: true, acceptedTerms: true, acceptedHealthData: true,
                },
                stillCurrent: expect.any(Function),
            }),
        ));
        await screen.findByText(/Identità e consenso verificati/);
        expect(submitKindeHostedSignIn).not.toHaveBeenCalled();
    });

    it('connects accepted Kinde consent to an explicit, fenced candidate vault preparation without granting fitness', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        render(<KindeAccountEntry candidatePreparationEnabled />);
        expect(screen.queryByRole('button', { name: 'Continua' })).toBeNull();
        const consent = await screen.findByRole('button', { name: 'Conferma consenso' });
        for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
        fireEvent.click(consent);
        await screen.findByRole('button', { name: 'Continua' });
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Continua' }));
        await waitFor(() => expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(1));
        expect(vi.mocked(prepareKindeCandidateOwner).mock.calls[0][0]).toMatchObject({
            expected: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
            drainPendingJournal: true, retainDeviceVault: false,
        });
        await screen.findByText(/Archivio cifrato verificato nel percorso candidato/);
        expect(screen.getByText(/funzioni fitness restano disabilitate/)).toBeDefined();
    });

    it('requires a verified journal outcome before publishing candidate readiness', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        vi.mocked(prepareKindeCandidateOwner).mockResolvedValueOnce({
            kind: 'candidate-observed', checkpointRevision: 1, replicaOutcome: 'already-active',
        }).mockResolvedValueOnce({
            kind: 'candidate-observed', checkpointRevision: 1,
            replicaOutcome: 'already-active', journalOutcome: 'acknowledged',
            journalDrained: true,
        });
        render(<KindeAccountEntry candidatePreparationEnabled />);
        const continueButton = await screen.findByRole('button', { name: 'Continua' });
        fireEvent.click(continueButton);
        await screen.findByText(/Preparazione non ancora confermata/);
        expect(screen.queryByText(/Archivio cifrato verificato nel percorso candidato/)).toBeNull();
        fireEvent.click(continueButton);
        await screen.findByText(/Archivio cifrato verificato nel percorso candidato/);
        expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(2);
        expect(vi.mocked(prepareKindeCandidateOwner).mock.calls.every(
            ([args]) => args.drainPendingJournal === true && args.retainDeviceVault === false,
        )).toBe(true);
    });

    it('keeps the candidate pending after an acknowledged partial batch', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        vi.mocked(prepareKindeCandidateOwner).mockResolvedValue({
            kind: 'journal-pending', checkpointRevision: 2, replicaOutcome: 'already-active',
            journalOutcome: 'acknowledged', pendingCount: 1,
        });
        render(<KindeAccountEntry candidatePreparationEnabled />);
        fireEvent.click(await screen.findByRole('button', { name: 'Continua' }));
        await screen.findByText(/Preparazione non ancora confermata/);
        expect(screen.queryByText(/Archivio cifrato verificato nel percorso candidato/)).toBeNull();
        expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(1);
    });

    it('does not report journal success when replica ownership is not confirmed', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        vi.mocked(prepareKindeCandidateOwner).mockResolvedValue({
            kind: 'candidate-observed', checkpointRevision: 1,
            replicaOutcome: 'reconciliation-required',
        });
        render(<KindeAccountEntry candidatePreparationEnabled />);
        fireEvent.click(await screen.findByRole('button', { name: 'Continua' }));
        await screen.findByText(/Preparazione non ancora confermata/);
        expect(screen.queryByText(/Archivio cifrato verificato nel percorso candidato/)).toBeNull();
    });

    it('prepares a voluntary Schema 3 download using only an existing vault in the isolated candidate', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        const release = vi.fn();
        vi.mocked(unlockVaultForOwner).mockResolvedValue({
            isCurrent: () => true, release,
        });
        render(<KindeAccountEntry candidatePreparationEnabled />);
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
        render(<KindeAccountEntry candidatePreparationEnabled />);
        fireEvent.click(await screen.findByRole('button', { name: 'Prepara backup JSON' }));
        const download = await screen.findByRole('link', { name: 'Scarica backup JSON' });
        browserCsrf = REPLACEMENT_CSRF;
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
        render(<KindeAccountEntry candidatePreparationEnabled />);
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
        render(<KindeAccountEntry candidatePreparationEnabled candidateLifecycleEnabled />);
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
        const screenA = render(<KindeAccountEntry candidatePreparationEnabled candidateLifecycleEnabled />);
        const checkbox = await screen.findByRole('checkbox', { name: /Confermo di voler revocare/ });
        fireEvent.click(checkbox);
        fireEvent.click(screen.getByRole('button', { name: 'Revoca consenso e avvia cancellazione' }));
        const verify = await screen.findByRole('button', { name: 'Verifica stato della revoca' });
        expect(withdrawKindeCandidateHealthConsent).toHaveBeenCalledTimes(1);
        fireEvent.click(verify);
        await waitFor(() => expect(reconcileKindeCandidateWithdrawal).toHaveBeenCalledTimes(1));
        expect(withdrawKindeCandidateHealthConsent).toHaveBeenCalledTimes(1);
        screenA.unmount();

        render(<KindeAccountEntry candidatePreparationEnabled candidateLifecycleEnabled />);
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
        const publicEntry = render(<KindeAccountEntry identityOnly candidatePreparationEnabled candidateLifecycleEnabled />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: 'Revoca consenso e avvia cancellazione' })).toBeNull();
        publicEntry.unmount();
        localStorage.setItem('logbook:v2:user:' + A + ':health-consent-withdrawal', 'unexpected');
        render(<KindeAccountEntry candidatePreparationEnabled candidateLifecycleEnabled />);
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
        render(<KindeAccountEntry candidatePreparationEnabled candidateLifecycleEnabled />);
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
        browserCsrf = REPLACEMENT_CSRF;
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
        render(<KindeAccountEntry candidatePreparationEnabled candidateLifecycleEnabled />);
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
        render(<KindeAccountEntry candidatePreparationEnabled candidateLifecycleEnabled />);
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
        render(<KindeAccountEntry candidatePreparationEnabled candidateLifecycleEnabled />);
        fireEvent.click(await screen.findByRole('button', { name: 'Verifica dati cloud ancora disponibili' }));
        await screen.findByRole('link', { name: 'Scarica documenti cloud disponibili' });
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(unlockVaultForOwner).not.toHaveBeenCalled();
        expect(withdrawKindeCandidateHealthConsent).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Revoca consenso e avvia cancellazione' }))
            .toHaveProperty('disabled', true);
    });

    it('never starts vault preparation for public identity-only, missing consent or guest sessions', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        const publicEntry = render(<KindeAccountEntry identityOnly candidatePreparationEnabled />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: 'Continua' })).toBeNull();
        publicEntry.unmount();
        const candidate = render(<KindeAccountEntry />);
        await screen.findByRole('button', { name: 'Conferma consenso' });
        expect(screen.queryByRole('button', { name: 'Continua' })).toBeNull();
        candidate.unmount();
        render(<KindeAccountEntry guestArchivePresent candidatePreparationEnabled />);
        await screen.findByText(/archivio ospite/);
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
    });

    it('reports pending or failed candidate setup without a false ready or fitness grant', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified',
            principal: { ...principal, healthConsentRevision: 1 },
        });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        vi.mocked(prepareKindeCandidateOwner).mockResolvedValueOnce({
            kind: 'delivery-pending', deliveryOutcome: 'reconciliation-required',
        }).mockRejectedValueOnce(new Error('D1 unavailable'));
        render(<KindeAccountEntry candidatePreparationEnabled />);
        const continueButton = await screen.findByRole('button', { name: 'Continua' });
        fireEvent.click(continueButton);
        await screen.findByText(/Preparazione non ancora confermata/);
        expect(screen.queryByText(/Archivio cifrato verificato nel percorso candidato/)).toBeNull();
        fireEvent.click(continueButton);
        await screen.findByRole('alert');
        expect(screen.queryByText(/Archivio cifrato verificato nel percorso candidato/)).toBeNull();
        expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(2);
    });

    it('discards a pending candidate vault result when the browser session changes', async () => {
        vi.mocked(readKindeCandidateIdentity)
            .mockResolvedValueOnce({ kind: 'email-verified',
                principal: { ...principal, healthConsentRevision: 1 } })
            .mockResolvedValue({ kind: 'signed-out' });
        vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
        let finish!: (value: {
            kind: 'candidate-observed'; checkpointRevision: number;
            replicaOutcome: 'already-active';
        }) => void;
        vi.mocked(prepareKindeCandidateOwner).mockImplementationOnce(() =>
            new Promise(resolve => { finish = resolve; }));
        render(<KindeAccountEntry candidatePreparationEnabled />);
        const next = await screen.findByRole('button', { name: 'Continua' });
        fireEvent.click(next);
        await waitFor(() => expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(1));
        browserCsrf = REPLACEMENT_CSRF;
        // The in-flight action suppresses a foreground refresh, but its own
        // pinned cookie check must reject the late result before any success.
        await act(async () => {
            finish({ kind: 'candidate-observed', checkpointRevision: 1,
                replicaOutcome: 'already-active' });
        });
        await screen.findByRole('alert');
        expect(screen.queryByText(/Archivio cifrato verificato nel percorso candidato/)).toBeNull();
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        await screen.findByRole('button', { name: 'Accedi o registrati' });
    });

    it('discards consent checked before a replacement cookie even for the same account', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        render(<KindeAccountEntry />);
        const accept = await screen.findByRole('button', { name: 'Conferma consenso' });
        for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);

        browserCsrf = REPLACEMENT_CSRF;
        fireEvent.click(accept);
        const retry = await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();

        fireEvent.click(retry);
        expect(await screen.findByRole('button', { name: 'Conferma consenso' })).toHaveProperty('disabled', true);
        for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toHaveProperty('checked', false);
    });

    it('rejects a cookie change between the identity and consent readbacks', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        vi.mocked(readKindeCandidateAccess).mockImplementationOnce(async () => {
            browserCsrf = REPLACEMENT_CSRF;
            return required;
        });
        render(<KindeAccountEntry />);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(screen.queryByRole('button', { name: 'Conferma consenso' })).toBeNull();
    });

    it('a contradictory identity/consent owner blocks the UI without publishing fitness', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        vi.mocked(readKindeCandidateAccess).mockResolvedValue({
            ...required, principal: { ...required.principal, uid: B },
        });
        render(<KindeAccountEntry />);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(screen.queryByRole('button', { name: 'Conferma consenso' })).toBeNull();
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();
    });

    it('preserves guest archives: no Kinde network or login while a guest is active', async () => {
        render(<KindeAccountEntry guestArchivePresent />);
        await screen.findByText(/archivio ospite/);
        expect(readKindeCandidateIdentity).not.toHaveBeenCalled();
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Accedi o registrati' })).toBeNull();
    });

    it('an ambiguous consent POST never unlocks the fitness UI', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        vi.mocked(acceptKindeCandidateInitialConsent).mockRejectedValue(new Error('unconfirmed'));
        render(<KindeAccountEntry />);
        const accept = await screen.findByRole('button', { name: 'Conferma consenso' });
        for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
        fireEvent.click(accept);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(screen.queryByText(/Identità e consenso verificati/)).toBeNull();
    });

    it('suspended consent and an old legal version do not expose the initial consent form', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        for (const access of [
            { kind: 'consent-suspended' as const, principal, status: 'withdrawn' as const },
            { kind: 'legal-update-required' as const, principal },
        ]) {
            vi.mocked(readKindeCandidateAccess).mockResolvedValue(access);
            const rendered = render(<KindeAccountEntry />);
            await screen.findByRole('button', { name: 'Termina sessione TheLogBook' });
            expect(screen.queryByRole('button', { name: 'Conferma consenso' })).toBeNull();
            rendered.unmount();
        }
    });
});

describe('public Kinde identity-only entry boundary', () => {
    it('revalidates a changed session cookie while the tab stays visible', async () => {
        vi.useFakeTimers();
        try {
            vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
                .mockResolvedValue({ kind: 'signed-out' });
            await act(async () => { render(<KindeAccountEntry identityOnly />); });
            expect(screen.getByText(/Sessione Kinde verificata/)).toBeDefined();
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(1);
            browserCsrf = REPLACEMENT_CSRF;
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            expect(screen.getByRole('button', { name: 'Accedi o registrati' })).toBeDefined();
            expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2);
            expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });

    it('rejects a guest action from the previous signed-out browser session', async () => {
        const onLocalGuest = vi.fn(async () => {});
        render(<KindeAccountEntry identityOnly onLocalGuest={onLocalGuest} />);
        const guest = await screen.findByRole('button', { name: /Continua senza account/ });
        browserCsrf = REPLACEMENT_CSRF;
        fireEvent.click(guest);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(onLocalGuest).not.toHaveBeenCalled();
    });

    it('does not let an old logout button revoke a replacement session', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        render(<KindeAccountEntry identityOnly />);
        const logout = await screen.findByRole('button', { name: 'Termina sessione TheLogBook' });
        browserCsrf = REPLACEMENT_CSRF;
        fireEvent.click(logout);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(revokeKindeCandidateSession).not.toHaveBeenCalled();
    });

    it('does not let an immediate foreground event supersede a pending logout operation', async () => {
        let finishLogout!: () => void;
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockResolvedValue({ kind: 'signed-out' });
        vi.mocked(revokeKindeCandidateSession).mockImplementationOnce(async () => {
            // This is synchronous with the click, before React commits busy=true.
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('online'));
            await new Promise<void>(resolve => { finishLogout = resolve; });
        });
        render(<KindeAccountEntry identityOnly />);
        await screen.findByText(/Sessione Kinde verificata/);
        fireEvent.click(screen.getByRole('button', { name: 'Termina sessione TheLogBook' }));
        await waitFor(() => expect(revokeKindeCandidateSession).toHaveBeenCalledTimes(1));
        await act(async () => { await Promise.resolve(); });
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(1);
        await act(async () => { finishLogout(); });
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2);
    });

    it('preserves a pending consent operation against a same-turn focus event', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        vi.mocked(acceptKindeCandidateInitialConsent).mockImplementationOnce(async () => {
            window.dispatchEvent(new Event('focus'));
            return confirmed;
        });
        render(<KindeAccountEntry />);
        const accept = await screen.findByRole('button', { name: 'Conferma consenso' });
        for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
        fireEvent.click(accept);
        await screen.findByText(/Identità e consenso verificati/);
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(1);
        expect(acceptKindeCandidateInitialConsent).toHaveBeenCalledTimes(1);
    });

    it('keeps a local guest activation fenced from a foreground probe during the action', async () => {
        const onLocalGuest = vi.fn(async () => {
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('online'));
        });
        render(<KindeAccountEntry identityOnly onLocalGuest={onLocalGuest} />);
        const guest = await screen.findByRole('button', { name: /Continua senza account/ });
        fireEvent.click(guest);
        await waitFor(() => expect(onLocalGuest).toHaveBeenCalledTimes(1));
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(1);
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
    });

    it('refreshes a stale verified identity on foreground, without enabling consent or fitness', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockResolvedValue({ kind: 'signed-out' });
        render(<KindeAccountEntry identityOnly />);
        await screen.findByText(/Sessione Kinde verificata/);
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2);
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();
    });

    it('fences a slow old identity response when the session changes again on reconnect', async () => {
        let releaseOld!: (value: typeof verified) => void;
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }))
            .mockResolvedValue({ kind: 'signed-out' });
        render(<KindeAccountEntry identityOnly />);
        await screen.findByText(/Sessione Kinde verificata/);
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        await waitFor(() => expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2));
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        await act(async () => { releaseOld(verified); });
        expect(screen.queryByText(/Sessione Kinde verificata/)).toBeNull();
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(3);
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
    });

    it('coalesces focus and visibility events, and never probes a blocked guest archive', async () => {
        const view = render(<KindeAccountEntry identityOnly />);
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await waitFor(() => expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2));
        view.unmount();
        vi.mocked(readKindeCandidateIdentity).mockClear();
        render(<KindeAccountEntry identityOnly guestArchivePresent />);
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('online'));
        });
        expect(readKindeCandidateIdentity).not.toHaveBeenCalled();
    });

    it('fails closed after a foreground network error and still permits explicit hosted retry', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockRejectedValueOnce(new Error('offline'));
        render(<KindeAccountEntry identityOnly />);
        await screen.findByText(/Sessione Kinde verificata/);
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await screen.findByRole('button', { name: 'Avvia un nuovo accesso con Kinde' });
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();
    });

    it('reads only the trusted session, never calls consent, cloud key or Firebase login', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        render(<KindeAccountEntry identityOnly />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Conferma consenso' })).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.getByRole('button', { name: 'Termina sessione TheLogBook' })).toBeTruthy();
    });

    it('allows explicit local guest only when the identity read proves signed-out', async () => {
        const onLocalGuest = vi.fn(async () => {});
        render(<KindeAccountEntry identityOnly onLocalGuest={onLocalGuest} />);
        const guest = await screen.findByRole('button', { name: /Continua senza account/ });
        fireEvent.click(guest);
        await waitFor(() => expect(onLocalGuest).toHaveBeenCalledTimes(1));
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();
        expect(submitKindeHostedSignIn).not.toHaveBeenCalled();
    });

    it('cannot enter guest mode from a verified Kinde session', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        const onLocalGuest = vi.fn(async () => {});
        render(<KindeAccountEntry identityOnly onLocalGuest={onLocalGuest} />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: /Continua senza account/ })).toBeNull();
        expect(onLocalGuest).not.toHaveBeenCalled();
    });

    it('allows isolated local guest when Kinde is unavailable, without any account or consent permission', async () => {
        vi.spyOn(document, 'cookie', 'get').mockReturnValue('');
        vi.mocked(readKindeCandidateIdentity).mockRejectedValue(new Error('503'));
        const onLocalGuest = vi.fn(async () => {});
        render(<KindeAccountEntry identityOnly onLocalGuest={onLocalGuest} />);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        const guest = screen.getByRole('button', { name: /Continua senza account/ });
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();
        fireEvent.click(guest);
        await waitFor(() => expect(onLocalGuest).toHaveBeenCalledTimes(1));
        expect(submitKindeHostedSignIn).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Avvia un nuovo accesso con Kinde' }));
        expect(submitKindeHostedSignIn).toHaveBeenCalledTimes(1);
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(acceptKindeCandidateInitialConsent).not.toHaveBeenCalled();
    });

    it('does not offer guest mode if an unavailable identity check still has a session witness', async () => {
        vi.mocked(readKindeCandidateIdentity).mockRejectedValue(new Error('503'));
        render(<KindeAccountEntry identityOnly onLocalGuest={vi.fn()} />);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(screen.queryByRole('button', { name: /Continua senza account/ })).toBeNull();
    });

    it('never offers a guest transition from an unverified Kinde identity', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-unverified', principal: { ...principal, emailVerified: false },
        });
        const onLocalGuest = vi.fn(async () => {});
        render(<KindeAccountEntry identityOnly onLocalGuest={onLocalGuest} />);
        await screen.findByText(/Verifica il tuo indirizzo email/);
        expect(screen.queryByRole('button', { name: /Continua senza account/ })).toBeNull();
        expect(onLocalGuest).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Avvia un nuovo accesso con Kinde' })).toBeNull();
    });
});
