import { describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../legalVersions';
import { KindeCandidateBoundaryError } from './kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from './kindeCandidateConsent';

const A = 'k_' + 'A'.repeat(43);
const B = 'k_' + 'B'.repeat(43);
const CSRF = 'A'.repeat(43);
const OTHER_CSRF = 'B'.repeat(42) + 'A';
const expectedOwner = { uid: A, fenceEpoch: 1 };
const decision = { acceptedHealthData: true, acceptedTerms: true, confirmsOver18: true };

function session(uid = A, revision = 0) {
    return { authenticated: true, uid, emailVerified: true, fenceEpoch: 1,
        healthConsentRevision: revision };
}
const unregistered = (uid = A) => ({ uid, status: 'unregistered', revision: 0, fenceEpoch: 1 });
const accepted = (uid = A) => ({
    uid, status: 'active', revision: 1, fenceEpoch: 1,
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
    acceptedAt: '2026-11-15T10:00:00.000Z',
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const replies = (...items: Array<Response | Error>) => vi.fn<typeof fetch>()
    .mockImplementation(async () => {
        const item = items.shift();
        if (item instanceof Error) throw item;
        if (!item) throw new Error('Unexpected HTTP request');
        return item;
    });
const preflight = () => [reply(session()), reply(unregistered()), reply(session())];
const readback = (uid = A) => [reply(session(uid, 1)), reply(accepted(uid)), reply(session(uid, 1))];
const cookie = () => '__Host-logbook_csrf=' + CSRF;

describe('Kinde D1 first health-consent candidate (no UI/production calls)', () => {
    it('requires the exact three voluntary decisions before any network request', async () => {
        for (const value of [
            { ...decision, acceptedHealthData: false },
            { ...decision, acceptedTerms: false },
            { ...decision, confirmsOver18: false },
            { ...decision, extra: true },
            null,
        ]) {
            const send = replies(...preflight());
            await expect(acceptKindeCandidateInitialConsent({
                expectedOwner, decision: value as typeof decision, send, stillCurrent: () => true,
                browserCookies: cookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
        }
    });

    it('rejects a valid preflight for a principal other than the one offered the consent form', async () => {
        for (const displayed of [{ ...expectedOwner, uid: B }, { ...expectedOwner, fenceEpoch: 2 }]) {
            const send = replies(...preflight());
            await expect(acceptKindeCandidateInitialConsent({
                decision, expectedOwner: displayed, send, stillCurrent: () => true, browserCookies: cookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send.mock.calls.map(([url]) => url))
                .toEqual(['/api/auth/session', '/v1/consent/status', '/api/auth/session']);
        }
    });

    it('sends only fixed legal versions and requires a trusted active readback', async () => {
        const send = replies(...preflight(), reply(accepted()), ...readback());
        await expect(acceptKindeCandidateInitialConsent({
            expectedOwner, decision, send, stillCurrent: () => true, browserCookies: cookie,
        })).resolves.toEqual({
            kind: 'consent-confirmed', principal: {
                uid: A, fenceEpoch: 1, healthConsentRevision: 1,
            },
            legalConsent: {
                hasAcceptedTerms: true, hasAcceptedHealthData: true,
                acceptedAt: '2026-11-15T10:00:00.000Z',
                privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
            },
        });
        expect(send).toHaveBeenCalledTimes(7);
        const [route, init] = send.mock.calls[3];
        expect(route).toBe('/v1/consent/initial');
        expect(init).toEqual(expect.objectContaining({
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: expect.objectContaining({ 'X-CSRF-Token': CSRF }),
        }));
        expect(JSON.parse(String(init?.body))).toEqual({
            action: 'accept-initial', expectedRevision: 0,
            acceptance: { ...decision, privacyVersion: LEGAL_VERSIONS.privacy,
                termsVersion: LEGAL_VERSIONS.terms },
        });
        expect(init).not.toHaveProperty('Authorization');
    });

    it('recovers only from a fresh authoritative server state after lost ACK or 503', async () => {
        for (const uncertain of [new Error('connection lost'), reply({ error: 'unavailable' }, 503)]) {
            const send = replies(...preflight(), uncertain, ...readback());
            await expect(acceptKindeCandidateInitialConsent({
                expectedOwner, decision, send, stillCurrent: () => true, browserCookies: cookie,
            })).resolves.toMatchObject({ kind: 'consent-confirmed', principal: { uid: A } });
            expect(send.mock.calls.filter(([url]) => url === '/v1/consent/initial')).toHaveLength(1);
        }
    });

    it('never upgrades a network error or a phantom 200 without confirmed consent', async () => {
        for (const uncertain of [
            new Error('connection lost'), reply(accepted()),
            reply({ error: 'unavailable' }, 503),
        ]) {
            const send = replies(...preflight(), uncertain,
                reply(session()), reply(unregistered()), reply(session()));
            await expect(acceptKindeCandidateInitialConsent({
                expectedOwner, decision, send, stillCurrent: () => true, browserCookies: cookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
    });

    it('rejects malformed success, missing CSRF, stale owner and replayed initial consent', async () => {
        for (const invalid of [
            { ...accepted(), uid: B },
            { ...accepted(), revision: 0 },
            { ...accepted(), privacyVersion: 'outdated' },
            { ...accepted(), acceptedAt: 'bad-timestamp' },
            { ...accepted(), injected: 'untrusted' },
        ]) {
            const send = replies(...preflight(), reply(invalid));
            await expect(acceptKindeCandidateInitialConsent({
                expectedOwner, decision, send, stillCurrent: () => true, browserCookies: cookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).toHaveBeenCalledTimes(4);
        }
        const badCsrf = replies(...preflight());
        await expect(acceptKindeCandidateInitialConsent({
            expectedOwner, decision, send: badCsrf, stillCurrent: () => true, browserCookies: () => '',
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(badCsrf).not.toHaveBeenCalled();

        for (const pre of [
            [reply({ error: 'unauthorized' }, 401)],
            [reply(session(A, 1)), reply(accepted()), reply(session(A, 1))],
        ]) {
            const send = replies(...pre);
            await expect(acceptKindeCandidateInitialConsent({
                expectedOwner, decision, send, stillCurrent: () => true, browserCookies: cookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send.mock.calls.some(([url]) => url === '/v1/consent/initial')).toBe(false);
        }
    });

    it('refuses session rotation, consent from another owner and unverified email', async () => {
        const cookieAfter = { value: cookie() };
        const send = replies(...preflight(), reply(accepted()), ...readback());
        const rotating = vi.fn<typeof fetch>().mockImplementation(async (route, init) => {
            const result = await send(route, init);
            if (route === '/v1/consent/initial') cookieAfter.value = '__Host-logbook_csrf=' + OTHER_CSRF;
            return result;
        });
        await expect(acceptKindeCandidateInitialConsent({
            expectedOwner, decision, send: rotating, stillCurrent: () => true,
            browserCookies: () => cookieAfter.value,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(rotating).toHaveBeenCalledTimes(4);

        const mixed = replies(...preflight(), reply(accepted()), ...readback(B));
        await expect(acceptKindeCandidateInitialConsent({
            expectedOwner, decision, send: mixed, stillCurrent: () => true, browserCookies: cookie,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        const unverified = replies(reply({ ...session(), emailVerified: false }));
        await expect(acceptKindeCandidateInitialConsent({
            expectedOwner, decision, send: unverified, stillCurrent: () => true, browserCookies: cookie,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
    });

    it('does not block explicit account consent solely because a guest archive exists', async () => {
        // A later, separate owner-scoped migration decides whether and when
        // to retire the guest archive; this request must never mutate it.
        localStorage.setItem('logbook_is_guest', 'true');
        try {
            const send = replies(...preflight(), reply(accepted()), ...readback());
            await expect(acceptKindeCandidateInitialConsent({
                expectedOwner, decision, send, stillCurrent: () => true, browserCookies: cookie,
            })).resolves.toMatchObject({ kind: 'consent-confirmed' });
            expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        } finally { localStorage.removeItem('logbook_is_guest'); }
    });
});
