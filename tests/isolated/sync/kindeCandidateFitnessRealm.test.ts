import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde realm must not load Firebase');
});
const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: catalogSource.read,
}));

import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { openKindeCandidateFitnessRealm } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { isVaultUnlocked, lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';

const uid = 'k_' + 'P'.repeat(43);
const otherUid = 'k_' + 'Q'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const catalog = {
    manifest: { version: 'cf03-realm', updatedAt: '2026-11-21T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};

type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

function browser(fixture: Fixture, account = uid) {
    const session = fixture.sessions.get(account);
    if (!session) throw Error('Synthetic Kinde session missing');
    let csrf = '__Host-logbook_csrf=' + session.csrf;
    let current = true;
    const paths: string[] = [];
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        paths.push(path);
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', session.cookies);
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        return routeCandidateFirstPartyApi(new Request(ORIGIN + path, { ...init, headers }), {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
            D1_API: { fetch: (request: Request) => api.fetch(request, env) },
        });
    };
    return {
        send, paths,
        browserCookies: () => csrf,
        stillCurrent: () => current,
        rotate: () => { csrf = '__Host-logbook_csrf=' + 'Z'.repeat(43); },
        stop: () => { current = false; },
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

describe('isolated Kinde fitness realm with trusted owner, no Firebase/global grant', () => {
    it('opens a read-only snapshot, commits a domain intent with one verified D1 receipt, and closes without leaking a DEK', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            expect(realm.isCurrent()).toBe(true);
            expect(realm.snapshot()).toMatchObject({ owner, principal: expected });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(authenticatedIdentitySource.hasReader()).toBe(false);

            // Returned data is a copy, not a mutable reference to the
            // realm's authorized snapshot.
            const loose = realm.snapshot()!;
            loose.data.profile = { ...(loose.data.profile ?? {}), height: '999' };
            expect(realm.snapshot()?.data.profile?.height).not.toBe('999');

            await expect(realm.submit({
                type: 'profile.patch', patch: { height: '181' },
            })).resolves.toMatchObject({ kind: 'cloud-acknowledged' });
            expect(realm.snapshot()?.data.profile?.height).toBe('181');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(authenticatedIdentitySource.readUid()).toBeNull();
            realm.close();
            expect(realm.snapshot()).toBeNull();
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '182' } }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });

    it('invalidates owner data and refuses any write on CSRF rotation, withdrawal marker or cancelled generation', async () => {
        const fixture = await createCloudKeyHttpFixture([uid, otherUid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            expect(realm.snapshot()).not.toBeNull();
            client.rotate();
            expect(realm.isCurrent()).toBe(false);
            expect(realm.snapshot()).toBeNull();
            const before = client.paths.length;
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '188' } }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(client.paths).toHaveLength(before);
            realm.close();

            const second = browser(fixture);
            const revoked = await openKindeCandidateFitnessRealm({ ...second, expected });
            localStorage.setItem('logbook:v2:' + owner + ':health-consent-withdrawal', 'pending:1');
            expect(revoked.snapshot()).toBeNull();
            await expect(revoked.refresh()).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            revoked.close();

            localStorage.removeItem('logbook:v2:' + owner + ':health-consent-withdrawal');
            const cancelled = browser(fixture);
            cancelled.stop();
            await expect(openKindeCandidateFitnessRealm({ ...cancelled, expected }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(authenticatedIdentitySource.readUid()).toBeNull();
            expect(fixture.count('sync_documents', otherUid)).toBe(0);
        } finally {
            fixture.close();
        }
    });

    it('never associates another authenticated Kinde session with the requested owner', async () => {
        const fixture = await createCloudKeyHttpFixture([uid, otherUid]);
        try {
            await fixture.consent(uid);
            const foreign = browser(fixture, otherUid);
            await expect(openKindeCandidateFitnessRealm({
                ...foreign, expected,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(foreign.paths).toContain('/api/auth/session');
            expect(await get('logbook:v2:' + owner)).toBeUndefined();
            expect(fixture.count('sync_documents', uid)).toBe(0);
            expect(fixture.count('sync_documents', otherUid)).toBe(0);
            expect(authenticatedIdentitySource.readUid()).toBeNull();
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it('reconciles a response lost AFTER D1 commit through the same trusted scope without a second business edit', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            let lost = false;
            const send: typeof fetch = async (input, init) => {
                if (String(input) === '/v1/sync/commit' && !lost) {
                    lost = true;
                    const committed = await client.send(input, init);
                    expect(committed.ok).toBe(true);
                    throw new TypeError('synthetic response lost after commit');
                }
                return client.send(input, init);
            };
            const realm = await openKindeCandidateFitnessRealm({ ...client, send, expected });
            const outcome = await realm.submit({
                type: 'profile.patch', patch: { height: '193' },
            });
            expect(outcome).toMatchObject({ kind: 'local-pending', pendingCount: 1 });
            expect(realm.snapshot()).toBeNull();
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(isVaultUnlocked(owner)).toBe(false);
            const reconciled = await realm.refresh();
            expect(reconciled.data.profile?.height).toBe('193');
            expect(realm.snapshot()?.data.profile?.height).toBe('193');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            const grant = await unlockVaultForOwner(owner);
            try {
                const local = await readLocal(owner);
                expect(local?.pending).toHaveLength(0);
                expect(local?.data.profile?.height).toBe('193');
                expect(local?.cloudflareDelivery).toBeUndefined();
            } finally {
                grant.release();
            }
            expect(isVaultUnlocked(owner)).toBe(false);
            realm.close();
        } finally {
            fixture.close();
        }
    });

    it('blocks stale plaintext after a lost response and recovers exactly the pending ciphertext on fresh trusted scope', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            let lost = false;
            const send: typeof fetch = async (input, init) => {
                if (String(input) === '/v1/sync/commit' && !lost) {
                    lost = true;
                    throw new TypeError('synthetic transport loss');
                }
                return client.send(input, init);
            };
            const realm = await openKindeCandidateFitnessRealm({ ...client, send, expected });
            const outcome = await realm.submit({
                type: 'profile.patch', patch: { height: '192' },
            });
            expect(outcome).toMatchObject({ kind: 'local-pending', pendingCount: 1 });
            expect(realm.snapshot()).toBeNull();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
            realm.close();

            const grant = await unlockVaultForOwner(owner);
            try {
                const local = await readLocal(owner);
                expect(local?.pending).toHaveLength(1);
                expect(local?.data.profile?.height).toBe('192');
                expect(local?.cloudflareDelivery).toBeDefined();
            } finally {
                grant.release();
            }
            expect(fixture.count('sync_receipts', uid)).toBe(0);

            const resumed = await openKindeCandidateFitnessRealm({ ...client, expected });
            expect(resumed.snapshot()?.data.profile?.height).toBe('192');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(isVaultUnlocked(owner)).toBe(false);
            resumed.close();
        } finally {
            fixture.close();
        }
    });
});
