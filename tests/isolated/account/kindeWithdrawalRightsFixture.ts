import { expect } from 'vitest';
import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';

export const uid = 'k_' + 'A'.repeat(43);
export const owner = 'user:' + uid;
export const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 as const };
export const marker = `logbook:v2:${owner}:health-consent-withdrawal`;
type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

export function browser(fixture: Fixture, inspect: (path: string, response: Response) => Response | Promise<Response> =
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
export async function provisionKey(fixture: Fixture): Promise<Uint8Array> {
    const response = await fixture.call(uid, '/v1/cloud-key/sync');
    expect(response.response.status).toBe(200);
    return new Uint8Array(Buffer.from(response.body.key, 'base64'));
}
