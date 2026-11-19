import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
const claimSource = vi.hoisted(() => ({ claim: vi.fn() }));
vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde device bootstrap must not import Firebase');
});
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));
vi.mock('../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
    () => ({ claimKindeCandidateReplica: claimSource.claim }));

import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import type { CloudReplicaClaimRequest } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { lockAllVaults, readVaultControl, vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';

const uid = 'k_' + 'A'.repeat(43);
const owner = 'user:' + uid;
const principal = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const cookie = () => '__Host-logbook_csrf=' + 'A'.repeat(43);
const legal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-16T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const cloudKey = new Uint8Array(32).fill(49);
const catalog = {
    manifest: { version: 'bootstrap-synthetic', updatedAt: '2026-11-18T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};

function server(mode: 'active' | 'unregistered' | 'withdrawn' | 'unverified' | 'scan-error' = 'active'): typeof fetch {
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

async function start(send: typeof fetch, cookies = cookie, stillCurrent = () => true) {
    return prepareKindeCandidateOwner({ expected: principal, send, browserCookies: cookies, stillCurrent });
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

describe('Kinde-only device vault provisioning and authenticated baseline', () => {
    it('creates only owner-scoped ciphertext after trusted consent, then invokes the durable claim bridge', async () => {
        const send = server();
        const result = await start(send);
        expect(result).toEqual({ kind: 'candidate-observed', checkpointRevision: 0,
            replicaOutcome: 'reconciliation-required' });
        expect(claimSource.claim).toHaveBeenCalledWith({
            expected: principal, stillCurrent: expect.any(Function),
            send, browserCookies: cookie,
        });
        const data = await readLocal(owner);
        expect(data?.owner).toBe(owner);
        expect(data?.consentRevision).toBe(1);
        expect(data?.data.legalConsent).toEqual(legal);
        expect(data?.replica).toBeNull();
        expect(data?.pending).toEqual([]);
        const sealed = await get<string>('logbook:v2:' + owner);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(sealed).not.toContain(legal.acceptedAt);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(localStorage.getItem(vaultControlKey('guest'))).toBeNull();
    });

    it('never provisions a key without trusted email and account consent', async () => {
        for (const mode of ['unregistered', 'withdrawn', 'unverified'] as const) {
            const send = server(mode);
            await expect(start(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).toHaveBeenCalled();
            expect(readVaultControl(owner)).toBeNull();
            expect(await get('logbook:v2:' + owner)).toBeUndefined();
        }
        expect(claimSource.claim).not.toHaveBeenCalled();
    });

    it('refuses a local guest, pending withdrawal or mismatched consent generation before any network I/O', async () => {
        const checks = [
            ['logbook_is_guest', 'true'],
            ['logbook_is_guest', 'invalid'],
            [`logbook:v2:${owner}:health-consent-withdrawal`, 'pending:1'],
            [`logbook:v2:${owner}:health-consent-generation`, '2'],
            [`logbook:v2:${owner}:account-deletion`, 'pending'],
        ];
        for (const [key, value] of checks) {
            localStorage.setItem(key, value);
            const send = server();
            await expect(start(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
            expect(readVaultControl(owner)).toBeNull();
            localStorage.removeItem(key);
        }
    });

    it('preserves the same provisioned vault after unavailable cloud scan; retry hydrates without a reset', async () => {
        await expect(start(server('scan-error'))).rejects.toThrow();
        const previous = readVaultControl(owner);
        expect(previous?.phase).toBe('active');
        expect(await get('logbook:v2:' + owner)).toBeUndefined();
        expect(claimSource.claim).not.toHaveBeenCalled();
        await expect(start(server())).resolves.toMatchObject({ kind: 'candidate-observed' });
        expect(readVaultControl(owner)).toEqual(previous);
        expect(await readLocal(owner)).toMatchObject({ owner, consentRevision: 1 });
    });

    it('resumes the exact encrypted replica claim after a committed response is lost and the vault is reopened', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
            const session = fixture.sessions.get(uid);
            const browserCookies = () => '__Host-logbook_csrf=' + session.csrf;
            const requests: CloudReplicaClaimRequest[] = [];
            let scanCount = 0;
            const send: typeof fetch = async (path, init) => {
                const headers = new Headers(init?.headers);
                headers.set('origin', ORIGIN);
                headers.set('sec-fetch-site', 'same-origin');
                headers.set('cookie', session.cookies);
                const response = await routeCandidateFirstPartyApi(new Request(ORIGIN + String(path), {
                    ...init, headers,
                }), {
                    APP_ORIGIN: ORIGIN,
                    KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
                    D1_API: { fetch: (request: Request) => api.fetch(request, env) },
                });
                if (path === '/v1/sync/replica/claim') {
                    expect(response.status).toBe(200);
                    const claimed = JSON.parse(String(init?.body)) as CloudReplicaClaimRequest;
                    expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(claimed);
                    requests.push(claimed);
                    if (requests.length === 1) throw new TypeError('HTTP response lost after D1 commit');
                    // An ambiguous conflict must not overwrite the staged request.
                    if (requests.length === 2) return Response.json({ error: 'conflict' }, { status: 409 });
                }
                if (path === '/v1/sync/scan') scanCount += 1;
                return response;
            };

            await expect(start(send, browserCookies)).rejects.toThrow();
            expect(requests).toHaveLength(1);
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            const staged = requests[0];
            const controlBefore = readVaultControl(owner);
            expect(await readLocal(owner)).toMatchObject({ cloudflareReplicaClaim: staged, pending: [], replica: null });
            const sealed = await get<string>('logbook:v2:' + owner);
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            expect(sealed).not.toContain(staged.mutationId);

            lockAllVaults();
            const scansBeforeRetry = scanCount;
            await expect(start(send, browserCookies)).resolves.toEqual({
                kind: 'candidate-observed', checkpointRevision: null, replicaOutcome: 'reconciliation-required',
            });
            expect(scanCount).toBe(scansBeforeRetry);
            expect(await get('logbook:v2:' + owner)).toBe(sealed);
            await expect(start(send, browserCookies)).resolves.toEqual({
                kind: 'candidate-observed', checkpointRevision: 1, replicaOutcome: 'adopted',
            });
            expect(requests).toEqual([staged, staged, staged]);
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            expect(readVaultControl(owner)).toEqual(controlBefore);
            const recovered = await readLocal(owner);
            expect(recovered?.cloudflareReplicaClaim).toBeUndefined();
            expect(recovered?.replica?.replicaId).toBe(staged.candidateReplicaId);
            expect(recovered?.pending).toEqual([]);
            expect(recovered?.data.legalConsent?.acceptedAt).toBeTruthy();
        } finally {
            fixture.close();
        }
    });

    it('does not hydrate if a new session replaces the CSRF cookie during vault recovery', async () => {
        let liveCookie = cookie();
        vi.stubGlobal('navigator', { locks: {
            request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => {
                const done = await callback();
                liveCookie = '__Host-logbook_csrf=' + 'B'.repeat(43);
                return done;
            },
        } });
        await expect(start(server(), () => liveCookie))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(await get('logbook:v2:' + owner)).toBeUndefined();
        expect(claimSource.claim).not.toHaveBeenCalled();
    });
});
