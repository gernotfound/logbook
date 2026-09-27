import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
    credential: vi.fn((email: string, password: string) => ({ email, password })),
    reauthenticateWithCredential: vi.fn(async () => {}),
    reauthenticateWithPopup: vi.fn(async () => {}),
}));

vi.mock('../src/lib/firebase', () => ({
    EmailAuthProvider: { credential: authMocks.credential },
    provider: { providerId: 'google.com' },
    reauthenticateWithCredential: authMocks.reauthenticateWithCredential,
    reauthenticateWithPopup: authMocks.reauthenticateWithPopup,
}));

import {
    isSensitiveReauthCancellation,
    reauthenticateForSensitiveAction,
} from '../src/lib/auth/recentAuth';

const user = (providerIds: string[], email = 'user@example.com') => ({
    email,
    providerData: providerIds.map(providerId => ({ providerId })),
}) as any;

describe('recent authentication hardening', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('requires the current password before reauthenticating a password account', async () => {
        const account = user(['password']);
        await expect(reauthenticateForSensitiveAction(account)).resolves.toBe('password-required');
        expect(authMocks.reauthenticateWithCredential).not.toHaveBeenCalled();

        await expect(reauthenticateForSensitiveAction(account, 'Secret123!')).resolves.toBe('reauthenticated');
        expect(authMocks.credential).toHaveBeenCalledWith('user@example.com', 'Secret123!');
        expect(authMocks.reauthenticateWithCredential).toHaveBeenCalledTimes(1);
    });

    it('reauthenticates Google accounts with the provider popup and recognizes user cancellation', async () => {
        await expect(reauthenticateForSensitiveAction(user(['google.com']))).resolves.toBe('reauthenticated');
        expect(authMocks.reauthenticateWithPopup).toHaveBeenCalledTimes(1);
        expect(isSensitiveReauthCancellation({ code: 'auth/popup-closed-by-user' })).toBe(true);
        expect(isSensitiveReauthCancellation({ code: 'auth/network-request-failed' })).toBe(false);
    });

    it('collects the deletion password through a transient dialog callback', async () => {
        const { useDialogStore } = await vi.importActual<typeof import('../src/store/useDialogStore')>(
            '../src/store/useDialogStore',
        );
        useDialogStore.getState().closeDialog();
        const promise = useDialogStore.getState().showPasswordPrompt('Inserisci password', 'Verifica identitÃ ');
        const state = useDialogStore.getState();
        expect(state.type).toBe('password-prompt');
        expect(state.message).toBe('Inserisci password');
        expect(state).not.toHaveProperty('password');
        state.onInputConfirm?.('Secret123!');
        await expect(promise).resolves.toBe('Secret123!');
        expect(useDialogStore.getState().isOpen).toBe(false);
    });
});
