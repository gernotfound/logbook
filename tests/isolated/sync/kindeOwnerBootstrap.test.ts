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
import { issueVerifiedSession } from '../../../cloudflare/auth/session-issuer.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../../src/lib/auth/kindeCandidateConsent';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { withKindeCandidateRightsCheckpoint } from '../../../src/lib/auth/kindeCandidateRightsCheckpoint';
import { prepareKindeCandidateRightsJson, requestKindeCandidateRightsJsonDownload } from '../../../src/lib/auth/kindeCandidateRightsExport';
import { decodeImport } from '../../../src/lib/backup';
import type { CloudReplicaClaimRequest } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { commitDomainOperations } from '../../../src/lib/sync/localDomainCommit';
import {
    isVaultUnlocked, lockAllVaults, readVaultControl, unlockVaultForOwner, vaultControlKey,
} from '../../../src/lib/sync/secureArchiveSession';

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

type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;
function firstPartySession(fixture: Fixture, observe: (path: string, init: RequestInit | undefined,
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
        expect(isVaultUnlocked(owner)).toBe(false);
        await unlockVaultForOwner(owner);
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

    it('preactivation preparation closes its own vault after verified D1 readback', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const session = firstPartySession(fixture, (_path, _init, response) => response);
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, retainDeviceVault: false, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'adopted', journalOutcome: 'idle',
            });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            expect(fixture.count('sync_documents', uid)).toBe(0);
            const sealed = await get<string>('logbook:v2:' + owner);
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            await unlockVaultForOwner(owner);
            expect(await readLocal(owner)).toMatchObject({
                owner, consentRevision: 1, pending: [],
                data: { legalConsent: expect.objectContaining({ hasAcceptedHealthData: true }) },
            });
        } finally {
            fixture.close();
        }
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
        expect(isVaultUnlocked(owner)).toBe(false);
        expect(await get('logbook:v2:' + owner)).toBeUndefined();
        expect(claimSource.claim).not.toHaveBeenCalled();
        await expect(start(server())).resolves.toMatchObject({ kind: 'candidate-observed' });
        expect(readVaultControl(owner)).toEqual(previous);
        expect(isVaultUnlocked(owner)).toBe(false);
        await unlockVaultForOwner(owner);
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
            const requests: CloudReplicaClaimRequest[] = [];
            let scanCount = 0;
            const { send, browserCookies } = firstPartySession(fixture, async (path, init, response) => {
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
            });

            await expect(start(send, browserCookies)).rejects.toThrow();
            expect(requests).toHaveLength(1);
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            const staged = requests[0];
            const controlBefore = readVaultControl(owner);
            expect(isVaultUnlocked(owner)).toBe(false);
            await unlockVaultForOwner(owner);
            expect(await readLocal(owner)).toMatchObject({ cloudflareReplicaClaim: staged, pending: [], replica: null });
            const sealed = await get<string>('logbook:v2:' + owner);
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            expect(sealed).not.toContain(staged.mutationId);

            lockAllVaults();
            const scansBeforeRetry = scanCount;
            await expect(start(send, browserCookies)).resolves.toEqual({
                kind: 'candidate-observed', checkpointRevision: null, replicaOutcome: 'reconciliation-required',
            });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(scanCount).toBe(scansBeforeRetry);
            expect(await get('logbook:v2:' + owner)).toBe(sealed);
            await expect(start(send, browserCookies)).resolves.toEqual({
                kind: 'candidate-observed', checkpointRevision: 1, replicaOutcome: 'adopted',
            });
            expect(requests).toEqual([staged, staged, staged]);
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            expect(readVaultControl(owner)).toEqual(controlBefore);
            const recovered = await readLocal(owner);
            expect(isVaultUnlocked(owner)).toBe(true);
            expect(recovered?.cloudflareReplicaClaim).toBeUndefined();
            expect(recovered?.replica?.replicaId).toBe(staged.candidateReplicaId);
            expect(recovered?.pending).toEqual([]);
            expect(recovered?.data.legalConsent?.acceptedAt).toBeTruthy();
        } finally {
            fixture.close();
        }
    });

    it('recovers the first committed journal after restart and keeps edits recorded after the lost receipt', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            let receiptUnavailable = false;
            let commitCount = 0;
            let scans = 0;
            const session = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/sync/scan') scans += 1;
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commitCount += 1;
                    throw new TypeError('HTTP response lost after journal commit');
                }
                if (path === '/v1/sync/receipt' && receiptUnavailable && commitCount > 0) {
                    return Response.json({ error: 'unavailable' }, {
                        status: 503, headers: { 'Cache-Control': 'no-store' },
                    });
                }
                return response;
            });
            await expect(acceptKindeCandidateInitialConsent({
                ...session, expectedOwner: principal,
                decision: { acceptedHealthData: true, acceptedTerms: true, confirmsOver18: true },
            })).resolves.toMatchObject({ kind: 'consent-confirmed', principal });
            const wrappingKey = fixture.env.CLOUD_ACCOUNT_KEK_V1;
            fixture.env.CLOUD_ACCOUNT_KEK_V1 = '';
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal })).rejects.toThrow();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(fixture.count('cloud_account_keys', uid)).toBe(0);
            expect(fixture.count('sync_replicas', uid)).toBe(0);
            fixture.env.CLOUD_ACCOUNT_KEK_V1 = wrappingKey;
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '181' } }, baseline);
            receiptUnavailable = true;
            await expect(deliverKindeCandidateJournal(session)).rejects.toThrow();
            expect(commitCount).toBe(1);
            expect(fixture.count('sync_documents', uid)).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            const originalIntent = (await readLocal(owner))?.cloudflareDelivery;
            expect(originalIntent).toBeDefined();
            const later = await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '182' } }, baseline);
            const ciphertext = await get('logbook:v2:' + owner);
            const scansBeforeRestart = scans;

            lockAllVaults();
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal })).rejects.toThrow();
            expect(scans).toBe(scansBeforeRestart);
            expect(await get('logbook:v2:' + owner)).toBe(ciphertext);
            expect(isVaultUnlocked(owner)).toBe(false);
            await unlockVaultForOwner(owner);
            expect((await readLocal(owner))?.cloudflareDelivery).toEqual(originalIntent);
            receiptUnavailable = false;

            await expect(prepareKindeCandidateOwner({ ...session, expected: principal })).resolves.toEqual({
                kind: 'candidate-observed', checkpointRevision: 2, replicaOutcome: 'already-active',
            });
            expect(commitCount).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            const restored = await readLocal(owner);
            expect(restored?.cloudflareDelivery).toBeUndefined();
            expect(restored?.baseline.profile?.height).toBe('181');
            expect(restored?.data.profile?.height).toBe('182');
            expect(restored?.pending).toEqual(later.operations);
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
        expect(isVaultUnlocked(owner)).toBe(false);
        expect(await get('logbook:v2:' + owner)).toBeUndefined();
        expect(claimSource.claim).not.toHaveBeenCalled();
    });

    it('keeps the exact durable batch if the vault is reopened before applying the D1 receipt', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            let interrupted = false;
            let staged: Awaited<ReturnType<typeof readLocal>>;
            const session = firstPartySession(fixture, async (path, _init, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits += 1;
                }
                if (path === '/v1/sync/receipt' && commits === 1 && !interrupted) {
                    expect(response.status).toBe(200);
                    staged = await readLocal(owner);
                    expect(staged?.cloudflareDelivery).toBeDefined();
                    await unlockVaultForOwner(owner);
                    interrupted = true;
                }
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            const edit = await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '183' } }, baseline);

            await expect(deliverKindeCandidateJournal(session)).rejects.toThrow();
            expect(interrupted).toBe(true);
            expect(isVaultUnlocked(owner)).toBe(true);
            expect(await readLocal(owner)).toEqual(staged);
            expect((await readLocal(owner))?.pending).toEqual(edit.operations);
            expect(fixture.count('sync_receipts', uid)).toBe(1);

            await expect(deliverKindeCandidateJournal(session)).resolves.toBe('acknowledged');
            expect(commits).toBe(1);
            expect((await readLocal(owner))?.cloudflareDelivery).toBeUndefined();
            expect((await readLocal(owner))?.pending).toEqual([]);
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('183');
        } finally {
            fixture.close();
        }
    });

    it('drains a persisted first edit after checking the replica and leaves an empty journal idle', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            const session = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits += 1;
                }
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            const edit = await commitDomainOperations(
                owner, { type: 'profile.patch', patch: { height: '184' } }, baseline,
            );
            expect((await readLocal(owner))?.pending).toEqual(edit.operations);
            expect(fixture.count('sync_receipts', uid)).toBe(0);

            lockAllVaults();
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'already-active',
                journalOutcome: 'acknowledged',
            });
            expect(isVaultUnlocked(owner)).toBe(true);
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect((await readLocal(owner))?.pending).toEqual([]);
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('184');
            expect((await readLocal(owner))?.data.legalConsent).toEqual(baseline.legalConsent);
            expect((await readLocal(owner))?.baseline.legalConsent).toEqual(baseline.legalConsent);
            const ciphertext = await get<string>('logbook:v2:' + owner);
            expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
            expect(ciphertext).not.toContain('"height":"184"');

            lockAllVaults();
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'already-active',
                journalOutcome: 'idle',
            });
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });


    it('reads and AEAD-authenticates revoked ciphertext without reopening the fitness vault or replaying sync', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const observed: string[] = [];
            const session = firstPartySession(fixture, (path, _init, response) => {
                observed.push(path); return response;
            });
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, retainDeviceVault: false,
            })).resolves.toMatchObject({ replicaOutcome: 'adopted' });
            expect(isVaultUnlocked(owner)).toBe(false);
            await unlockVaultForOwner(owner);
            const baseline = (await readLocal(owner))!.data;
            await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '194' } }, baseline);
            await expect(deliverKindeCandidateJournal(session)).resolves.toBe('acknowledged');
            expect(fixture.count('sync_documents', uid)).toBe(1);
            lockAllVaults();
            expect(isVaultUnlocked(owner)).toBe(false);
            await fixture.withdraw(uid);
            const before = observed.length;
            const retrieved = await withKindeCandidateRightsCheckpoint({
                ...session, expected: { ...principal, healthConsentRevision: 1 as const },
                consumeCheckpoint: async (checkpoint, current) => {
                    expect(current()).toBe(true);
                    expect(checkpoint.consentRevision).toBe(1);
                    expect(checkpoint.documents.size).toBe(1);
                    return checkpoint.documents.get('')?.business;
                },
            });
            expect(retrieved).toMatchObject({ profile: { height: '194' } });
            const exported = await prepareKindeCandidateRightsJson({
                ...session, expected: { ...principal, healthConsentRevision: 1 as const },
            });
            const payload = JSON.parse(exported.json) as unknown;
            expect(exported.filename).toMatch(/^thelogbook_diritti_cloud_\d{4}-\d{2}-\d{2}\.json$/);
            expect(exported.documentCount).toBe(1);
            expect(payload).toMatchObject({
                format: 'thelogbook-cloud-rights-export',
                version: 1, type: 'rights-only', owner,
                cloud: { consentRevision: 1, fenceEpoch: 1 },
                coverage: {
                    scope: 'cloud-documents-still-readable',
                    completeness: 'not-proven-after-withdrawal',
                    includesDeviceData: false,
                    includesPendingJournal: false,
                    includesDeviceDrafts: false,
                    restorableBackup: false,
                },
                documents: [{ path: '', dataSchemaVersion: 1,
                    business: { profile: { height: '194' } } }],
            });
            expect(() => decodeImport(payload, owner)).toThrow();
            const clicked = vi.fn();
            const removed = vi.fn();
            const appended = vi.fn();
            const link = { href: '', download: '', style: { visibility: '' },
                click: clicked, remove: removed };
            vi.stubGlobal('document', {
                createElement: vi.fn(() => link),
                body: { appendChild: appended },
            });
            const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rights-synthetic');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            await requestKindeCandidateRightsJsonDownload({
                ...session, expected: { ...principal, healthConsentRevision: 1 as const },
            });
            expect(objectUrl).toHaveBeenCalledTimes(1);
            expect(appended).toHaveBeenCalledWith(link);
            expect(clicked).toHaveBeenCalledTimes(1);
            expect(removed).toHaveBeenCalledTimes(1);
            expect(link.download).toMatch(/^thelogbook_diritti_cloud_\d{4}-\d{2}-\d{2}\.json$/);
            let current = true;
            const replaced = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/rights/scan') current = false;
                return response;
            });
            await expect(prepareKindeCandidateRightsJson({
                ...replaced, expected: { ...principal, healthConsentRevision: 1 as const },
                stillCurrent: () => current,
            })).rejects.toThrow();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(observed.slice(before).filter(path => path === '/v1/rights/scan')).toHaveLength(2);
            expect(observed.slice(before)).not.toContain('/v1/sync/scan');
            expect(observed.slice(before)).not.toContain('/v1/cloud-key/sync');
            expect(observed.slice(before)).not.toContain('/v1/sync/commit');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .rejects.toThrow();
        } finally { fixture.close(); }
    });

    it('does not claim complete journal delivery when a second edit arrives after remote commit', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            let later: Awaited<ReturnType<typeof commitDomainOperations>> | undefined;
            const session = firstPartySession(fixture, async (path, _init, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits += 1;
                    if (commits === 1) {
                        const current = (await readLocal(owner))!.data;
                        later = await commitDomainOperations(
                            owner, { type: 'profile.patch', patch: { height: '187' } }, current,
                        );
                    }
                }
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            await commitDomainOperations(
                owner, { type: 'profile.patch', patch: { height: '186' } }, baseline,
            );
            lockAllVaults();

            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
                retainDeviceVault: false,
            })).resolves.toMatchObject({
                kind: 'journal-pending', journalOutcome: 'acknowledged', pendingCount: 1,
            });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            await unlockVaultForOwner(owner);
            const remaining = await readLocal(owner);
            expect(remaining?.pending).toEqual(later?.operations);
            expect(remaining?.baseline.profile?.height).toBe('186');
            expect(remaining?.data.profile?.height).toBe('187');
            expect(remaining?.data.legalConsent).toEqual(baseline.legalConsent);
            expect(remaining?.baseline.legalConsent).toEqual(baseline.legalConsent);
            lockAllVaults();

            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
                retainDeviceVault: false,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', journalOutcome: 'acknowledged',
                journalDrained: true,
            });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(commits).toBe(2);
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            await unlockVaultForOwner(owner);
            const complete = await readLocal(owner);
            expect(complete?.pending).toEqual([]);
            expect(complete?.baseline.profile?.height).toBe('187');
        } finally {
            fixture.close();
        }
    });

    it('opens a remote encrypted first save on another independent device vault and session', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const firstSession = firstPartySession(fixture, (_path, _init, response) => response);
            await expect(prepareKindeCandidateOwner({ ...firstSession, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const source = await readLocal(owner);
            const firstReplica = source?.replica;
            const firstVault = readVaultControl(owner);
            await commitDomainOperations(owner, {
                type: 'profile.patch', patch: { height: '186' },
            }, source!.data);
            await expect(deliverKindeCandidateJournal(firstSession)).resolves.toBe('acknowledged');
            expect(fixture.count('sync_documents', uid)).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);

            // Independent browser profile: no local key, envelope, identity
            // hint or pending operation survives, while the D1 cloud remains.
            lockAllVaults();
            localStorage.clear();
            await clear();
            const issued = await issueVerifiedSession(fixture.db, uid);
            const cookies = issued.setCookies.map((value: string) => value.split(';')[0]).join('; ');
            const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
            fixture.sessions.set(uid, { cookies, csrf });
            const secondSession = firstPartySession(fixture, (_path, _init, response) => response);
            await expect(prepareKindeCandidateOwner({ ...secondSession, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const downloaded = await readLocal(owner);
            expect(downloaded?.data.profile?.height).toBe('186');
            expect(downloaded?.baseline.profile?.height).toBe('186');
            expect(downloaded?.pending).toEqual([]);
            expect(downloaded?.replica?.replicaId).not.toBe(firstReplica?.replicaId);
            expect(readVaultControl(owner)?.wrappedKey).not.toEqual(firstVault?.wrappedKey);
            expect(fixture.count('sync_documents', uid)).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });

    it('closes its vault after a lost first-save response and reconciles without a second commit', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            let loseResponse = true;
            let receiptUnavailable = false;
            const session = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits += 1;
                    if (loseResponse) {
                        loseResponse = false;
                        // The initial receipt lookup must reach D1 before
                        // failure injection: only the post-commit reply is lost.
                        receiptUnavailable = true;
                        throw new TypeError('D1 committed; HTTP response lost');
                    }
                }
                if (path === '/v1/sync/receipt' && receiptUnavailable) {
                    return Response.json({ error: 'unavailable' }, {
                        status: 503, headers: { 'Cache-Control': 'no-store' },
                    });
                }
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            const edit = await commitDomainOperations(
                owner, { type: 'profile.patch', patch: { height: '185' } }, baseline,
            );

            lockAllVaults();
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
            })).rejects.toThrow();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            await unlockVaultForOwner(owner);
            const preserved = await readLocal(owner);
            expect(preserved?.cloudflareDelivery).toBeDefined();
            expect(preserved?.pending).toEqual(edit.operations);
            const ciphertext = await get<string>('logbook:v2:' + owner);
            expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
            lockAllVaults();

            receiptUnavailable = false;
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'already-active',
                journalOutcome: 'idle',
            });
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect((await readLocal(owner))?.cloudflareDelivery).toBeUndefined();
            expect((await readLocal(owner))?.pending).toEqual([]);
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('185');
        } finally {
            fixture.close();
        }
    });

    it('a delayed scan from a replaced session cannot lock a newer grant for the same owner', async () => {
        let liveCookie = cookie();
        let finishScan!: () => void;
        const paused = new Promise<void>(resolve => { finishScan = resolve; });
        const respond = server();
        const send = vi.fn<typeof fetch>(async (path, init) => {
            if (path === '/v1/sync/scan') await paused;
            return respond(path, init);
        });
        const obsolete = start(send, () => liveCookie);
        const rejected = expect(obsolete).rejects.toThrow();
        try {
            await vi.waitFor(() => expect(send).toHaveBeenCalledWith('/v1/sync/scan', expect.anything()));
            expect(isVaultUnlocked(owner)).toBe(true);
            liveCookie = '__Host-logbook_csrf=' + 'B'.repeat(42) + 'A';
            const newer = await unlockVaultForOwner(owner);
            finishScan();
            await rejected;
            expect(newer.isCurrent()).toBe(true);
            expect(await get('logbook:v2:' + owner)).toBeUndefined();
            expect(claimSource.claim).not.toHaveBeenCalled();
        } finally {
            finishScan();
            await obsolete.catch(() => {});
        }
    });
});
