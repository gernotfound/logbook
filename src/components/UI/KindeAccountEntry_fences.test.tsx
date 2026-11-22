import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { B, REPLACEMENT_CSRF, browserWitness, principal, verified, required, confirmed } from './KindeAccountEntryTestFixture';
import { KindeAccountEntry } from './KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import { readKindeCandidateAccess } from '../../lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';
import { prepareKindeCandidateOwner } from '../../lib/sync/kindeCandidateOwnerBootstrap';

describe('Kinde candidate entry: owner, cookie and consent fences', () => {
    it('never starts vault preparation for public identity-only, missing consent or guest sessions', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        const publicEntry = render(<KindeAccountEntry identityOnly candidateMode="preparation" />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: 'Continua' })).toBeNull();
        publicEntry.unmount();
        const publicFitness = render(<KindeAccountEntry identityOnly candidateMode="fitness" />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: 'Apri archivio account' })).toBeNull();
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        publicFitness.unmount();
        const candidate = render(<KindeAccountEntry candidateMode="fitness" />);
        await screen.findByRole('button', { name: 'Conferma consenso' });
        expect(screen.queryByRole('button', { name: 'Apri archivio account' })).toBeNull();
        candidate.unmount();
        render(<KindeAccountEntry guestArchivePresent candidateMode="preparation" />);
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
        render(<KindeAccountEntry candidateMode="preparation" />);
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
        render(<KindeAccountEntry candidateMode="preparation" />);
        const next = await screen.findByRole('button', { name: 'Continua' });
        fireEvent.click(next);
        await waitFor(() => expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(1));
        browserWitness.csrf = REPLACEMENT_CSRF;
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

        browserWitness.csrf = REPLACEMENT_CSRF;
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
            browserWitness.csrf = REPLACEMENT_CSRF;
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
