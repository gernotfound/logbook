import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
    login: vi.fn(async () => {}),
    loginWithEmail: vi.fn(async () => {}),
    registerWithEmail: vi.fn(async () => {}),
    loginAsGuest: vi.fn(async () => {}),
    linkGoogleAccount: vi.fn(async () => {}),
    showAlert: vi.fn(async () => {}),
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
import { validatePassword } from '../src/lib/firebase';
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
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('già registrata'));
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

});
