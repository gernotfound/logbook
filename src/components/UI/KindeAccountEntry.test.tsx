import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { KindeAccountEntry } from './KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import {
    readKindeCandidateAccess, revokeKindeCandidateSession, submitKindeHostedSignIn,
} from '../../lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';

vi.mock('../../lib/auth/kindeCandidateIdentity', () => ({
    readKindeCandidateIdentity: vi.fn(),
}));
vi.mock('../../lib/auth/kindeCandidateClient', () => ({
    readKindeCandidateAccess: vi.fn(),
    revokeKindeCandidateSession: vi.fn(),
    submitKindeHostedSignIn: vi.fn(),
    KindeCandidateBoundaryError: class extends Error {},
}));
vi.mock('../../lib/auth/kindeCandidateConsent', () => ({
    acceptKindeCandidateInitialConsent: vi.fn(),
}));
vi.mock('../../pages/PrivacyPolicy', () => ({
    PrivacyPolicy: () => <p>Informativa privacy di prova</p>,
}));
vi.mock('../../pages/TermsAndConditions', () => ({
    TermsAndConditions: () => <p>Termini di prova</p>,
}));

const A = 'k_' + 'A'.repeat(43);
const B = 'k_' + 'B'.repeat(43);
const principal = { uid: A, fenceEpoch: 1, healthConsentRevision: 0, emailVerified: true };
const verified = { kind: 'email-verified' as const, principal };
const required = { kind: 'consent-required' as const, principal };
const confirmed = {
    kind: 'consent-confirmed' as const,
    principal: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
};

beforeEach(() => {
    vi.mocked(readKindeCandidateIdentity).mockResolvedValue({ kind: 'signed-out' });
    vi.mocked(readKindeCandidateAccess).mockResolvedValue(required);
    vi.mocked(acceptKindeCandidateInitialConsent).mockResolvedValue(confirmed);
    vi.mocked(revokeKindeCandidateSession).mockResolvedValue();
});
afterEach(() => {
    cleanup();
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
                decision: {
                    confirmsOver18: true, acceptedTerms: true, acceptedHealthData: true,
                },
                stillCurrent: expect.any(Function),
            }),
        ));
        await screen.findByText(/Identità e consenso verificati/);
        expect(submitKindeHostedSignIn).not.toHaveBeenCalled();
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
    });
});
