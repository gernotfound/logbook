import { describe, expect, it, vi } from 'vitest';
import { KindeCandidateBoundaryError } from './kindeCandidateClient';
import { readKindeCandidateIdentity } from './kindeCandidateIdentity';

const A = 'k_' + 'A'.repeat(43);
const B = 'k_' + 'B'.repeat(43);
const CSRF = 'A'.repeat(43);
const OTHER_CSRF = 'B'.repeat(43);
const identity = (uid = A, epoch = 1, emailVerified = true, consentRevision = 0) => ({
    authenticated: true, uid, emailVerified, fenceEpoch: epoch,
    healthConsentRevision: consentRevision,
});
const reply = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const replies = (...responses: Response[]) => vi.fn<typeof fetch>()
    .mockImplementation(async () => {
        const response = responses.shift();
        if (!response) throw new Error('Unexpected request');
        return response;
    });
const cookie = () => '__Host-logbook_csrf=' + CSRF;

describe('Kinde identity-only session observer', () => {
    it('reads a signed-out status without requiring a CSRF cookie or requesting consent', async () => {
        const send = replies(reply({ error: 'unauthorized' }, 401));
        await expect(readKindeCandidateIdentity({ send, stillCurrent: () => true,
            browserCookies: () => '' })).resolves.toEqual({ kind: 'signed-out' });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toBe('/api/auth/session');
        expect(send.mock.calls[0][1]).toMatchObject({
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' },
        });
    });

    it('exposes only a rights-only label for a trusted but unverified email', async () => {
        const send = replies(reply(identity(A, 4, false)), reply(identity(A, 4, false)));
        await expect(readKindeCandidateIdentity({
            send, stillCurrent: () => true, browserCookies: cookie,
        })).resolves.toEqual({ kind: 'email-unverified', principal: {
            uid: A, emailVerified: false, fenceEpoch: 4, healthConsentRevision: 0,
        } });
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls.every(([path]) => path === '/api/auth/session')).toBe(true);
    });

    it('a verified identity is NOT a claim to consent, vault or cloud storage', async () => {
        const send = replies(reply(identity()), reply(identity()));
        await expect(readKindeCandidateIdentity({
            send, stillCurrent: () => true, browserCookies: cookie,
        })).resolves.toMatchObject({ kind: 'email-verified',
            principal: { uid: A, healthConsentRevision: 0 } });
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('fails closed on a changed UID, epoch, revision or email proof', async () => {
        for (const changed of [
            identity(B), identity(A, 2), identity(A, 1, true, 1),
            identity(A, 1, false),
        ]) {
            const send = replies(reply(identity()), reply(changed));
            await expect(readKindeCandidateIdentity({
                send, stillCurrent: () => true, browserCookies: cookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
    });

    it('rejects a session replacement with identical claims when CSRF changes', async () => {
        let cookies = cookie();
        const send = vi.fn<typeof fetch>().mockImplementation(async () => {
            if (send.mock.calls.length === 2) cookies = '__Host-logbook_csrf=' + OTHER_CSRF;
            return reply(identity());
        });
        await expect(readKindeCandidateIdentity({
            send, stillCurrent: () => true, browserCookies: () => cookies,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
    });

    it('never treats 401 corruption, no-store missing, HTML fallback or 503 as signed-out', async () => {
        const invalid = [
            reply({ error: 'unknown' }, 401),
            reply({ error: 'unavailable' }, 503),
            new Response('<html>shell</html>', {
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
            }),
            new Response(JSON.stringify(identity()), {
                headers: { 'Content-Type': 'application/json' },
            }),
        ];
        for (const response of invalid) {
            await expect(readKindeCandidateIdentity({
                send: replies(response), stillCurrent: () => true, browserCookies: cookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
    });

    it('rejects malformed owner/identity/unknown response keys', async () => {
        const invalid = [
            { ...identity(), uid: 'firebase-user' },
            { ...identity(), emailVerified: 'true' },
            { ...identity(), fenceEpoch: -1 },
            { ...identity(), healthConsentRevision: -1 },
            { ...identity(), accessToken: 'unexpected' },
        ];
        for (const item of invalid) {
            await expect(readKindeCandidateIdentity({
                send: replies(reply(item)), stillCurrent: () => true, browserCookies: cookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
    });

    it('does not publish results after caller generation changes or if CSRF is absent', async () => {
        const send = replies(reply(identity()));
        await expect(readKindeCandidateIdentity({
            send, stillCurrent: () => true, browserCookies: () => '',
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).toHaveBeenCalledTimes(1);
        let generation = true;
        const changed = vi.fn<typeof fetch>().mockImplementation(async () => {
            generation = false;
            return reply(identity());
        });
        await expect(readKindeCandidateIdentity({
            send: changed, stillCurrent: () => generation, browserCookies: cookie,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
    });
});
