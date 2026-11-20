import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { REPLACEMENT_CSRF, browserWitness, principal, verified, confirmed } from './KindeAccountEntryTestFixture';
import { KindeAccountEntry } from './KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import { readKindeCandidateAccess, revokeKindeCandidateSession, submitKindeHostedSignIn } from '../../lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';

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
            browserWitness.csrf = REPLACEMENT_CSRF;
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
        browserWitness.csrf = REPLACEMENT_CSRF;
        fireEvent.click(guest);
        await screen.findByRole('button', { name: 'Riprova la verifica' });
        expect(onLocalGuest).not.toHaveBeenCalled();
    });

    it('does not let an old logout button revoke a replacement session', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        render(<KindeAccountEntry identityOnly />);
        const logout = await screen.findByRole('button', { name: 'Termina sessione TheLogBook' });
        browserWitness.csrf = REPLACEMENT_CSRF;
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
