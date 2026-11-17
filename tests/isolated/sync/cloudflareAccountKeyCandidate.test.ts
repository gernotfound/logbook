import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireCloudflareAccountKeyCandidate } from '../../../src/lib/sync/cloudflareAccountKeyCandidate';
import * as material from '../../../src/lib/sync/cloudAccountKeyMaterial';

vi.mock('../../../src/lib/firebase', () => { throw new Error('Candidate key transport must not initialize Firebase'); });

const UID = 'k_' + 'a'.repeat(43);
const OTHER = 'k_' + 'b'.repeat(43);
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const expected = { uid: UID, fenceEpoch: 2, consentRevision: 1 };
const csrf = Buffer.alloc(32, 23).toString('base64url');
const payload = () => ({ ...expected, purpose: 'sync',
    format: 'thelogbook-account-data-key', version: 1, key: Buffer.from(key).toString('base64') });
const json = (value: unknown = payload(), headers: Record<string, string> = {}) =>
    Response.json(value, { headers: { 'cache-control': 'no-store', ...headers } });
const options = (send: typeof fetch) => ({
    expected: { ...expected }, purpose: 'sync' as const, stillCurrent: () => true,
    csrfToken: () => csrf, send,
});
const unsafeHeaders: Record<string, string>[] = [
    { 'cache-control': 'public, max-age=60' }, { 'content-type': 'text/html' },
    { 'content-length': '1025' }, { 'content-length': '-1' },
];
async function failure(promise: Promise<unknown>, retryable = false) {
    const error = await promise.catch(error => error);
    expect(error).toBeInstanceOf(material.CloudKeyAccessUnavailableError);
    expect(error).toMatchObject({ code: 'cloud-key-unavailable', retryable });
    expect(error).not.toHaveProperty('cause');
    return error as material.CloudKeyAccessUnavailableError;
}
afterEach(() => vi.restoreAllMocks());

