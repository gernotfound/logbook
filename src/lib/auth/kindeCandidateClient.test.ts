import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    KindeCandidateBoundaryError, readKindeCandidateAccess, submitKindeHostedSignIn,
} from './kindeCandidateClient';

const A = 'k_' + 'A'.repeat(43);
const B = 'k_' + 'B'.repeat(43);
const session = (uid = A, epoch = 1, consent = 0) => ({
    authenticated: true, uid, emailVerified: true,
    fenceEpoch: epoch, healthConsentRevision: consent,
});
const status = (state: string, revision: number, epoch = 1) => ({
    status: state, revision, fenceEpoch: epoch,
    ...(state === 'active' ? {
        acceptedAt: '2026-11-14T10:00:00.000Z',
        privacyVersion: '1.3.9', termsVersion: '1.2.5',
    } : {}),
});
const reply = (payload: unknown, statusCode = 200) => new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
});
const responses = (...items: Response[]) => vi.fn<typeof fetch>()
    .mockImplementation(async () => {
        const result = items.shift();
        if (!result) throw new Error('unexpected HTTP call');
        return result;
    });
const read = (send: typeof fetch, stillCurrent = () => true) => readKindeCandidateAccess({ send, stillCurrent });

afterEach(() => {
    document.querySelectorAll('form[action$="/api/auth/kinde/start"]').forEach(form => form.remove());
    vi.restoreAllMocks();
});

describe('candidate first-party Kinde client boundary', () => {
    it('does not call a backend until explicitly invoked; reads session and first-consent gate without writes', async () => {
        const send = responses(reply(session()), reply(status('unregistered', 0)), reply(session()));
        expect(send).not.toHaveBeenCalled();
        await expect(read(send)).resolves.toEqual({
            kind: 'consent-required', principal: { uid: A, fenceEpoch: 1, healthConsentRevision: 0 },
        });
        expect(send).toHaveBeenCalledTimes(3);
        expect(send.mock.calls.map(([path]) => path)).toEqual([
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
        ]);
        for (const [, init] of send.mock.calls) {
            expect(init).toEqual(expect.objectContaining({
                method: 'POST', mode: 'same-origin', credentials: 'same-origin',
                cache: 'no-store', redirect: 'error',
                headers: { Accept: 'application/json' },
            }));
            expect(init).not.toHaveProperty('body');
            expect(init).not.toHaveProperty('Authorization');
        }
    });

    it('returns an advisory legal-current consent signal, never a cloud grant', async () => {
        const send = responses(reply(session(A, 1, 1)), reply(status('active', 1)), reply(session(A, 1, 1)));
        await expect(read(send)).resolves.toEqual({
            kind: 'consent-confirmed', principal: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
        });
        const oldLegal = responses(reply(session(A, 1, 1)), reply({
            ...status('active', 1), privacyVersion: '1.3.8',
        }), reply(session(A, 1, 1)));
        await expect(read(oldLegal)).resolves.toMatchObject({ kind: 'legal-update-required' });
    });

    it('distinguishes absent session from transport failure, logout races and consent suspension', async () => {
        await expect(read(responses(reply({ error: 'unauthorized' }, 401)))).resolves.toEqual({ kind: 'signed-out' });
        await expect(read(responses(reply({ error: 'unknown' }, 401)))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        await expect(read(responses(new Response('<html>Unauthorized</html>', { status: 401,
            headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
        })))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        await expect(read(responses(reply({ error: 'unavailable' }, 503)))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        await expect(read(responses(reply(session(A, 1, 1)), reply(status('withdrawn', 1)),
            reply(session(A, 1, 1))))).resolves.toMatchObject({ kind: 'consent-suspended', status: 'withdrawn' });
        await expect(read(responses(reply(session(A, 1, 1)), reply(status('active', 1)),
            reply({ error: 'unauthorized' }, 401)))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
    });

    it('rejects cross-account and epoch changes between consent and session reads', async () => {
        for (const changed of [session(B, 1, 1), session(A, 2, 1), session(A, 1, 0)]) {
            await expect(read(responses(reply(session(A, 1, 1)), reply(status('active', 1)),
                reply(changed)))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
    });

    it('never adopts malformed, unverified or inconsistent backend claims', async () => {
        for (const invalid of [
            { ...session(), emailVerified: false },
            { ...session(), uid: 'firebase-user' },
            { ...session(), healthConsentRevision: -1 },
            { ...session(), arbitraryToken: 'secret' },
        ]) {
            await expect(read(responses(reply(invalid)))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        for (const invalid of [
            status('active', 1),
            status('unregistered', 1),
            status('active', 1, 2),
            { ...status('active', 1), acceptedAt: 'invalid' },
            status('unexpected', 0),
        ]) {
            await expect(read(responses(reply(session()), reply(invalid)))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
    });

    it('rejects cached HTML, opaque redirects, oversized JSON and unstable caller epochs', async () => {
        const html = new Response('<html>app shell</html>', {
            headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
        });
        await expect(read(responses(html))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        const large = reply({ payload: 'x'.repeat(2500) });
        await expect(read(responses(large))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        const noStoreMissing = new Response(JSON.stringify(session()), {
            headers: { 'Content-Type': 'application/json' },
        });
        await expect(read(responses(noStoreMissing))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        let current = true;
        const send = vi.fn<typeof fetch>().mockImplementation(async () => {
            current = false;
            return reply(session());
        });
        await expect(read(send, () => current)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).toHaveBeenCalledTimes(1);
        const none = vi.fn<typeof fetch>();
        await expect(read(none, () => false)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(none).not.toHaveBeenCalled();
    });

    it('initiates OAuth only through an empty same-origin native POST navigation', () => {
        let posted: HTMLFormElement | null = null;
        vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
            posted = this;
        });
        submitKindeHostedSignIn(document, () => true);
        expect(posted).not.toBeNull();
        expect(posted!.method).toBe('post');
        expect(new URL(posted!.action).pathname).toBe('/api/auth/kinde/start');
        expect(new URL(posted!.action).origin).toBe(window.location.origin);
        expect(posted!.querySelectorAll('input').length).toBe(0);
        const ownFormCount = document.querySelectorAll('form[action$="/api/auth/kinde/start"]').length;
        expect(() => submitKindeHostedSignIn(document, () => false)).toThrow(KindeCandidateBoundaryError);
        expect(document.querySelectorAll('form[action$="/api/auth/kinde/start"]').length).toBe(ownFormCount);
    });
});
