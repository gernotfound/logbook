import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    KindeCandidateBoundaryError, inspectKindeCandidateReplicaControl, readKindeCandidateAccess,
    revokeKindeCandidateSession, submitKindeHostedSignIn,
} from './kindeCandidateClient';

const A = 'k_' + 'A'.repeat(43);
const B = 'k_' + 'B'.repeat(43);
const session = (uid = A, epoch = 1, consent = 0) => ({
    authenticated: true, uid, emailVerified: true,
    fenceEpoch: epoch, healthConsentRevision: consent,
});
const status = (state: string, revision: number, epoch = 1, uid = A) => ({
    uid, status: state, revision, fenceEpoch: epoch,
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
const cookie = () => '__Host-logbook_csrf=' + 'A'.repeat(43);
const read = (send: typeof fetch, stillCurrent = () => true) =>
    readKindeCandidateAccess({ send, stillCurrent, browserCookies: cookie });

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
        for (const [path, init] of send.mock.calls) {
            expect(init).toEqual(expect.objectContaining({
                method: 'POST', mode: 'same-origin', credentials: 'same-origin',
                cache: 'no-store', redirect: 'error',
                headers: path === '/v1/consent/status'
                    ? { Accept: 'application/json', 'X-CSRF-Token': 'A'.repeat(43) }
                    : { Accept: 'application/json' },
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

    it('reads only suspended consent one epoch ahead after terminal erasure', async () => {
        const terminal = responses(
            reply(session(A, 1, 2)), reply(status('withdrawn', 2, 2)),
            reply(session(A, 1, 2)),
        );
        await expect(read(terminal)).resolves.toEqual({
            kind: 'consent-suspended', status: 'withdrawn',
            principal: { uid: A, fenceEpoch: 1, healthConsentRevision: 2 },
        });
        for (const invalid of [
            status('active', 2, 2),
            status('deleting', 2, 2),
            status('deleted', 2, 2),
            status('withdrawn', 2, 3),
        ]) {
            await expect(read(responses(
                reply(session(A, 1, 2)), reply(invalid), reply(session(A, 1, 2)),
            ))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        await expect(read(responses(
            reply(session(A, 1, 3)), reply(status('withdrawn', 3, 2)),
            reply(session(A, 1, 3)),
        ))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
    });

    it('rejects cross-account and epoch changes between consent and session reads', async () => {
        for (const changed of [session(B, 1, 1), session(A, 2, 1), session(A, 1, 0)]) {
            await expect(read(responses(reply(session(A, 1, 1)), reply(status('active', 1)),
                reply(changed)))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
    });

    it('rejects A→B→A consent identity changes despite equal session epochs and revisions', async () => {
        for (const [state, consentRevision] of [
            ['unregistered', 0], ['active', 1], ['withdrawn', 1],
            ['deleting', 1], ['deleted', 1],
        ] as const) {
            const send = responses(
                reply(session(A, 1, consentRevision)),
                reply(status(state, consentRevision, 1, B)),
                reply(session(A, 1, consentRevision)),
            );
            await expect(read(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send.mock.calls.map(([path]) => path)).toEqual([
                '/api/auth/session', '/v1/consent/status', '/api/auth/session',
            ]);
        }
    });

    it('rejects old or malformed trusted consent UIDs for every status', async () => {
        for (const [state, consentRevision] of [
            ['unregistered', 0], ['active', 1], ['withdrawn', 1],
            ['deleting', 1], ['deleted', 1],
        ] as const) {
            for (const invalidUid of [
                undefined, null, '', 1, 'firebase-user',
                'k_' + 'A'.repeat(42), A + ' ', B,
            ]) {
                const send = responses(
                    reply(session(A, 1, consentRevision)),
                    reply({ ...status(state, consentRevision), uid: invalidUid }),
                    reply(session(A, 1, consentRevision)),
                );
                await expect(read(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
                expect(send).toHaveBeenCalledTimes(3);
            }
        }
    });

    it('rejects a stale caller generation immediately after the consent response', async () => {
        let current = true;
        const send = vi.fn<typeof fetch>().mockImplementation(async path => {
            if (path === '/v1/consent/status') {
                current = false;
                return reply(status('active', 1));
            }
            return reply(session(A, 1, 1));
        });
        await expect(read(send, () => current)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).toHaveBeenCalledTimes(2);
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
            await expect(read(responses(reply(session()), reply(invalid), reply(session())))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
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

    it('reads Kinde consent and D1 control without granting a key or replica', async () => {
        const control = { uid: A, revision: 0, fenceEpoch: 1, consentRevision: 1, replicas: {} };
        const send = responses(
            reply(session(A, 1, 1)), reply(status('active', 1)), reply(session(A, 1, 1)),
            reply(control),
            reply(session(A, 1, 1)), reply(status('active', 1)), reply(session(A, 1, 1)),
        );
        await expect(inspectKindeCandidateReplicaControl({ send, stillCurrent: () => true, browserCookies: cookie }))
            .resolves.toEqual({ kind: 'replica-control-observed',
                principal: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 }, control });
        expect(send.mock.calls.map(([path]) => path)).toEqual([
            '/api/auth/session', '/v1/consent/status', '/api/auth/session', '/v1/sync/control',
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
        ]);
        const noConsent = responses(reply(session()), reply(status('unregistered', 0)), reply(session()));
        await expect(inspectKindeCandidateReplicaControl({ send: noConsent, stillCurrent: () => true, browserCookies: cookie }))
            .resolves.toMatchObject({ kind: 'consent-required' });
        expect(noConsent).toHaveBeenCalledTimes(3);
    });

    it('refuses an owner switch, epoch change, stale control or temporary outage', async () => {
        const control = { uid: A, revision: 0, fenceEpoch: 1, consentRevision: 1, replicas: {} };
        for (const changed of [session(B, 1, 1), session(A, 2, 1), session(A, 1, 0)]) {
            const send = responses(reply(session(A, 1, 1)), reply(status('active', 1)),
                reply(session(A, 1, 1)), reply(control), reply(changed));
            await expect(inspectKindeCandidateReplicaControl({ send, stillCurrent: () => true, browserCookies: cookie }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        const stale = responses(reply(session(A, 1, 1)), reply(status('active', 1)),
            reply(session(A, 1, 1)), reply({ ...control, fenceEpoch: 2 }),
            reply(session(A, 1, 1)), reply(status('active', 1)), reply(session(A, 1, 1)));
        await expect(inspectKindeCandidateReplicaControl({ send: stale, stillCurrent: () => true, browserCookies: cookie }))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        const outage = responses(reply(session(A, 1, 1)), reply(status('active', 1)),
            reply(session(A, 1, 1)), reply({ error: 'unavailable' }, 503));
        await expect(inspectKindeCandidateReplicaControl({ send: outage, stillCurrent: () => true, browserCookies: cookie }))
            .rejects.toMatchObject({ status: 503 });
        // A→B→A can preserve the same consent/revision and epoch. Only
        // the UID from the middle authenticated control read exposes B.
        for (const middleControl of [{ ...control, uid: B }, {
            revision: control.revision, fenceEpoch: control.fenceEpoch,
            consentRevision: control.consentRevision, replicas: {},
        }]) {
            const mixed = responses(
                reply(session(A, 1, 1)), reply(status('active', 1)), reply(session(A, 1, 1)),
                reply(middleControl),
                reply(session(A, 1, 1)), reply(status('active', 1)), reply(session(A, 1, 1)),
            );
            await expect(inspectKindeCandidateReplicaControl({ send: mixed, stillCurrent: () => true, browserCookies: cookie }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(mixed).toHaveBeenCalledTimes(7);
        }
    });

    it('requires a browser-bound cookie for authentication but accepts a canonical signed-out 401', async () => {
        const authorized = responses(reply(session()));
        await expect(readKindeCandidateAccess({
            send: authorized, stillCurrent: () => true, browserCookies: () => '',
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(authorized).toHaveBeenCalledTimes(1);
        const signedOut = responses(reply({ error: 'unauthorized' }, 401));
        await expect(readKindeCandidateAccess({
            send: signedOut, stillCurrent: () => true, browserCookies: () => '',
        })).resolves.toEqual({ kind: 'signed-out' });
    });

    it('rejects malformed, duplicated or ambiguous cookies before network', async () => {
        for (const value of [
            '__Host-logbook_csrf=bad',
            cookie() + '; __Host-logbook_csrf=' + 'B'.repeat(43),
            '__Host-logbook_csrf_extra=malformed',
            'x'.repeat(4097),
        ]) {
            const send = responses(reply(session()));
            await expect(readKindeCandidateAccess({
                send, stillCurrent: () => true, browserCookies: () => value,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
        }
    });

    it('rejects equal claims from a new session rotated on the first status read', async () => {
        let browser = cookie();
        const send = vi.fn<typeof fetch>().mockImplementation(async path => {
            if (path === '/api/auth/session') {
                browser = '__Host-logbook_csrf=' + 'B'.repeat(43);
                return reply(session(A, 1, 1));
            }
            return reply(status('active', 1));
        });
        await expect(readKindeCandidateAccess({
            send, stillCurrent: () => true, browserCookies: () => browser,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('rejects equal claims after a cookie rotation on consent before final status', async () => {
        let browser = cookie();
        const send = vi.fn<typeof fetch>().mockImplementation(async path => {
            if (path === '/v1/consent/status') {
                browser = '__Host-logbook_csrf=' + 'B'.repeat(43);
                return reply(status('active', 1));
            }
            return reply(session(A, 1, 1));
        });
        await expect(readKindeCandidateAccess({
            send, stillCurrent: () => true, browserCookies: () => browser,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send.mock.calls.map(([path]) => path))
            .toEqual(['/api/auth/session', '/v1/consent/status']);
    });

    it('rejects a new browser incarnation between replica-control and equal status readbacks', async () => {
        let browser = cookie();
        const control = { uid: A, revision: 0, fenceEpoch: 1, consentRevision: 1, replicas: {} };
        const send = vi.fn<typeof fetch>().mockImplementation(async path => {
            if (path === '/v1/sync/control') {
                browser = '__Host-logbook_csrf=' + 'B'.repeat(43);
                return reply(control);
            }
            if (path === '/v1/consent/status') return reply(status('active', 1));
            return reply(session(A, 1, 1));
        });
        await expect(inspectKindeCandidateReplicaControl({
            send, stillCurrent: () => true, browserCookies: () => browser,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send.mock.calls.map(([path]) => path))
            .toEqual(['/api/auth/session', '/v1/consent/status', '/api/auth/session', '/v1/sync/control']);
    });

    it('rejects a replacement logout cookie before sending any request', async () => {
        const send = responses();
        await expect(revokeKindeCandidateSession({
            expectedCsrfToken: 'A'.repeat(43), send, stillCurrent: () => true,
            browserCookies: () => '__Host-logbook_csrf=' + 'B'.repeat(42) + 'A',
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).not.toHaveBeenCalled();
    });

    it('requires CSRF-bound server logout and a fresh session 401 before reporting revocation', async () => {
        const csrf = 'A'.repeat(43);
        const send = responses(reply({ status: 'signed-out' }), reply({ error: 'unauthorized' }, 401));
        await expect(revokeKindeCandidateSession({
            expectedCsrfToken: 'A'.repeat(43), send, stillCurrent: () => true,
            browserCookies: () => '__Host-logbook_csrf=' + csrf + '; unrelated=1',
        })).resolves.toBeUndefined();
        expect(send.mock.calls.map(([path]) => path))
            .toEqual(['/api/auth/logout', '/api/auth/session']);
        expect(send.mock.calls[0][1]).toEqual(expect.objectContaining({
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
        }));
        expect(send.mock.calls[0][1]).not.toHaveProperty('body');
        expect(send.mock.calls[0][1]).not.toHaveProperty('Authorization');
    });

    it('refuses missing, forged or ambiguous CSRF cookies before reaching the server', async () => {
        const csrf = 'A'.repeat(43);
        for (const cookies of [
            '', 'unrelated=x', '__Host-logbook_csrf=short',
            '__Host-logbook_csrf=' + csrf + '; __Host-logbook_csrf=' + csrf,
            '__Host-logbook_csrf=' + 'X'.repeat(5000),
        ]) {
            const send = responses();
            await expect(revokeKindeCandidateSession({
                expectedCsrfToken: 'A'.repeat(43), send, stillCurrent: () => true, browserCookies: () => cookies,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
        }
    });

    it('never treats an ambiguous logout result or an active replacement session as signed out', async () => {
        const cookies = () => '__Host-logbook_csrf=' + 'A'.repeat(43);
        for (const responsesAfterLogout of [
            [reply({ status: 'signed-out' }), reply(session(B, 1, 1))],
            [reply({ status: 'signed-out' }), reply({ error: 'unavailable' }, 503)],
            [reply({ status: 'signed-out' }), reply({ error: 'unknown' }, 401)],
            [reply({ status: 'pending' })],
            [reply({ status: 'signed-out', uid: A })],
            [reply({ error: 'unauthorized' }, 403)],
            [reply({ error: 'unavailable' }, 503)],
        ]) {
            const send = responses(...responsesAfterLogout);
            await expect(revokeKindeCandidateSession({
                expectedCsrfToken: 'A'.repeat(43), send, stillCurrent: () => true, browserCookies: cookies,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        const lostAck = responses();
        await expect(revokeKindeCandidateSession({
            expectedCsrfToken: 'A'.repeat(43), send: lostAck, stillCurrent: () => true, browserCookies: cookies,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        // The caller must preserve the vault until the server state is proven.
    });

    it('does not accept a stale UI generation after the remote logout response', async () => {
        let current = true;
        const send = vi.fn<typeof fetch>().mockImplementation(async () => {
            current = false;
            return reply({ status: 'signed-out' });
        });
        await expect(revokeKindeCandidateSession({
            expectedCsrfToken: 'A'.repeat(43), send, stillCurrent: () => current,
            browserCookies: () => '__Host-logbook_csrf=' + 'A'.repeat(43),
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).toHaveBeenCalledTimes(1);
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
