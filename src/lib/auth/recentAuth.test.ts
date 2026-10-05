import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

const mocks = vi.hoisted(() => ({
    credential: vi.fn((email: string, password: string) => ({ email, password })),
    credentialReauth: vi.fn(),
    popupReauth: vi.fn(),
    redirectReauth: vi.fn(),
}));

vi.mock('../firebase', () => ({
    EmailAuthProvider: { credential: mocks.credential },
    provider: { providerId: 'google.com' },
    reauthenticateWithCredential: mocks.credentialReauth,
    reauthenticateWithPopup: mocks.popupReauth,
    reauthenticateWithRedirect: mocks.redirectReauth,
}));

import { reauthenticateForSensitiveAction } from './recentAuth';

function user(providerIds: string[], email = 'test@example.com'): User {
    return {
        email,
        providerData: providerIds.map(providerId => ({ providerId })),
    } as User;
}

describe('reauthenticateForSensitiveAction', () => {
    beforeEach(() => vi.clearAllMocks());

    it('requires a password for password-only accounts and then reauthenticates with it', async () => {
        const current = user(['password']);
        await expect(reauthenticateForSensitiveAction(current)).resolves.toBe('password-required');
        await expect(reauthenticateForSensitiveAction(current, 'Secret1!')).resolves.toBe('reauthenticated');
        expect(mocks.credential).toHaveBeenCalledWith('test@example.com', 'Secret1!');
        expect(mocks.credentialReauth).toHaveBeenCalledTimes(1);
    });

    it('reauthenticates Google accounts with the linked provider', async () => {
        const current = user(['google.com']);
        await expect(reauthenticateForSensitiveAction(current)).resolves.toBe('reauthenticated');
        expect(mocks.popupReauth).toHaveBeenCalledTimes(1);
    });

    it('falls back to redirect when Google popup reauthentication is blocked', async () => {
        const current = user(['google.com']);
        mocks.popupReauth.mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }));
        mocks.redirectReauth.mockResolvedValueOnce(undefined);

        await expect(reauthenticateForSensitiveAction(current)).resolves.toBe('redirect-started');
        expect(mocks.redirectReauth).toHaveBeenCalledWith(current, expect.anything());
    });

    it('fails closed for unsupported provider sets', async () => {
        await expect(reauthenticateForSensitiveAction(user(['github.com']))).resolves.toBe('unsupported');
    });
});
