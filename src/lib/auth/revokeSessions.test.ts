import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { AppCheck } from 'firebase/app-check';
import type { AppCheckResult } from '../appCheck';

const sdk = vi.hoisted(() => ({
    ready: vi.fn<() => Promise<AppCheckResult>>(),
    appToken: vi.fn<() => Promise<string>>(),
}));
vi.mock('../firebase', async importOriginal => ({
    ...await importOriginal<typeof import('../firebase')>(),
    ensureAppCheck: sdk.ready,
}));
vi.mock('../appCheck', async importOriginal => ({
    ...await importOriginal<typeof import('../appCheck')>(),
    getLimitedUseAppCheckToken: sdk.appToken,
}));

import { auth } from '../firebase';
import { invalidateSession } from '../sync/session';
import { revokeSessionsOnServer } from './revokeSessions';

const ready: AppCheckResult = {
    success: true, appCheck: {} as AppCheck, isFallbackOffline: false,
    phase: 'token-ready', providerInitialized: true, tokenAvailable: true, retryable: false,
};
const token = vi.fn<(forceRefresh?: boolean) => Promise<string>>();
const user = { uid: 'session-a', getIdToken: token } as unknown as User;
const network = vi.fn<typeof fetch>();

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function replaceSession() {
    (auth as { currentUser: unknown }).currentUser = { uid: 'session-b' };
    invalidateSession();
    (auth as { currentUser: unknown }).currentUser = user;
    invalidateSession();
}

beforeEach(() => {
    localStorage.clear();
    (auth as { currentUser: unknown }).currentUser = user;
    invalidateSession();
    sdk.ready.mockReset().mockResolvedValue(ready);
    sdk.appToken.mockReset().mockResolvedValue('app-check-token');
    token.mockReset().mockResolvedValue('fresh-id-token');
    network.mockReset().mockResolvedValue(Response.json({ status: 'revoked' }));
    vi.stubGlobal('fetch', network);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('trusted session revocation transport', () => {
    it('confirms the explicit server acknowledgement with fresh credentials', async () => {
        await expect(revokeSessionsOnServer(user)).resolves.toBeUndefined();
        expect(token).toHaveBeenCalledExactlyOnceWith(true);
        expect(sdk.appToken).toHaveBeenCalledOnce();
        expect(network).toHaveBeenCalledExactlyOnceWith(
            expect.stringMatching(/\/api\/account-sessions$/),
            expect.objectContaining({
                method: 'POST', cache: 'no-store',
                headers: { authorization: 'Bearer fresh-id-token', 'x-firebase-appcheck': 'app-check-token' },
                signal: expect.any(AbortSignal),
            }),
        );
    });

    it('rejects a different current UID before obtaining credentials', async () => {
        (auth as { currentUser: unknown }).currentUser = { uid: 'session-b' };
        await expect(revokeSessionsOnServer(user)).rejects.toThrow('Sessione cambiata');
        expect(sdk.ready).not.toHaveBeenCalled();
        expect(token).not.toHaveBeenCalled();
        expect(network).not.toHaveBeenCalled();
    });

    it.each(['readiness', 'id-token', 'app-check'] as const)(
        'does not send a stale request after A-B-A during %s',
        async stage => {
            const readiness = deferred<AppCheckResult>();
            const credential = deferred<string>();
            if (stage === 'readiness') sdk.ready.mockReturnValueOnce(readiness.promise);
            else if (stage === 'id-token') token.mockReturnValueOnce(credential.promise);
            else sdk.appToken.mockReturnValueOnce(credential.promise);
            const pending = revokeSessionsOnServer(user);
            const rejected = expect(pending).rejects.toThrow('Sessione cambiata');
            const boundary = stage === 'readiness' ? sdk.ready : stage === 'id-token' ? token : sdk.appToken;
            await vi.waitFor(() => expect(boundary).toHaveBeenCalledOnce());
            replaceSession();
            if (stage === 'readiness') readiness.resolve(ready);
            else credential.resolve('stale-token');
            await rejected;
            expect(network).not.toHaveBeenCalled();
            if (stage === 'readiness') expect(token).not.toHaveBeenCalled();
            if (stage === 'id-token') expect(sdk.appToken).not.toHaveBeenCalled();
        },
    );

    it.each(['{}', '{"status":"pending"}', 'null', '<html>not an acknowledgement</html>'])(
        'does not confirm HTTP success with invalid body %s',
        async body => {
            network.mockResolvedValueOnce(new Response(body, { status: 200 }));
            await expect(revokeSessionsOnServer(user)).rejects.toThrow('Revoca non confermata');
        },
    );

    it('rejects an unsuccessful response even if its body claims revocation', async () => {
        network.mockResolvedValueOnce(Response.json({ status: 'revoked' }, { status: 503 }));
        await expect(revokeSessionsOnServer(user)).rejects.toThrow('Revoca non confermata');
    });

    it('does not confirm an acknowledgement for a superseded session while reading the body', async () => {
        const body = deferred<{ status: string }>();
        const response = Response.json({ status: 'revoked' });
        const parse = vi.spyOn(response, 'json').mockReturnValueOnce(body.promise);
        network.mockResolvedValueOnce(response);
        const pending = revokeSessionsOnServer(user);
        const rejected = expect(pending).rejects.toThrow('Sessione cambiata');
        await vi.waitFor(() => expect(parse).toHaveBeenCalledOnce());
        replaceSession();
        body.resolve({ status: 'revoked' });
        await rejected;
        expect(network).toHaveBeenCalledTimes(1);
    });

    it('bounds token acquisition and prevents a late credential from reaching the server', async () => {
        vi.useFakeTimers();
        const credential = deferred<string>();
        token.mockReturnValueOnce(credential.promise);
        const pending = revokeSessionsOnServer(user);
        const rejected = expect(pending).rejects.toThrow('la revoca potrebbe essere già avvenuta');
        await vi.waitFor(() => expect(token).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(10_000);
        await rejected;
        credential.resolve('late-token');
        await vi.runAllTimersAsync();
        expect(sdk.appToken).not.toHaveBeenCalled();
        expect(network).not.toHaveBeenCalled();
    });

    it('bounds response body parsing and aborts the transport on timeout', async () => {
        vi.useFakeTimers();
        const body = deferred<{ status: string }>();
        const response = Response.json({ status: 'revoked' });
        const parse = vi.spyOn(response, 'json').mockReturnValueOnce(body.promise);
        network.mockResolvedValueOnce(response);
        const pending = revokeSessionsOnServer(user);
        const rejected = expect(pending).rejects.toThrow('la revoca potrebbe essere già avvenuta');
        await vi.waitFor(() => expect(parse).toHaveBeenCalledOnce());
        const signal = network.mock.calls[0][1]?.signal;
        await vi.advanceTimersByTimeAsync(10_000);
        await rejected;
        expect(signal?.aborted).toBe(true);
        body.resolve({ status: 'revoked' });
        await vi.runAllTimersAsync();
        expect(network).toHaveBeenCalledTimes(1);
    });
});
