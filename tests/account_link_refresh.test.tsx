import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, firebaseApp, reload, linkWithPopup, linkWithRedirect } from '../src/lib/firebase';
import { reauthenticateForSensitiveAction } from '../src/lib/auth/recentAuth';
import { validatePasswordAgainstPolicy } from '../src/lib/auth/passwordPolicy';
import { invalidateSession } from '../src/lib/sync/session';
import { safeHardReload } from '../src/lib/sync/safeReload';

const fixture = vi.hoisted(() => ({
    user: {
        uid: 'linked-user', email: 'linked@example.test',
        providerData: [{ providerId: 'google.com' }],
        getIdToken: vi.fn(async () => 'synthetic-token'),
    },
    showAlert: vi.fn(async () => {}),
}));
vi.mock('../src/hooks/useAuth', () => ({
    useAuth: () => ({ currentUser: fixture.user, isGuest: false, emailVerificationRequired: false }),
}));
vi.mock('../src/hooks/useSettings', () => ({
    useSettings: () => ({ handleLogout: vi.fn(), handleLogoutEverywhere: vi.fn() }),
}));
vi.mock('../src/store/useDialogStore', () => ({
    useDialogStore: () => ({ showAlert: fixture.showAlert }),
}));
vi.mock('../src/lib/auth/recentAuth', async importOriginal => ({
    ...await importOriginal<typeof import('../src/lib/auth/recentAuth')>(),
    reauthenticateForSensitiveAction: vi.fn(async () => 'reauthenticated'),
}));
vi.mock('../src/lib/auth/passwordPolicy', () => ({
    validatePasswordAgainstPolicy: vi.fn(async () => null),
}));
vi.mock('../src/lib/sync/safeReload', () => ({ safeHardReload: vi.fn(async () => {}) }));
import { AccountCard } from '../src/components/UI/AccountCard';

beforeEach(() => {
    vi.clearAllMocks();
    (auth as { currentUser: unknown }).currentUser = fixture.user;
    invalidateSession();
    (firebaseApp as any).options = { apiKey: 'synthetic-api-key' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ localId: fixture.user.uid }), { status: 200 }),
    ));
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('confirmed credential link with a failed local refresh', () => {
    it('closes the link form and prevents resubmission even when both refresh and safe navigation fail', async () => {
        vi.mocked(reload).mockRejectedValueOnce(new Error('PRIVATE_REFRESH_FAILURE'));
        vi.mocked(safeHardReload).mockRejectedValueOnce(new Error('draft barrier blocked'));
        render(<AccountCard />);
        fireEvent.click(screen.getByRole('button', { name: 'Crea Password per accedere con Email' }));
        fireEvent.change(screen.getByPlaceholderText('Nuova Password'), { target: { value: 'SecurePassword123!' } });
        fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));

        await waitFor(() => expect(safeHardReload).toHaveBeenCalledOnce());
        await waitFor(() => expect(screen.queryByPlaceholderText('Nuova Password')).toBeNull());
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledExactlyOnceWith(fixture.user);
        expect(screen.queryByRole('button', { name: 'Crea Password per accedere con Email' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Cambia Password' })).toBeTruthy();
        expect(fixture.showAlert).toHaveBeenCalledWith(expect.stringContaining('il collegamento è già completato'));
        expect(JSON.stringify(fixture.showAlert.mock.calls)).not.toContain('PRIVATE_REFRESH_FAILURE');

        fireEvent.click(screen.getByRole('button', { name: 'Cambia Password' }));
        expect(screen.getByPlaceholderText('Password Attuale')).toBeTruthy();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('credential actions keep the initiating session (SDK and policy transports simulated)', () => {
    const beginLink = () => {
        render(<AccountCard />);
        fireEvent.click(screen.getByRole('button', { name: 'Crea Password per accedere con Email' }));
        fireEvent.change(screen.getByPlaceholderText('Nuova Password'), { target: { value: 'SecurePassword123!' } });
        const submit = screen.getByRole('button', { name: 'Conferma' });
        fireEvent.click(submit);
        return submit;
    };
    const replaceSession = () => {
        (auth as { currentUser: unknown }).currentUser = { uid: 'another-user' };
        invalidateSession();
        (auth as { currentUser: unknown }).currentUser = fixture.user;
        invalidateSession();
    };

    it.each(['reauth', 'policy', 'token'] as const)(
        'does not submit credentials after A-B-A during %s', async boundary => {
            let finish!: () => void;
            const gate = new Promise<void>(resolve => { finish = resolve; });
            if (boundary === 'reauth') vi.mocked(reauthenticateForSensitiveAction).mockImplementationOnce(async () => { await gate; return 'reauthenticated'; });
            if (boundary === 'policy') vi.mocked(validatePasswordAgainstPolicy).mockImplementationOnce(async () => { await gate; return null; });
            if (boundary === 'token') fixture.user.getIdToken.mockImplementationOnce(async () => { await gate; return 'old-token'; });
            const submit = beginLink();
            await waitFor(() => expect(boundary === 'reauth' ? reauthenticateForSensitiveAction
                : boundary === 'policy' ? validatePasswordAgainstPolicy : fixture.user.getIdToken).toHaveBeenCalledOnce());
            replaceSession();
            await act(async () => { finish(); });
            await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
            expect(fetch).not.toHaveBeenCalled();
            expect(reload).not.toHaveBeenCalled();
            expect(safeHardReload).not.toHaveBeenCalled();
            expect(fixture.showAlert).not.toHaveBeenCalled();
        },
    );

    it('does not expose an old confirmed link or reload the new session', async () => {
        let finish!: (response: Response) => void;
        vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
        const submit = beginLink();
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        replaceSession();
        await act(async () => { finish(Response.json({ localId: fixture.user.uid })); });
        await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
        expect(reload).not.toHaveBeenCalled();
        expect(safeHardReload).not.toHaveBeenCalled();
        expect(fixture.showAlert).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Crea Password per accedere con Email' })).toBeTruthy();
    });

    it('does not start a Google redirect after a stale popup failure', async () => {
        fixture.user.providerData = [{ providerId: 'password' }];
        let fail!: (error: unknown) => void;
        vi.mocked(linkWithPopup).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
        try {
            render(<AccountCard />);
            const button = screen.getByRole('button', { name: 'Collega Account Google' });
            fireEvent.click(button);
            expect(linkWithPopup).toHaveBeenCalledOnce();
            replaceSession();
            await act(async () => { fail(Object.assign(new Error('popup unavailable'), { code: 'auth/popup-blocked' })); });
            await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
            expect(linkWithRedirect).not.toHaveBeenCalled();
            expect(fixture.showAlert).not.toHaveBeenCalled();
            expect(safeHardReload).not.toHaveBeenCalled();
        } finally { fixture.user.providerData = [{ providerId: 'google.com' }]; }
    });
});
