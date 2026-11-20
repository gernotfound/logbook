import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { A, principal, verified, required, confirmed } from './KindeAccountEntryTestFixture';
import { KindeAccountEntry } from './KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import { readKindeCandidateAccess, revokeKindeCandidateSession, submitKindeHostedSignIn } from '../../lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';
import { prepareKindeCandidateOwner } from '../../lib/sync/kindeCandidateOwnerBootstrap';

describe('Kinde candidate entry: identity and verified consent', () => {
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
});
