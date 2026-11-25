import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../legalVersions';
import { KindeCandidateBoundaryError } from '../auth/kindeCandidateClient';
import { inspectKindeCandidateReplicaRegistry } from './kindeCandidateReplicaRegistry';

vi.mock('../firebase', () => {
    throw Error('Read-only Kinde replica registry must not load Firebase');
});
vi.mock('./secureArchiveRepository', () => {
    throw Error('Read-only registry must not open or update IndexedDB');
});
vi.mock('./cloudflareAccountKeyCandidate', () => {
    throw Error('Read-only registry must not acquire the cloud ADK');
});

const UID = 'k_' + 'A'.repeat(43);
const OTHER = 'k_' + 'B'.repeat(43);
const CSRF = 'A'.repeat(43);
const browser = () => '__Host-logbook_csrf=' + CSRF;
const expected = { uid: UID, fenceEpoch: 1, healthConsentRevision: 1 };
const session = (uid = UID) => ({ authenticated: true, emailVerified: true, uid,
    fenceEpoch: 1, healthConsentRevision: 1 });
const consent = (uid = UID) => ({ uid, status: 'active', revision: 1, fenceEpoch: 1,
    acceptedAt: '2026-11-16T00:00:00.000Z',
    observedAtMs: Date.parse('2026-11-16T00:00:00.000Z'),
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms });
const json = (value: unknown, status = 200) => Response.json(value, {
    status, headers: { 'Cache-Control': 'no-store' },
});
const authorization = (uid = UID) => [json(session(uid)), json(consent(uid)), json(session(uid))];
const replica = (slot: number) => ({ status: 'active', replicaId: 'device-' + slot,
    generation: 1, leaseUntilMs: 1_800_000_000_000, checkpointAtMs: 1_790_000_000_000,
    lastSeq: slot, checkpointClock: { s00: 1 } });
const control = (uid = UID) => ({ uid, revision: 5, fenceEpoch: 1, consentRevision: 1,
    replicas: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
        's' + String(index).padStart(2, '0'), replica(index),
    ])),
});

function responses(...items: Response[]): typeof fetch {
    return vi.fn<typeof fetch>().mockImplementation(async () => {
        const response = items.shift();
        if (!response) throw new Error('Unexpected HTTP call');
        return response;
    });
}
function configured(first: unknown = control(), last: unknown = first): typeof fetch {
    return responses(...authorization(), json(first), ...authorization(), json(last));
}
const inspect = (send: typeof fetch, cookies = browser, stillCurrent = () => true) =>
    inspectKindeCandidateReplicaRegistry({ expected, send, browserCookies: cookies, stillCurrent });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('read-only Kinde replica registry before a slot claim', () => {
    it('reads a full five-member registry without a claim, ADK, vault or mutation', async () => {
        const send = configured();
        const observation = await inspect(send);
        expect(observation.kind).toBe('replica-registry-observed');
        expect(observation.control.uid).toBe(UID);
        expect(Object.keys(observation.control.replicas)).toHaveLength(5);
        expect(vi.mocked(send).mock.calls.map(([url]) => url)).toEqual([
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
            '/v1/sync/control',
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
            '/v1/sync/control',
        ]);
        for (const [url, options] of vi.mocked(send).mock.calls) {
            expect(url).not.toMatch(/cloud-key|scan|claim|retire|cancel|commit/);
            if (url === '/v1/sync/control') expect(options).toMatchObject({
                method: 'POST', credentials: 'include', mode: 'same-origin',
                cache: 'no-store', redirect: 'error',
            });
        }
        expect(localStorage.length).toBe(0);
    });

    it('rejects guest state, changed cookie and invalid caller generation before network', async () => {
        for (const flag of ['true', 'invalid']) {
            localStorage.setItem('logbook_is_guest', flag);
            const send = configured();
            await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
        }
        localStorage.clear();
        for (const cookies of ['', '__Host-logbook_csrf=invalid', browser() + '; ' + browser()]) {
            const send = configured();
            await expect(inspect(send, () => cookies)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
        }
        const send = configured();
        await expect(inspect(send, browser, () => false)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).not.toHaveBeenCalled();
    });

    it('never reads a registry without matching trusted identity and active consent', async () => {
        for (const send of [
            responses(json({ error: 'unauthorized' }, 401)),
            responses(json({ ...session(), emailVerified: false })),
            responses(json(session()), json({ ...consent(), status: 'withdrawn' }), json(session())),
            responses(json(session()), json(consent(OTHER)), json(session())),
            responses(json(session()), json(consent()), json(session(OTHER))),
        ]) {
            await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(vi.mocked(send).mock.calls.some(([url]) => url === '/v1/sync/control')).toBe(false);
        }
        const send = configured();
        await expect(inspectKindeCandidateReplicaRegistry({
            expected: { ...expected, uid: OTHER }, send,
            browserCookies: browser, stillCurrent: () => true,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(vi.mocked(send).mock.calls.some(([url]) => url === '/v1/sync/control')).toBe(false);
    });

    it('rejects an ownerless, foreign, wrong-epoch or malformed primary control', async () => {
        for (const raw of [
            { ...control(), uid: undefined }, control(OTHER),
            { ...control(), fenceEpoch: 2 }, { ...control(), consentRevision: 2 },
            { ...control(), replicas: { s16: replica(16) } },
        ]) {
            const send = configured(raw);
            await expect(inspect(send)).rejects.toThrow();
            expect(vi.mocked(send).mock.calls.filter(([url]) => url === '/v1/sync/control')).toHaveLength(1);
        }
    });

    it('drops an observation when the control changes during revalidation', async () => {
        const send = configured(control(), { ...control(), revision: 6 });
        await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(vi.mocked(send).mock.calls.filter(([url]) => url === '/v1/sync/control')).toHaveLength(2);
    });

    it('drops an observation when owner, epoch, consent or legal receipt changes', async () => {
        for (const tail of [
            authorization(OTHER),
            [json(session()), json({ ...consent(), acceptedAt: '2026-11-15T00:00:00.000Z' }), json(session())],
            [json(session()), json({ ...consent(), status: 'withdrawn' }), json(session())],
            [json(session()), json(consent()), json({ ...session(), fenceEpoch: 2 })],
        ]) {
            const send = responses(...authorization(), json(control()), ...tail, json(control()));
            await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(vi.mocked(send).mock.calls.filter(([url]) => url === '/v1/sync/control')).toHaveLength(1);
        }
    });

    it('drops in-flight results on cookie rotation or caller cancellation', async () => {
        let cookie = browser();
        let current = true;
        const source = configured();
        const send = vi.fn<typeof fetch>().mockImplementation(async (...args) => {
            const result = await source(...args);
            if (args[0] === '/v1/sync/control') cookie = '__Host-logbook_csrf=' + 'B'.repeat(43);
            return result;
        });
        await expect(inspect(send, () => cookie)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send.mock.calls.filter(([url]) => url === '/v1/sync/control')).toHaveLength(1);

        const source2 = configured();
        const send2 = vi.fn<typeof fetch>().mockImplementation(async (...args) => {
            const result = await source2(...args);
            if (args[0] === '/v1/sync/control') current = false;
            return result;
        });
        await expect(inspect(send2, browser, () => current)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send2.mock.calls.filter(([url]) => url === '/v1/sync/control')).toHaveLength(1);
    });
});
