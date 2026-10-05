import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reload, verifyBeforeUpdateEmail } from '../firebase';
import { linkEmailPasswordWithEnumerationProtection, requestVerifiedEmailChange } from './accountEmail';

const mockedReload = vi.mocked(reload);
const mockedVerifyBeforeUpdateEmail = vi.mocked(verifyBeforeUpdateEmail);

describe('account email operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
    });

    it('requests a verified email change instead of mutating the address immediately', async () => {
        const user = { uid: 'u1' } as any;

        await requestVerifiedEmailChange(user, ' new@example.com ');

        expect(mockedVerifyBeforeUpdateEmail).toHaveBeenCalledWith(user, 'new@example.com');
    });

    it('links email/password through the EEP-compatible Identity Toolkit signUp boundary', async () => {
        const user = {
            uid: 'u1',
            getIdToken: vi.fn().mockResolvedValue('fresh-id-token'),
        } as any;
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ localId: 'u1' }), { status: 200 }));

        await linkEmailPasswordWithEnumerationProtection(user, 'user@example.com', 'Secret1!');

        expect(user.getIdToken).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('accounts:signUp?key='),
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    idToken: 'fresh-id-token',
                    email: 'user@example.com',
                    password: 'Secret1!',
                    returnSecureToken: true,
                }),
            }),
        );
        expect(mockedReload).toHaveBeenCalledWith(user);
    });

    it('does not reload the user when Identity Toolkit rejects the link', async () => {
        const user = {
            uid: 'u1',
            getIdToken: vi.fn().mockResolvedValue('fresh-id-token'),
        } as any;
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            error: { message: 'EMAIL_EXISTS' },
        }), { status: 400 }));

        await expect(
            linkEmailPasswordWithEnumerationProtection(user, 'used@example.com', 'Secret1!'),
        ).rejects.toMatchObject({ code: 'auth/email-already-in-use' });
        expect(mockedReload).not.toHaveBeenCalled();
    });
});