describe('candidate Workers account-key transport', () => {
    it('fetches a fresh owner-bound key for each operation, without Firebase or a cache', async () => {
        const send = vi.fn<typeof fetch>().mockImplementation(async () => json());
        const first = await acquireCloudflareAccountKeyCandidate(options(send));
        const second = await acquireCloudflareAccountKeyCandidate(options(send));
        expect(first).toEqual(key);
        expect(second).toEqual(key);
        expect(second).not.toBe(first);
        expect(send).toHaveBeenCalledTimes(2);
        const [url, init] = send.mock.calls[0];
        expect(url).toBe('/v1/cloud-key/sync');
        expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error' });
        expect(init?.body).toBeUndefined();
        expect(new Headers(init?.headers).get('x-csrf-token')).toBe(csrf);
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
        expect(new Headers(init?.headers).get('x-firebase-appcheck')).toBeNull();
        first.fill(0); second.fill(0);
    });

    it('keeps rights-only purpose distinct from sync and does not accept a cross-purpose response', async () => {
        const send = vi.fn<typeof fetch>().mockImplementation(async () => json({ ...payload(), purpose: 'rights-export' }));
        const rights = { ...options(send), purpose: 'rights-export' as const };
        expect(await acquireCloudflareAccountKeyCandidate(rights)).toEqual(key);
        expect(send.mock.calls[0][0]).toBe('/v1/cloud-key/rights-export');
        await failure(acquireCloudflareAccountKeyCandidate(options(send)));
    });

    it.each([
        { uid: OTHER }, { fenceEpoch: 3 }, { consentRevision: 2 }, { purpose: 'rights-export' },
        { version: 2 }, { format: 'unknown' }, { extra: true }, { key: 'not-base64' },
        { key: 'A'.repeat(42) + 'B=' },
    ])('rejects mismatched identity, generation, purpose or key: %j', async changed => {
        const send = vi.fn<typeof fetch>().mockImplementation(async () => json({ ...payload(), ...changed }));
        await failure(acquireCloudflareAccountKeyCandidate(options(send)));
    });

    it.each([null, [], {}, { format: 'thelogbook-account-data-key', version: 1, key: 'A'.repeat(43) + '=' }])(
        'rejects absent, partial and old unbound payloads: %j', async body => {
            await failure(acquireCloudflareAccountKeyCandidate(options(async () => json(body))));
        });

    it.each([
        { uid: '' }, { uid: 'owner-a' }, { fenceEpoch: 0 }, { fenceEpoch: 1.5 }, { consentRevision: 0 },
    ])('rejects invalid captured context before network I/O: %j', async changed => {
        const send = vi.fn<typeof fetch>();
        await failure(acquireCloudflareAccountKeyCandidate({ ...options(send), expected: { ...expected, ...changed } }));
        expect(send).not.toHaveBeenCalled();
    });

    it.each([null, '', 'forged', 'a'.repeat(44)])('requires a CSRF token before sending a key request: %j', async token => {
        const send = vi.fn<typeof fetch>();
        await failure(acquireCloudflareAccountKeyCandidate({ ...options(send), csrfToken: () => token }));
        expect(send).not.toHaveBeenCalled();
    });

    it('blocks unreadable local guards and an epoch switch during CSRF lookup before the request', async () => {
        const send = vi.fn<typeof fetch>();
        await failure(acquireCloudflareAccountKeyCandidate({ ...options(send), stillCurrent: () => { throw Error('private identity detail'); } }));
        let current = true;
        await failure(acquireCloudflareAccountKeyCandidate({ ...options(send),
            stillCurrent: () => current, csrfToken: () => { current = false; return csrf; } }));
        expect(send).not.toHaveBeenCalled();
    });

    it('rejects A→B→A during fetch and fences the same change on the network-error path', async () => {
        for (const networkError of [false, true]) {
            let generation = 1;
            const send: typeof fetch = async () => {
                generation += 2;
                if (networkError) throw new TypeError('private transport detail');
                return json();
            };
            await failure(acquireCloudflareAccountKeyCandidate({ ...options(send), stillCurrent: () => generation === 1 }));
        }
    });

    it('does not let a mutable caller context replace the captured owner while awaiting a response', async () => {
        const context = { ...expected };
        const send: typeof fetch = async () => { context.uid = OTHER; return json({ ...payload(), uid: OTHER }); };
        await failure(acquireCloudflareAccountKeyCandidate({ ...options(send), expected: context }));
    });

    it('fences session/consent changes while the response body is being read', async () => {
        let current = true;
        let reads = 0;
        const body = new TextEncoder().encode(JSON.stringify(payload()));
        const response = new Response(new ReadableStream({
            pull(controller) { reads += 1; current = false; controller.enqueue(body); controller.close(); },
        }, { highWaterMark: 0 }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        await failure(acquireCloudflareAccountKeyCandidate({ ...options(async () => response), stillCurrent: () => current }));
        expect(reads).toBe(1);
    });

    it('wipes decoded key bytes when the final fence becomes stale', async () => {
        let current = true;
        const decoded = key.slice();
        vi.spyOn(material, 'decodeCloudAccountKey').mockImplementationOnce(() => { current = false; return decoded; });
        await failure(acquireCloudflareAccountKeyCandidate({ ...options(async () => json()), stillCurrent: () => current }));
        expect(Array.from(decoded)).toEqual(Array(32).fill(0));
    });

    it.each([408, 429, 500, 502, 503, 504])('keeps HTTP %s retryable without returning any key', async status => {
        await failure(acquireCloudflareAccountKeyCandidate(options(async () => new Response(null, { status }))), true);
    });
    it.each([201, 204, 400, 401, 403, 404, 409, 428, 501])('keeps HTTP %s terminal', async status => {
        await failure(acquireCloudflareAccountKeyCandidate(options(async () => new Response(null, { status }))));
    });
    it('marks network failures retryable without exposing their contents', async () => {
        const error = await failure(acquireCloudflareAccountKeyCandidate(options(async () => {
            throw new TypeError('sensitive network details');
        })), true);
        expect(error.message).not.toContain('sensitive');
    });

    it.each(unsafeHeaders)('rejects unsafe key response headers: %j', async headers => {
        await failure(acquireCloudflareAccountKeyCandidate(options(async () => json(payload(), headers))));
    });

    it('rejects streamed overflow, malformed JSON and invalid UTF-8 as terminal', async () => {
        for (const body of [new Uint8Array(1025), new TextEncoder().encode('{invalid'), new Uint8Array([0xff])]) {
            const response = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
            await failure(acquireCloudflareAccountKeyCandidate(options(async () => response)));
        }
    });

    it.each(['redirected', 'opaque', 'opaqueredirect', 'error'])('rejects an untrusted response type: %s', async kind => {
        const response = json();
        Object.defineProperty(response, kind === 'redirected' ? 'redirected' : 'type',
            { value: kind === 'redirected' ? true : kind });
        await failure(acquireCloudflareAccountKeyCandidate(options(async () => response)));
    });

    it('clears a decoded noncanonical key before rejecting it', () => {
        const wiped: Uint8Array[] = [];
        const fill = Uint8Array.prototype.fill;
        vi.spyOn(Uint8Array.prototype, 'fill').mockImplementation(function(this: Uint8Array, ...args: Parameters<typeof fill>) {
            const result = fill.apply(this, args);
            if (this.length === 32) wiped.push(this);
            return result;
        });
        expect(() => material.decodeCloudAccountKey('A'.repeat(42) + 'B=')).toThrow(material.CloudKeyAccessUnavailableError);
        expect(wiped).toHaveLength(1);
        expect(Array.from(wiped[0])).toEqual(Array(32).fill(0));
    });

    it('accepts a maximally fragmented valid JSON response', async () => {
        const body = new TextEncoder().encode(JSON.stringify(payload()));
        let index = 0;
        const response = new Response(new ReadableStream({
            pull(controller) {
                if (index === body.length) controller.close();
                else controller.enqueue(body.slice(index, ++index));
            },
        }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
        expect(await acquireCloudflareAccountKeyCandidate(options(async () => response))).toEqual(key);
    });

    it('bounds a stalled response body by the request deadline and cancels it', async () => {
        const controller = new AbortController();
        vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal);
        let cancelled = false;
        const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }),
            { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        const pending = acquireCloudflareAccountKeyCandidate(options(async () => response));
        await vi.waitFor(() => expect(response.body?.locked).toBe(true));
        controller.abort(new DOMException('Timed out', 'TimeoutError'));
        await failure(pending, true);
        expect(cancelled).toBe(true);
        expect(AbortSignal.timeout).toHaveBeenCalledWith(12_000);
    });
});
