import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde rights and withdrawal must not import Firebase');
});

import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { KindeCandidateBoundaryError, readKindeCandidateAccess } from '../../../src/lib/auth/kindeCandidateClient';
import { withdrawKindeCandidateHealthConsent } from '../../../src/lib/auth/kindeCandidateWithdrawal';
import { withKindeCandidateRightsKey } from '../../../src/lib/auth/kindeCandidateRightsKey';
import { isKindeAccountLocalFitnessClear } from '../../../src/lib/sync/kindeOwnerLocalFitnessFence';

const uid = 'k_' + 'A'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 as const };
const marker = `logbook:v2:${owner}:health-consent-withdrawal`;
type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

function browser(fixture: Fixture, inspect: (path: string, response: Response) => Response | Promise<Response> =
    (_path, response) => response) {
    let cookie = '__Host-logbook_csrf=' + fixture.sessions.get(uid).csrf;
    const browserCookies = () => cookie;
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', fixture.sessions.get(uid).cookies);
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        const response = await routeCandidateFirstPartyApi(new Request(ORIGIN + path, {
            ...init, headers,
        }), {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (req: Request) => kinde.fetch(req, env) },
            D1_API: { fetch: (req: Request) => api.fetch(req, env) },
        });
        return inspect(path, response);
    };
    return { send, browserCookies, stillCurrent: () => true,
        replaceCookie(value: string) { cookie = value; } };
}
async function provisionKey(fixture: Fixture): Promise<Uint8Array> {
    const response = await fixture.call(uid, '/v1/cloud-key/sync');
    expect(response.response.status).toBe(200);
    return new Uint8Array(Buffer.from(response.body.key, 'base64'));
}
afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('Kinde withdrawal and rights-only client against first-party Workers and D1 SQL', () => {
    it('fences the owner before withdrawal, proves a queued job, preserves rights key and never reopens fitness', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const key = await provisionKey(fixture);
            const observedPaths: string[] = [];
            const client = browser(fixture, (path, response) => {
                observedPaths.push(path);
                if (path === '/v1/consent/withdraw') {
                    expect(localStorage.getItem(marker)).toBe('pending:1');
                    expect(isKindeAccountLocalFitnessClear(owner, 1)).toBe(false);
                }
                return response;
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).resolves.toEqual({ kind: 'withdrawal-recorded', deletionStatus: 'pending' });
            expect(observedPaths.filter(path => path === '/v1/consent/withdraw')).toHaveLength(1);
            expect(localStorage.getItem(marker)).toBe('withdrawn');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            const suspended = await readKindeCandidateAccess(client);
            expect(suspended).toMatchObject({ kind: 'consent-suspended', status: 'withdrawn' });
            expect((await fixture.call(uid, '/v1/cloud-key/sync')).response.status).not.toBe(200);

            let borrowed: Uint8Array | undefined;
            const used = await withKindeCandidateRightsKey({
                ...client, expected,
                useKey: async (adk, current) => {
                    expect(current()).toBe(true);
                    borrowed = adk;
                    return adk.slice();
                },
            });
            expect(used).toEqual(key);
            expect(borrowed).toEqual(new Uint8Array(32));
            expect(localStorage.getItem(marker)).toBe('withdrawn');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });

    it('keeps the durable fence and never automatically replays a POST after a lost response', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            await provisionKey(fixture);
            let withdrawCalls = 0;
            const client = browser(fixture, (path, response) => {
                if (path === '/v1/consent/withdraw') {
                    withdrawCalls += 1;
                    expect(response.status).toBe(200);
                    throw new TypeError('HTTP reply lost after D1 commit');
                }
                return response;
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(localStorage.getItem(marker)).toBe('pending:1');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(withdrawCalls).toBe(1);
            await expect(withKindeCandidateRightsKey({
                ...client, expected, useKey: async key => key.slice(),
            })).resolves.toHaveLength(32);
            expect(localStorage.getItem(marker)).toBe('pending:1');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });

    it('rejects malformed response and changed CSRF while retaining the pending decision', async () => {
        for (const mode of ['malformed', 'rotated'] as const) {
            localStorage.clear();
            const fixture = await createCloudKeyHttpFixture([uid]);
            try {
                await fixture.consent(uid);
                let client: ReturnType<typeof browser>;
                client = browser(fixture, (path, response) => {
                    if (path !== '/v1/consent/withdraw') return response;
                    if (mode === 'rotated') {
                        client.replaceCookie('__Host-logbook_csrf=' + 'B'.repeat(43));
                        return response;
                    }
                    return Response.json({ status: 'withdrawn', deletionStatus: 'complete' },
                        { headers: { 'Cache-Control': 'no-store' } });
                });
                await expect(withdrawKindeCandidateHealthConsent({
                    ...client, expected, confirmsErasure: true,
                })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
                expect(localStorage.getItem(marker)).toBe('pending:1');
                expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            } finally {
                fixture.close();
            }
        }
    });

    it('does not request withdrawal without explicit decision, with guest data, or if local fence storage fails', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const sent: string[] = [];
            const client = browser(fixture, (path, response) => {
                sent.push(path);
                return response;
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: false,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(sent).toHaveLength(0);
            localStorage.setItem('logbook_is_guest', 'true');
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(sent).toHaveLength(0);
            localStorage.removeItem('logbook_is_guest');

            const original = localStorage.setItem.bind(localStorage);
            const rejectWrite = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
                if (key === marker) throw new Error('localStorage quota exceeded');
                return original(key, value);
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toThrow();
            expect(sent).not.toContain('/v1/consent/withdraw');
            rejectWrite.mockRestore();
            expect(fixture.count('health_erasure_jobs', uid)).toBe(0);
        } finally {
            fixture.close();
        }
    });

    it('rights-only cannot provision a new ADK after withdrawal or grant rights while consent is active', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            let keyCalls = 0;
            await expect(withKindeCandidateRightsKey({
                ...client, expected, useKey: async () => { keyCalls += 1; },
            })).rejects.toThrow();
            expect(keyCalls).toBe(0);
            await fixture.withdraw(uid);
            await expect(withKindeCandidateRightsKey({
                ...client, expected, useKey: async () => { keyCalls += 1; },
            })).rejects.toThrow();
            expect(keyCalls).toBe(0);
            expect(fixture.count('cloud_account_keys', uid)).toBe(0);
        } finally {
            fixture.close();
        }
    });

    it('zeroes a borrowed rights key after an async session replacement', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            await provisionKey(fixture);
            await fixture.withdraw(uid);
            const client = browser(fixture);
            let borrowed: Uint8Array | undefined;
            await expect(withKindeCandidateRightsKey({
                ...client, expected, useKey: async key => {
                    borrowed = key;
                    client.replaceCookie('__Host-logbook_csrf=' + 'B'.repeat(43));
                },
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(borrowed).toEqual(new Uint8Array(32));
        } finally {
            fixture.close();
        }
    });
});
