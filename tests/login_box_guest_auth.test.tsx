import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
    login: vi.fn(async () => {}),
    loginWithEmail: vi.fn(async () => {}),
    registerWithEmail: vi.fn(async () => {}),
    loginAsGuest: vi.fn(async () => {}),
    linkGoogleAccount: vi.fn(async () => {}),
    showAlert: vi.fn(async (_message: string) => {}),
}));

const authState = vi.hoisted(() => ({
    isGuest: true,
}));

vi.mock('../src/hooks/useAuth', () => ({
    useAuth: () => ({
        login: authMocks.login,
        loginWithEmail: authMocks.loginWithEmail,
        registerWithEmail: authMocks.registerWithEmail,
        loginAsGuest: authMocks.loginAsGuest,
        linkGoogleAccount: authMocks.linkGoogleAccount,
        isGuest: authState.isGuest,
    }),
}));

vi.mock('../src/lib/firebase', () => ({
    auth: {},
    sendPasswordResetEmail: vi.fn(async () => {}),
    validatePassword: vi.fn(async (_auth: unknown, password: string) => ({
        isValid: password.length > 0 && password !== 'caccapuou',
        containsNumericCharacter: password.length > 0 && password !== 'caccapuou',
        passwordPolicy: {
            customStrengthOptions: {
                minPasswordLength: 8,
                containsLowercaseLetter: true,
                containsUppercaseLetter: true,
                containsNumericCharacter: true,
                containsNonAlphanumericCharacter: true,
            },
        },
    })),
}));

vi.mock('../src/store/useDialogStore', () => ({
    useDialogStore: () => ({ showAlert: authMocks.showAlert }),
}));

import { LoginBox } from '../src/components/UI/LoginBox';
import { sendPasswordResetEmail, validatePassword } from '../src/lib/firebase';
import { useAppStore } from '../src/store/useAppStore';

