import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { KindeSessionContext } from './kinde_session_runtime_boundary.test';

export function registerKindeSessionEntryCases(ctx: KindeSessionContext): void {
    const { verified, host, Observer, readKindeCandidateIdentity, readKindeCandidateAccess, revokeKindeCandidateSession, submitKindeHostedSignIn, authenticatedIdentitySource, usePWAInstall, KindeAccountEntry, activateGuestSession, GUEST_SESSION_KEY } = ctx;

    it('offers a deferred PWA install gesture on the signed-out entry without granting fitness', async () => {
        const promptInstall = vi.fn(async () => {});
        vi.mocked(usePWAInstall).mockReturnValue({
            isInstallable: true, isIOSInstallable: false, isStandalone: false, promptInstall,
        });
        render(<KindeAccountEntry identityOnly />, { wrapper: host });
        fireEvent.click(await screen.findByRole('button', { name: 'Installa TheLogBook' }));
        expect(promptInstall).toHaveBeenCalledTimes(1);
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(1);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });
     it('shows the iOS installation instruction without a fake browser prompt', async () => {
        vi.mocked(usePWAInstall).mockReturnValue({
            isInstallable: false, isIOSInstallable: true, isStandalone: false,
            promptInstall: vi.fn(async () => {}),
        });
        render(<KindeAccountEntry identityOnly />, { wrapper: host });
        expect(await screen.findByText(/Aggiungi alla schermata Home/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Installa TheLogBook' })).toBeNull();
    });
     it('reuses one live session observation between the runtime and the account entry', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        render(<><Observer /><KindeAccountEntry identityOnly /></>, { wrapper: host });
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('identity-verified|fitness-blocked|not-guest');
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(1);
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
        expect(submitKindeHostedSignIn).not.toHaveBeenCalled();
    });
     it('invalidates the shared identity on a replacement cookie without installing an account owner', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockResolvedValue({ kind: 'signed-out' });
        render(<><Observer /><KindeAccountEntry identityOnly /></>, { wrapper: host });
        await screen.findByText(/Sessione Kinde verificata/);
        ctx.setCsrf('B'.repeat(42) + 'A');
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('signed-out|fitness-blocked|not-guest');
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });
     it('keeps the guest archive local and performs no Kinde request while the guest is active', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-runtime-session');
        activateGuestSession('guest-runtime-session');
        render(<Observer />, { wrapper: host });
        await waitFor(() => expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('guest-blocked|fitness-blocked|local-guest'));
        expect(readKindeCandidateIdentity).not.toHaveBeenCalled();
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });
     it('uses one session revocation and then publishes only signed-out, never a fitness user', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockResolvedValue({ kind: 'signed-out' });
        render(<><Observer /><KindeAccountEntry identityOnly /></>, { wrapper: host });
        await screen.findByText(/Sessione Kinde verificata/);
        fireEvent.click(screen.getByRole('button', { name: 'Termina sessione TheLogBook' }));
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        expect(revokeKindeCandidateSession).toHaveBeenCalledTimes(1);
        expect(revokeKindeCandidateSession).toHaveBeenCalledWith(expect.objectContaining({
            expectedCsrfToken: 'A'.repeat(43),
            stillCurrent: expect.any(Function),
        }));
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('signed-out|fitness-blocked|not-guest');
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });
     it('blocks a second logout while the Kinde session revocation is still pending', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockResolvedValue({ kind: 'signed-out' });
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(revokeKindeCandidateSession).mockImplementationOnce(async () => {
            await pending;
        });
        render(<><Observer /><KindeAccountEntry identityOnly /></>, { wrapper: host });
        await screen.findByText(/Sessione Kinde verificata/);
        const button = screen.getByRole('button', { name: 'Termina sessione TheLogBook' });
        fireEvent.click(button);
        try {
            await waitFor(() => expect(revokeKindeCandidateSession).toHaveBeenCalledTimes(1));
            expect(button).toBeDisabled();
            fireEvent.click(button);
            expect(revokeKindeCandidateSession).toHaveBeenCalledTimes(1);
            expect(screen.getByTestId('kinde-presence').textContent)
                .toBe('identity-verified|fitness-blocked|not-guest');
        } finally {
            release();
        }
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        expect(revokeKindeCandidateSession).toHaveBeenCalledTimes(1);
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2);
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
        expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('signed-out|fitness-blocked|not-guest');
    });
}
