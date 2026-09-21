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
}));

vi.mock('../src/store/useDialogStore', () => ({
    useDialogStore: () => ({ showAlert: authMocks.showAlert }),
}));

import { LoginBox } from '../src/components/UI/LoginBox';

describe('LoginBox guest Google authentication', () => {
    beforeEach(() => {
        localStorage.clear();
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
        expect(localStorage.getItem('guest_migration_policy')).toBe('skip');
    });

    it('exposes guest login as a modal dialog and traps focus until it closes', () => {
        const opener = document.createElement('button');
        opener.textContent = 'Apri';
        document.body.appendChild(opener);
        opener.focus();
        const onCancel = vi.fn();
        const view = render(<LoginBox onCancel={onCancel} />);

        const dialog = screen.getByRole('dialog', { name: 'LogBook' });
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
        expect(localStorage.getItem('guest_migration_policy')).toBeNull();
    });
});