describe('LoginBox guest Google authentication', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.getState().setSaveError(null);
        vi.mocked(validatePassword).mockResolvedValue({
            isValid: true,
            passwordPolicy: { customStrengthOptions: { minPasswordLength: 8, containsLowercaseLetter: true, containsUppercaseLetter: true, containsNumericCharacter: true, containsNonAlphanumericCharacter: true } },
        } as any);
        authState.isGuest = true;
        authMocks.login.mockClear();
        authMocks.loginWithEmail.mockClear();
        authMocks.registerWithEmail.mockClear();
        authMocks.loginAsGuest.mockClear();
        authMocks.linkGoogleAccount.mockClear();
        authMocks.showAlert.mockClear();
        vi.mocked(sendPasswordResetEmail).mockReset();
        vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined);
    });

    it('keeps the local-data explanation inside the guest action and preserves its behavior', async () => {
        authState.isGuest = false;
        render(<LoginBox />);
        const action = screen.getByRole('button', { name: /Continua senza account\s+I dati saranno salvati solo sul dispositivo\./i });
        const explanation = screen.getByText('I dati saranno salvati solo sul dispositivo.');
        expect(action.contains(explanation)).toBe(true);
        expect(action.hasAttribute('aria-label')).toBe(false);
        expect(action.hasAttribute('aria-describedby')).toBe(false);
        fireEvent.click(action);
        await waitFor(() => expect(authMocks.loginAsGuest).toHaveBeenCalledTimes(1));
    });

    it('submits the normal email/password login through the production LoginBox form', async () => {
        authState.isGuest = false;
        render(<LoginBox />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
            target: { value: 'existing@example.com' },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ExistingPassword1!' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Accedi' }).at(-1)!);

        await waitFor(() => expect(authMocks.loginWithEmail).toHaveBeenCalledExactlyOnceWith(
            'existing@example.com', 'ExistingPassword1!', undefined,
        ));
        expect(authMocks.login).not.toHaveBeenCalled();
        expect(authMocks.registerWithEmail).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each([
        ['merge', false],
        ['skip', true],
    ] as const)('preserves the %s guest migration decision for email sign-in', async (policy, chooseSkip) => {
        authState.isGuest = true;
        render(<LoginBox onCancel={() => {}} />);
        if (chooseSkip) fireEvent.click(screen.getByLabelText('Non trasferire i progressi'));
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
            target: { value: 'guest-to-account@example.com' },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ExistingPassword1!' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Accedi' }).at(-1)!);

        await waitFor(() => expect(authMocks.loginWithEmail).toHaveBeenCalledExactlyOnceWith(
            'guest-to-account@example.com', 'ExistingPassword1!', policy,
        ));
        expect(authMocks.loginAsGuest).not.toHaveBeenCalled();
        expect(authMocks.linkGoogleAccount).not.toHaveBeenCalled();
    });

    it('blocks duplicate email form submissions while Auth is unresolved', async () => {
        authState.isGuest = false;
        let finish!: () => void;
        authMocks.loginWithEmail.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        render(<LoginBox />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
            target: { value: 'existing@example.com' },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ExistingPassword1!' } });
        const submit = screen.getAllByRole('button', { name: 'Accedi' }).at(-1)!;
        fireEvent.click(submit);
        await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(true));
        expect(authMocks.loginWithEmail).toHaveBeenCalledTimes(1);
        fireEvent.click(submit);
        expect(authMocks.loginWithEmail).toHaveBeenCalledTimes(1);
        finish();
        await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
    });

    it('does not start Google or guest sign-in while an email login is pending', async () => {
        authState.isGuest = false;
        let finish!: () => void;
        authMocks.loginWithEmail.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        render(<LoginBox />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'existing@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ExistingPassword1!' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Accedi' }).at(-1)!);

        const google = screen.getByRole('button', { name: 'Accedi con Google' }) as HTMLButtonElement;
        const guest = screen.getByRole('button', { name: /Continua senza account/i }) as HTMLButtonElement;
        expect(google.disabled).toBe(true);
        expect(guest.disabled).toBe(true);
        fireEvent.click(google);
        fireEvent.click(guest);
        expect(authMocks.login).not.toHaveBeenCalled();
        expect(authMocks.loginAsGuest).not.toHaveBeenCalled();

        finish();
        await waitFor(() => expect(google.disabled).toBe(false));
        fireEvent.click(google);
        await waitFor(() => expect(authMocks.login).toHaveBeenCalledTimes(1));
    });

    it('freezes guest transfer choice and credentials while Google account linking is pending', async () => {
        authState.isGuest = true;
        let finish!: () => void;
        authMocks.linkGoogleAccount.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        render(<LoginBox onCancel={() => {}} />);

        fireEvent.click(screen.getByLabelText('Non trasferire i progressi'));
        const merge = screen.getByLabelText('Trasferisci i progressi nell\'account') as HTMLInputElement;
        const skip = screen.getByLabelText('Non trasferire i progressi') as HTMLInputElement;
        const email = screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement;
        const password = screen.getByLabelText('Password') as HTMLInputElement;
        const reveal = screen.getByRole('button', { name: 'Mostra password' }) as HTMLButtonElement;
        expect(skip.checked).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Accedi con Google' }));
        expect(authMocks.linkGoogleAccount).toHaveBeenCalledExactlyOnceWith('skip');
        expect(merge.disabled).toBe(true);
        expect(skip.disabled).toBe(true);
        expect(email.disabled).toBe(true);
        expect(password.disabled).toBe(true);
        expect(reveal.disabled).toBe(true);

        finish();
        await waitFor(() => expect(skip.disabled).toBe(false));
        expect(email.disabled).toBe(false);
        expect(password.disabled).toBe(false);
    });

    it('does not start email sign-in while a Google login is pending', async () => {
        authState.isGuest = false;
        let finish!: () => void;
        authMocks.login.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        render(<LoginBox />);
        const google = screen.getByRole('button', { name: 'Accedi con Google' }) as HTMLButtonElement;
        fireEvent.click(google);
        const form = screen.getByRole('textbox', { name: 'Email' }).closest('form')!;
        const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        expect(submit.disabled).toBe(true);
        fireEvent.submit(form);
        expect(authMocks.loginWithEmail).not.toHaveBeenCalled();

        finish();
        await waitFor(() => expect(submit.disabled).toBe(false));
    });

    it('sanitizes email sign-in failure without exposing Firebase provider details', async () => {
        authState.isGuest = false;
        authMocks.loginWithEmail.mockRejectedValueOnce(
            Object.assign(new Error('PRIVATE_AUTH_PROVIDER_DETAILS'), { code: 'auth/wrong-password' }),
        );
        render(<LoginBox />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
            target: { value: 'existing@example.com' },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'WrongPassword1!' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Accedi' }).at(-1)!);

        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Email o password errati.'));
        expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_AUTH_PROVIDER_DETAILS');
        expect(authMocks.loginWithEmail).toHaveBeenCalledTimes(1);
    });

    it('masks credentials again when switching between login, registration and recovery', () => {
        authState.isGuest = false;
        render(<LoginBox />);
        const password = screen.getByLabelText('Password') as HTMLInputElement;
        const reveal = () => fireEvent.click(screen.getByRole('button', { name: 'Mostra password' }));

        reveal();
        expect(password.type).toBe('text');
        fireEvent.click(screen.getByRole('button', { name: 'Registrati', pressed: false }));
        expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
        expect((screen.getByLabelText('Conferma password') as HTMLInputElement).type).toBe('password');

        reveal();
        expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
        fireEvent.click(screen.getByRole('button', { name: 'Accedi', pressed: false }));
        expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');

        reveal();
        fireEvent.click(screen.getByRole('button', { name: 'Hai dimenticato la password?' }));
        fireEvent.click(screen.getByRole('button', { name: "Torna all'accesso" }));
        expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
    });

    it('identifies the email input as the username for autofill and password managers', () => {
        render(<LoginBox />);
        const emailField = screen.getByRole('textbox', { name: 'Email' });
        expect(emailField.getAttribute('name')).toBe('username');
        expect(emailField.getAttribute('autocomplete')).toBe('username');
    });

    it('uses the guest account-link flow and preserves the selected skip policy', async () => {
        render(<LoginBox onCancel={() => {}} />);

        fireEvent.click(screen.getByLabelText('Non trasferire i progressi'));
        fireEvent.click(screen.getByRole('button', { name: 'Accedi con Google' }));

        await waitFor(() => {
            expect(authMocks.linkGoogleAccount).toHaveBeenCalledTimes(1);
        });
        expect(authMocks.login).not.toHaveBeenCalled();
        expect(authMocks.linkGoogleAccount).toHaveBeenCalledWith('skip');
    });

    it('exposes guest login as a modal dialog and traps focus until it closes', () => {
        const opener = document.createElement('button');
        opener.textContent = 'Apri';
        document.body.appendChild(opener);
        opener.focus();
        const onCancel = vi.fn();
        const view = render(<LoginBox onCancel={onCancel} />);

        const dialog = screen.getByRole('dialog', { name: 'TheLogBook' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.activeElement).toBe(screen.getByLabelText('Email'));

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
        view.unmount();
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('keeps the normal Google login flow when there is no guest session', async () => {
        authState.isGuest = false;
        render(<LoginBox />);

        fireEvent.click(screen.getByRole('button', { name: 'Accedi con Google' }));

        await waitFor(() => {
            expect(authMocks.login).toHaveBeenCalledTimes(1);
        });
        expect(authMocks.linkGoogleAccount).not.toHaveBeenCalled();
    });
    it('shows unmet password requirements immediately and rejects weak registration', async () => {
        const policy = { customStrengthOptions: { minPasswordLength: 8, containsLowercaseLetter: true, containsUppercaseLetter: true, containsNumericCharacter: true, containsNonAlphanumericCharacter: true } };
        vi.mocked(validatePassword)
            .mockResolvedValueOnce({ isValid: false, passwordPolicy: policy } as any)
            .mockResolvedValueOnce({ isValid: false, containsNumericCharacter: false, passwordPolicy: policy } as any);
        authState.isGuest = false;
        render(<LoginBox />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!);
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'new@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'caccapuou' } });
        fireEvent.change(screen.getByLabelText('Conferma password'), { target: { value: 'caccapuou' } });
        expect(screen.getByText(/Una lettera maiuscola/).closest('li')?.getAttribute('data-status')).toBe('missing');
        fireEvent.click(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!);
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('maiuscola'));
        expect(authMocks.registerWithEmail).not.toHaveBeenCalled();
        expect(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!.hasAttribute('disabled')).toBe(false);
    });

    it('reports mismatched confirmation before sending any registration request', async () => {
        authState.isGuest = false;
        render(<LoginBox />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!);
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'new@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecurePassword123!' } });
        fireEvent.change(screen.getByLabelText('Conferma password'), { target: { value: 'not-the-same' } });
        expect(screen.getByLabelText('Conferma password').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByText('Le password non coincidono.')).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!);
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('non coincidono'));
        expect(authMocks.registerWithEmail).not.toHaveBeenCalled();
    });

    it('completes a valid submission and displays a Firebase registration error if rejected', async () => {
        authState.isGuest = false;
        authMocks.registerWithEmail.mockRejectedValueOnce(
            Object.assign(new Error('Firebase internal exception'), { code: 'auth/email-already-in-use' }),
        );
        render(<LoginBox />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!);
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'existing@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecurePassword123!' } });
        fireEvent.change(screen.getByLabelText('Conferma password'), { target: { value: 'SecurePassword123!' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!);
        await waitFor(() => expect(authMocks.registerWithEmail).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Registrazione non completata'));
        expect(screen.queryByText('Firebase internal exception')).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!.hasAttribute('disabled')).toBe(false);
    });

    it('surfaces a Google sign-in failure returned through the auth store', async () => {
        authState.isGuest = false;
        authMocks.login.mockImplementationOnce(async () => {
            useAppStore.getState().setSaveError('Accesso Google fallito. Riprova.');
        });
        render(<LoginBox />);
        fireEvent.click(screen.getByRole('button', { name: 'Accedi con Google' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Accesso Google fallito'));
    });

    it('submits a valid password and email when Firebase accepts the account', async () => {
        authState.isGuest = false;
        render(<LoginBox />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!);
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'valid@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecurePassword123!' } });
        fireEvent.change(screen.getByLabelText('Conferma password'), { target: { value: 'SecurePassword123!' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Registrati' }).at(-1)!);
        await waitFor(() => expect(authMocks.registerWithEmail).toHaveBeenCalledWith('valid@example.com', 'SecurePassword123!', undefined));
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not distinguish a non-existent email from a successful password reset request', async () => {
        authState.isGuest = false;
        const messages: string[] = [];

        for (const unknownAddress of [false, true]) {
            if (unknownAddress) {
                vi.mocked(sendPasswordResetEmail).mockRejectedValueOnce(
                    Object.assign(new Error('EMAIL_NOT_FOUND'), { code: 'auth/user-not-found' }),
                );
            }
            const view = render(<LoginBox />);
            fireEvent.click(screen.getByRole('button', { name: 'Hai dimenticato la password?' }));
            fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
                target: { value: unknownAddress ? 'missing@example.com' : 'known@example.com' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Invia Link di Recupero' }));
            await waitFor(() => expect(authMocks.showAlert).toHaveBeenCalledTimes(1));
            messages.push(String(authMocks.showAlert.mock.calls[0][0]));
            expect(screen.queryByRole('alert')).toBeNull();
            await waitFor(() => expect(screen.queryByRole('button', { name: 'Invia Link di Recupero' })).toBeNull());
            view.unmount();
            authMocks.showAlert.mockClear();
        }

        expect(messages[0]).toBe(messages[1]);
        expect(messages[0]).toContain("Se l'email è registrata");
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2);
    });

    it.each(['success', 'unknown-address'] as const)(
        'does not show a stale password-recovery notice after the login overlay closes (%s)',
        async outcome => {
            authState.isGuest = false;
            let finish!: () => void;
            let fail!: (error: Error) => void;
            vi.mocked(sendPasswordResetEmail).mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
                finish = resolve;
                fail = reject;
            }));

            const view = render(<LoginBox onCancel={() => {}} />);
            fireEvent.click(screen.getByRole('button', { name: 'Hai dimenticato la password?' }));
            fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
                target: { value: 'account@example.com' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Invia Link di Recupero' }));
            expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);

            view.unmount();
            await act(async () => {
                if (outcome === 'success') finish();
                else fail(Object.assign(new Error('masked'), { code: 'auth/user-not-found' }));
            });

            expect(authMocks.showAlert).not.toHaveBeenCalled();
        },
    );

    it('continues to report genuine password reset delivery failures without disclosing provider errors', async () => {
        authState.isGuest = false;
        vi.mocked(sendPasswordResetEmail).mockRejectedValueOnce(new Error('Private provider details'));
        render(<LoginBox />);
        fireEvent.click(screen.getByRole('button', { name: 'Hai dimenticato la password?' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
            target: { value: 'someone@example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Invia Link di Recupero' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Controlla la connessione'));
        expect(screen.queryByText('Private provider details')).toBeNull();
        expect(authMocks.showAlert).not.toHaveBeenCalled();
    });

});
