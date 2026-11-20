import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
const claimSource = vi.hoisted(() => ({ claim: vi.fn() }));
vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde device bootstrap must not import Firebase');
});
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));
vi.mock('../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
    () => ({ claimKindeCandidateReplica: claimSource.claim }));

export const bootstrapMocks = { catalogSource, claimSource };

import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

export const uid = 'k_' + 'A'.repeat(43);
export const owner = 'user:' + uid;
export const principal = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
export const cookie = () => '__Host-logbook_csrf=' + 'A'.repeat(43);
export const legal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-16T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const cloudKey = new Uint8Array(32).fill(49);
export const catalog = {
    manifest: { version: 'bootstrap-synthetic', updatedAt: '2026-11-18T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};

export function server(mode: 'active' | 'unregistered' | 'withdrawn' | 'unverified' | 'scan-error' = 'active'): typeof fetch {
    return vi.fn<typeof fetch>().mockImplementation(async path => {
        const json = (value: unknown, status = 200) => Response.json(value, {
            status, headers: { 'Cache-Control': 'no-store' },
        });
        if (path === '/api/auth/session') return json({ authenticated: true, ...principal,
            emailVerified: mode !== 'unverified' });
        if (path === '/v1/consent/status') return mode === 'unregistered'
            ? json({ uid, status: 'unregistered', revision: 0, fenceEpoch: 1 })
            : mode === 'withdrawn' ? json({ uid, status: 'withdrawn', revision: 1, fenceEpoch: 1 })
                : json({ uid, status: 'active', revision: 1, fenceEpoch: 1,
                    acceptedAt: legal.acceptedAt, privacyVersion: legal.privacyVersion,
                    termsVersion: legal.termsVersion });
        if (path === '/v1/cloud-key/sync') return json({
            format: 'thelogbook-account-data-key', version: 1, uid,
            fenceEpoch: 1, consentRevision: 1, purpose: 'sync',
            key: btoa(String.fromCharCode(...cloudKey)),
        });
        if (path === '/v1/sync/scan') {
            if (mode === 'scan-error') return json({ error: 'unavailable' }, 503);
            return json({ revision: 0, fenceEpoch: 1, consentRevision: 1,
                complete: true, nextAfter: null, documents: [] });
        }
        throw Error('Unexpected route ' + String(path));
    });
}

export async function start(send: typeof fetch, cookies = cookie, stillCurrent = () => true) {
    return prepareKindeCandidateOwner({ expected: principal, send, browserCookies: cookies, stillCurrent });
}

type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;
export function firstPartySession(fixture: Fixture, observe: (path: string, init: RequestInit | undefined,
    response: Response) => Response | Promise<Response>) {
    const session = fixture.sessions.get(uid);
    const browserCookies = () => '__Host-logbook_csrf=' + session.csrf;
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', session.cookies);
        const response = await routeCandidateFirstPartyApi(new Request(ORIGIN + path, {
            ...init, headers,
        }), {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
            D1_API: { fetch: (request: Request) => api.fetch(request, env) },
        });
        return observe(path, init, response);
    };
    return { send, browserCookies, stillCurrent: () => true };
}

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.resetAllMocks();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback(),
    } });
    catalogSource.read.mockResolvedValue(catalog);
    claimSource.claim.mockResolvedValue('reconciliation-required');
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

