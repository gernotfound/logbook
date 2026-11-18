import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { KindeAccountEntry } from './KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import {
    readKindeCandidateAccess, revokeKindeCandidateSession, submitKindeHostedSignIn,
} from '../../lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';

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
};

beforeEach(() => {
    browserCsrf = FIRST_CSRF;
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => '__Host-logbook_csrf=' + browserCsrf);
    vi.mocked(readKindeCandidateIdentity).mockResolvedValue({ kind: 'signed-out' });
    vi.mocked(readKindeCandidateAccess).mockResolvedValue(required);
    vi.mocked(acceptKindeCandidateInitialConsent).mockResolvedValue(confirmed);
    vi.mocked(revokeKindeCandidateSession).mockResolvedValue();
});
afterEach(() => {
    cleanup();
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
