import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, firebaseApp, reload, verifyBeforeUpdateEmail } from '../firebase';
import { invalidateSession } from '../sync/session';
import { linkEmailPasswordWithEnumerationProtection, requestVerifiedEmailChange } from './accountEmail';

const mockedReload = vi.mocked(reload);
const mockedVerifyBeforeUpdateEmail = vi.mocked(verifyBeforeUpdateEmail);

afterEach(() => vi.unstubAllGlobals());

describe('account email operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (auth as { currentUser: unknown }).currentUser = { uid: 'u1' };
        invalidateSession();
        (firebaseApp as any).options = { apiKey: 'test-api-key' };
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
            'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=test-api-key',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    it('keeps a confirmed remote link distinct from a failed local refresh', async () => {
        const user = { uid: 'u1', getIdToken: vi.fn().mockResolvedValue('fresh-id-token') } as any;
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ localId: 'u1' }), { status: 200 }));
        mockedReload.mockRejectedValueOnce(new Error('local refresh offline'));

        await expect(linkEmailPasswordWithEnumerationProtection(user, 'user@example.com', 'Secret1!'))
            .resolves.toBe('refresh-pending');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(mockedReload).toHaveBeenCalledExactlyOnceWith(user);
    });

    it.each([
        ['EMAIL_EXISTS', 'auth/email-already-in-use'],
        ['INVALID_EMAIL', 'auth/invalid-email'],
        ['WEAK_PASSWORD : password below policy', 'auth/weak-password'],
        ['TOKEN_EXPIRED', 'auth/user-token-expired'],
        ['INVALID_ID_TOKEN', 'auth/user-token-expired'],
        ['UNEXPECTED_PROVIDER_FAILURE', 'auth/account-update-failed'],
    ])('maps provider error %s into stable code %s without reload', async (message, code) => {
        const user = { uid: 'u1', getIdToken: vi.fn().mockResolvedValue('fresh-id-token') } as any;
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message } }), { status: 400 }));

        await expect(linkEmailPasswordWithEnumerationProtection(user, 'user@example.com', 'Secret1!'))
            .rejects.toMatchObject({ code });
        expect(mockedReload).not.toHaveBeenCalled();
    });

    it.each([
        ['non-JSON error', 403, '<html>forbidden</html>'],
        ['empty error', 500, '{}'],
        ['null body', 400, 'null'],
        ['null error', 400, '{"error":null}'],
        ['non-string message', 400, '{"error":{"message":123}}'],
        ['object message', 400, '{"error":{"message":{"code":"EMAIL_EXISTS"}}}'],
    ])('fails closed for %s provider responses', async (_reason, status, body) => {
        const user = { uid: 'u1', getIdToken: vi.fn().mockResolvedValue('fresh-id-token') } as any;
        vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { status }));

        await expect(linkEmailPasswordWithEnumerationProtection(user, 'user@example.com', 'Secret1!'))
            .rejects.toMatchObject({ code: 'auth/account-update-failed' });
        expect(mockedReload).not.toHaveBeenCalled();
    });

    it.each([
        ['invalid JSON', '<not-json>'],
        ['missing localId', '{}'],
        ['another UID', '{"localId":"other-user"}'],
    ])('does not report a linked credential after HTTP success with %s', async (_reason, body) => {
        const user = { uid: 'u1', getIdToken: vi.fn().mockResolvedValue('fresh-id-token') } as any;
        vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { status: 200 }));

        await expect(linkEmailPasswordWithEnumerationProtection(user, 'user@example.com', 'Secret1!'))
            .rejects.toMatchObject({ code: 'auth/account-update-failed' });
        expect(mockedReload).not.toHaveBeenCalled();
    });

    it('rejects absent client API key without sending credentials', async () => {
        (firebaseApp as any).options = { apiKey: '' };
        const user = { uid: 'u1', getIdToken: vi.fn() } as any;
        await expect(linkEmailPasswordWithEnumerationProtection(user, 'user@example.com', 'Secret1!'))
            .rejects.toThrow('API key non disponibile');
        expect(user.getIdToken).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not send credentials after token retrieval fails', async () => {
        const user = { uid: 'u1', getIdToken: vi.fn().mockRejectedValue(new Error('token unavailable')) } as any;
        await expect(linkEmailPasswordWithEnumerationProtection(user, 'user@example.com', 'Secret1!'))
            .rejects.toThrow('token unavailable');
        expect(fetch).not.toHaveBeenCalled();
        expect(mockedReload).not.toHaveBeenCalled();
    });

    it('propagates transport failures without reloading the current user', async () => {
        const user = { uid: 'u1', getIdToken: vi.fn().mockResolvedValue('fresh-id-token') } as any;
        vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
        await expect(linkEmailPasswordWithEnumerationProtection(user, 'user@example.com', 'Secret1!'))
            .rejects.toThrow('offline');
        expect(mockedReload).not.toHaveBeenCalled();
    });

    it('does not submit a credential after A-B-A during token acquisition', async () => {
        let finish!: (token: string) => void;
        const user = { uid: 'u1', getIdToken: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })) } as any;
        const pending = linkEmailPasswordWithEnumerationProtection(user, 'user@example.test', 'Secret1!');
        expect(user.getIdToken).toHaveBeenCalledOnce();
        (auth as { currentUser: unknown }).currentUser = { uid: 'u2' };
        invalidateSession();
        (auth as { currentUser: unknown }).currentUser = { uid: 'u1' };
        invalidateSession();
        finish('old-token');
        await expect(pending).rejects.toThrow('Sessione cambiata');
        expect(fetch).not.toHaveBeenCalled();
        expect(mockedReload).not.toHaveBeenCalled();
    });

    it('preserves confirmed remote success without refreshing a replaced session', async () => {
        let finish!: (response: Response) => void;
        const user = { uid: 'u1', getIdToken: vi.fn(async () => 'synthetic-token') } as any;
        vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
        const pending = linkEmailPasswordWithEnumerationProtection(user, 'user@example.test', 'Secret1!');
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        invalidateSession();
        finish(Response.json({ localId: 'u1' }));
        await expect(pending).resolves.toBe('refresh-pending');
        expect(mockedReload).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
