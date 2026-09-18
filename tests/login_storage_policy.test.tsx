import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageMock } from './setup';

const authActions = vi.hoisted(() => ({
    login: vi.fn(),
    loginWithEmail: vi.fn(),
    registerWithEmail: vi.fn(),
    loginAsGuest: vi.fn(),
    linkGoogleAccount: vi.fn(),
}));
const ui = vi.hoisted(() => ({ alert: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../src/hooks/useAuth', () => ({
    useAuth: () => ({
        ...authActions,
        isGuest: true,
    }),
}));

vi.mock('../src/store/useDialogStore', () => ({
    useDialogStore: () => ({ showAlert: ui.alert }),
}));

vi.mock('../src/lib/firebase', () => ({
    auth: {},
    sendPasswordResetEmail: vi.fn(),
}));

import { LoginBox } from '../src/components/UI/LoginBox';

describe('LoginBox guest migration storage boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not start authentication when the selected migration policy cannot be persisted', async () => {
        localStorageMock.setItem.mockImplementationOnce((key: string) => {
            if (key === 'guest_migration_policy') {
                throw new DOMException('full', 'QuotaExceededError');
            }
        });

        render(<LoginBox />);
        const emailInput = screen.getByPlaceholderText('La tua email');
        fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Password1!' } });

        const form = emailInput.closest('form');
        expect(form).not.toBeNull();
        fireEvent.submit(form!);

        await waitFor(() => expect(ui.alert).toHaveBeenCalled());
        expect(authActions.loginWithEmail).not.toHaveBeenCalled();
    });
});
