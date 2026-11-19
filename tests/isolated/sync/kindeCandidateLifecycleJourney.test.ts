import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('CF-05 Kinde lifecycle cannot initialize Firebase');
});
const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { issueVerifiedSession } from '../../../cloudflare/auth/session-issuer.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { acceptKindeCandidateInitialConsent } from '../../../src/lib/auth/kindeCandidateConsent';
import { readKindeCandidateAccess } from '../../../src/lib/auth/kindeCandidateClient';
import { readKindeCandidateIdentity } from '../../../src/lib/auth/kindeCandidateIdentity';
import { prepareKindeCandidatePortableBackupJson } from '../../../src/lib/auth/kindeCandidatePortableBackup';
import { restoreKindeCandidateBackup } from '../../../src/lib/auth/kindeCandidateRestore';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { commitDomainOperations } from '../../../src/lib/sync/localDomainCommit';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { lockAllVaults, readVaultControl, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';

const uid = 'k_' + 'M'.repeat(43);
const otherUid = 'k_' + 'N'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const catalog = {
    manifest: {
        version: 'cf05-lifecycle-synthetic', updatedAt: '2026-11-19T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};

type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

/**
 * Real candidate first-party routing, Kinde HTTP, AuthGate and API Worker,
 * backed by synthetic D1. Trusted session issuance is fixture setup, NOT
 * a substitute for the external Kinde OIDC password or Google exchange.
 */
function browser(fixture: Fixture, account: string, seen: string[] = []) {
    const identity = fixture.sessions.get(account);
    if (!identity) throw Error('No verified synthetic session');
    const browserCookies = () => '__Host-logbook_csrf=' + identity.csrf;
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        seen.push(path);
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', identity.cookies);
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        return routeCandidateFirstPartyApi(new Request(ORIGIN + path, {
            ...init, headers,
        }), {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
            // Only this isolated fixture receives the private fitness API binding.
            D1_API: { fetch: (request: Request) => api.fetch(request, env) },
        });
    };
    return { send, browserCookies, stillCurrent: () => true };
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

describe('CF-05 synthetic Kinde consent, ciphertext, second device and portable restore', () => {
    it('preserves cloud, local offline and owner boundaries across the full candidate journey', async () => {
        const fixture = await createCloudKeyHttpFixture([uid, otherUid]);
        try {
            const seen: string[] = [];
            const first = browser(fixture, uid, seen);
            await expect(readKindeCandidateIdentity(first)).resolves.toMatchObject({
                kind: 'email-verified', principal: { uid, healthConsentRevision: 0 },
            });
            await expect(readKindeCandidateAccess(first)).resolves.toMatchObject({
                kind: 'consent-required', principal: { uid, healthConsentRevision: 0 },
            });
            await expect(prepareKindeCandidateOwner({ ...first, expected })).rejects.toThrow();
            expect(readVaultControl(owner)).toBeNull();
            expect(fixture.count('sync_documents', uid)).toBe(0);

            const consent = await acceptKindeCandidateInitialConsent({
                ...first, expectedOwner: { uid, fenceEpoch: 1 },
                decision: { acceptedHealthData: true, acceptedTerms: true, confirmsOver18: true },
            });
            if (consent.kind !== 'consent-confirmed') throw Error('Consent not verified');
            expect(consent.principal).toEqual(expected);
            const legal = consent.legalConsent;
            const firstReady = await prepareKindeCandidateOwner({
                ...first, expected, drainPendingJournal: true,
            });
            expect(firstReady).toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'adopted', journalDrained: true,
            });
            const initial = await readLocal(owner);
            expect(initial?.data.legalConsent).toEqual(legal);
            const firstVault = readVaultControl(owner);
            const firstReplicaId = initial?.replica?.replicaId;
            expect(firstVault?.phase).toBe('active');
            expect(firstReplicaId).toBeDefined();

            // Business and semantic journal must be sealed before the first
            // D1 commit. A receipt may clear only the already stored batch.
            await commitDomainOperations(owner, {
                type: 'profile.patch', patch: { height: '180' },
            }, initial!.data);
            expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
            expect(await deliverKindeCandidateJournal(first)).toBe('acknowledged');
            expect((await readLocal(owner))?.pending).toEqual([]);
            expect(fixture.count('sync_receipts', uid)).toBe(1);

            // This later edit exists ONLY on device A, not in D1.
            const delivered = (await readLocal(owner))!;
            await commitDomainOperations(owner, {
                type: 'profile.patch', patch: { height: '193' },
            }, delivered.data);
            const file = await prepareKindeCandidatePortableBackupJson({ ...first, expected });
            expect(file.backup).toMatchObject({
                owner, type: 'backup', coverage: { scope: 'cloud-and-device' },
                userData: { profile: { height: '193' } },
            });
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(seen).toContain('/v1/consent/initial');
            expect(seen).toContain('/v1/cloud-key/sync');
            expect(seen).toContain('/v1/sync/commit');

            const foreignRequests: string[] = [];
            const foreign = browser(fixture, otherUid, foreignRequests);
            await expect(readKindeCandidateIdentity(foreign)).resolves.toMatchObject({
                kind: 'email-verified', principal: { uid: otherUid },
            });
            const beforeForeign = foreignRequests.length;
            await expect(restoreKindeCandidateBackup({
                ...foreign, expected: { ...expected, uid: otherUid },
                backup: JSON.parse(file.json) as unknown,
            })).rejects.toThrow();
            expect(foreignRequests).toHaveLength(beforeForeign);
            expect(readVaultControl('user:' + otherUid)).toBeNull();
            expect(fixture.count('sync_documents', otherUid)).toBe(0);

            // Simulate a new browser profile with an independently issued
            // session: neither the first DEK nor its pending journal survives.
            lockAllVaults();
            localStorage.clear();
            await clear();
            expect(readVaultControl(owner)).toBeNull();
            expect(await get('logbook:v2:' + owner)).toBeUndefined();
            const issued = await issueVerifiedSession(fixture.db, uid);
            const cookies = issued.setCookies.map((value: string) => value.split(';')[0]).join('; ');
            const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
            fixture.sessions.set(uid, { cookies, csrf });
            const second = browser(fixture, uid);
            await expect(readKindeCandidateIdentity(second)).resolves.toMatchObject({
                kind: 'email-verified', principal: { uid, healthConsentRevision: 1 },
            });
            await expect(prepareKindeCandidateOwner({
                ...second, expected, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'adopted', journalDrained: true,
            });
            const cloudOnly = await readLocal(owner);
            expect(cloudOnly?.data.profile?.height).toBe('180');
            expect(cloudOnly?.baseline.profile?.height).toBe('180');
            expect(cloudOnly?.data.legalConsent).toEqual(legal);
            expect(cloudOnly?.pending).toEqual([]);
            expect(readVaultControl(owner)?.wrappedKey).not.toEqual(firstVault?.wrappedKey);
            expect(cloudOnly?.replica?.replicaId).not.toBe(firstReplicaId);
            expect(fixture.count('sync_receipts', uid)).toBe(1);

            // Explicit Schema 3 restore recovers the offline edit and only
            // reports a cloud success after the verified second D1 receipt.
            await expect(restoreKindeCandidateBackup({
                ...second, expected, backup: JSON.parse(file.json) as unknown,
            })).resolves.toEqual({ kind: 'cloud-acknowledged' });
            await unlockVaultForOwner(owner);
            const recovered = await readLocal(owner);
            expect(recovered?.data.profile?.height).toBe('193');
            expect(recovered?.baseline.profile?.height).toBe('193');
            expect(recovered?.data.legalConsent).toEqual(legal);
            expect(recovered?.pending).toEqual([]);
            expect(recovered?.cloudflareDelivery).toBeUndefined();
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            expect(fixture.count('sync_documents', uid)).toBe(1);
            const cloud = fixture.sqlite.prepare(
                'SELECT envelope_json FROM sync_documents WHERE uid=? AND path=?',
            ).get(uid, '');
            if (!cloud || typeof cloud.envelope_json !== 'string') {
                throw Error('No persisted encrypted D1 envelope');
            }
            expect(cloud.envelope_json).not.toContain('"height"');
            expect(cloud.envelope_json).not.toContain('"profile"');

            const sealed = await get<string>('logbook:v2:' + owner);
            await fixture.withdraw(uid);
            await expect(prepareKindeCandidateOwner({
                ...second, expected, retainDeviceVault: false,
            })).rejects.toThrow();
            expect(await get<string>('logbook:v2:' + owner)).toBe(sealed);
            // Withdrawal queues erasure; this must not pretend it completed.
            expect(fixture.count('sync_documents', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });
});
