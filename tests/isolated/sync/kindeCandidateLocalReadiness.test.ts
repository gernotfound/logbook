import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde readiness must not initialize the Firebase account runtime');
});
const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: catalogSource.read,
}));

import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { withKindeCandidateLocalReadiness } from '../../../src/lib/auth/kindeCandidateLocalReadiness';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { isVaultUnlocked, lockAllVaults, readVaultControl } from '../../../src/lib/sync/secureArchiveSession';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';

const uid = 'k_' + 'R'.repeat(43);
const otherUid = 'k_' + 'S'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const catalog = {
    manifest: { version: 'cf05-local-readiness', updatedAt: '2026-11-20T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};
type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

function browser(fixture: Fixture, account: string = uid) {
    const session = fixture.sessions.get(account);
    if (!session) throw Error('No test session');
    let csrfCookie = '__Host-logbook_csrf=' + session.csrf;
    const paths: string[] = [];
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        paths.push(path);
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', session.cookies);
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        return routeCandidateFirstPartyApi(new Request(ORIGIN + path, {
            ...init, headers,
        }), {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
            D1_API: { fetch: (request: Request) => api.fetch(request, env) },
        });
    };
    return {
        send, paths,
        browserCookies: () => csrfCookie,
        stillCurrent: () => true,
        replaceCookie: () => { csrfCookie = '__Host-logbook_csrf=' + 'Z'.repeat(43); },
    };
}

beforeEach(async () => {
    lockAllVaults();
    await clear();
    localStorage.clear();
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _opts: unknown, work: () => Promise<unknown>) => work(),
    } });
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('CF-05 Kinde candidate local readiness is only a short-lived scope', () => {
    it('opens only after trusted consent, D1 hydration and replica ACK; never installs a global owner', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const observed = await withKindeCandidateLocalReadiness({
                ...client, expected,
            }, async ready => {
                expect(ready.owner).toBe(owner);
                expect(ready.access.principal).toEqual(expected);
                expect(ready.isCurrent()).toBe(true);
                expect(isVaultUnlocked(owner)).toBe(true);
                expect(authenticatedIdentitySource.hasReader()).toBe(false);
                const local = await readLocal(owner);
                expect(local?.pending).toEqual([]);
                expect(local?.replica?.slot).toBe(local?.actorId);
                return local?.replica?.replicaId;
            });
            expect(observed).toBeTypeOf('string');
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(authenticatedIdentitySource.readUid()).toBeNull();
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            expect(client.paths).toContain('/v1/consent/status');
            expect(client.paths).toContain('/v1/sync/replica/claim');
        } finally {
            fixture.close();
        }
    });

    it('rejects revoked local fitness without network activity or vault provisioning', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            const client = browser(fixture);
            localStorage.setItem('logbook:v2:' + owner + ':health-consent-withdrawal', 'pending:1');
            const visited = vi.fn();
            await expect(withKindeCandidateLocalReadiness({
                ...client, expected,
            }, visited)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(client.paths).toEqual([]);
            expect(visited).not.toHaveBeenCalled();
            expect(readVaultControl(owner)).toBeNull();
        } finally {
            fixture.close();
        }
    });

    it('revokes readiness on cookie replacement even if the UID is unchanged', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            await expect(withKindeCandidateLocalReadiness({
                ...client, expected,
            }, async ready => {
                client.replaceCookie();
                expect(ready.isCurrent()).toBe(false);
                return 'not-authorized';
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it('does not retain an unlocked vault when the consumer fails or consent is withdrawn mid-scope', async () => {
        const fixture = await createCloudKeyHttpFixture([uid, otherUid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            await expect(withKindeCandidateLocalReadiness({
                ...client, expected,
            }, async () => {
                throw new Error('Synthetic caller failure');
            })).rejects.toThrow('Synthetic caller failure');
            expect(isVaultUnlocked(owner)).toBe(false);

            await expect(withKindeCandidateLocalReadiness({
                ...client, expected,
            }, async ready => {
                localStorage.setItem('logbook:v2:' + owner + ':health-consent-withdrawal', 'pending:1');
                expect(ready.isCurrent()).toBe(false);
                return 'not-authorized';
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it('refuses a concurrent authenticated provider before touching any cloud or vault state', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        const dispose = authenticatedIdentitySource.install(() => ({ uid: otherUid }));
        try {
            const client = browser(fixture);
            const visit = vi.fn();
            await expect(withKindeCandidateLocalReadiness({
                ...client, expected,
            }, visit)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(client.paths).toEqual([]);
            expect(visit).not.toHaveBeenCalled();
            expect(readVaultControl(owner)).toBeNull();
        } finally {
            dispose();
            fixture.close();
        }
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });

    it('rejects an authenticated different UID before publishing local readiness', async () => {
        const fixture = await createCloudKeyHttpFixture([uid, otherUid]);
        try {
            await fixture.consent(otherUid);
            const client = browser(fixture, otherUid);
            const visited = vi.fn();
            await expect(withKindeCandidateLocalReadiness({
                ...client, expected,
            }, visited)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(visited).not.toHaveBeenCalled();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(readVaultControl(owner)).toBeNull();
        } finally {
            fixture.close();
        }
    });
});
