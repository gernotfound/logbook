import 'fake-indexeddb/auto';
import { get } from 'idb-keyval';
import { afterEach, expect, it, vi } from 'vitest';

const browserStorage = vi.hoisted(() => ({ profile: 'a' }));
vi.mock('idb-keyval', async importOriginal => {
    const idb = await importOriginal<typeof import('idb-keyval')>();
    const stores = new Map<string, ReturnType<typeof idb.createStore>>();
    const store = () => {
        const { profile } = browserStorage;
        let current = stores.get(profile);
        if (!current) {
            current = idb.createStore(`kinde-device-${profile}`, 'keyval');
            stores.set(profile, current);
        }
        return current;
    };
    return {
        ...idb,
        get: (key: IDBValidKey) => idb.get(key, store()),
        set: (key: IDBValidKey, value: unknown) => idb.set(key, value, store()),
        update: <T>(key: IDBValidKey, updater: (value: T | undefined) => T) => idb.update(key, updater, store()),
    };
});
vi.mock('../../../src/lib/firebase', () => { throw Error('Kinde must not initialize Firebase'); });

import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { issueVerifiedSession } from '../../../cloudflare/auth/session-issuer.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { openKindeCandidateFitnessRealm } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { isVaultUnlocked, lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';

const uid = 'k_' + 'S'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };

function createLocalStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() { return values.size; },
        key: index => Array.from(values.keys())[index] ?? null,
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, String(value)); },
        removeItem: key => { values.delete(key); },
        clear: () => { values.clear(); },
    };
}

function browser(
    profile: string,
    session: { cookies: string; csrf: string },
    fixture: Awaited<ReturnType<typeof createCloudKeyHttpFixture>>,
) {
    const storage = createLocalStorage();
    const commits: { body: unknown; status: number }[] = [];
    const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
    let quotaExhausted = false;
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', session.cookies);
        const commit = path === '/v1/sync/commit';
        const response = commit && quotaExhausted
            ? Response.json({ error: 'unavailable' }, { status: 429 })
            : await routeCandidateFirstPartyApi(new Request(ORIGIN + path, { ...init, headers }), {
                APP_ORIGIN: ORIGIN,
                KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
                D1_API: { fetch: (request: Request) => api.fetch(request, env) },
            });
        if (commit) commits.push({ body: JSON.parse(String(init?.body)), status: response.status });
        return response;
    };
    return {
        select() {
            expect(isVaultUnlocked(owner)).toBe(false);
            browserStorage.profile = profile;
            vi.stubGlobal('localStorage', storage);
        },
        open: () => openKindeCandidateFitnessRealm({
            expected, send, browserCookies: () => '__Host-logbook_csrf=' + session.csrf,
            stillCurrent: () => browserStorage.profile === profile,
        }),
        setQuotaExhausted: (value: boolean) => { quotaExhausted = value; },
        commits,
    };
}

async function readSealedArchive() {
    const grant = await unlockVaultForOwner(owner);
    try { return await readLocal(owner); }
    finally { grant.release(); }
}

afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
});

it('rebases a quota-blocked Kinde edit over a second device commit and acknowledges it once', async () => {
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, work: () => Promise<unknown>) => work(),
    } });
    const fixture = await createCloudKeyHttpFixture([uid]);
    try {
        await fixture.consent(uid);
        const [sessionCookie, csrfCookie] = (await issueVerifiedSession(fixture.db, uid)).setCookies
            .map((value: string) => value.split(';')[0]);
        const a = browser('a', fixture.sessions.get(uid), fixture);
        const b = browser('b', { cookies: `${sessionCookie}; ${csrfCookie}`, csrf: csrfCookie.split('=')[1] }, fixture);
        // Switch between surviving local profiles only at settled use-case
        // boundaries. Both independent sessions and replicas use the same SQL.
        b.select();
        const realmB = await b.open();
        a.select();
        expect(await get('logbook:v2:' + owner)).toBeUndefined();
        const realmA = await a.open();
        a.setQuotaExhausted(true);
        await expect(realmA.submit({ type: 'profile.patch', patch: { height: '183' } }))
            .resolves.toEqual({ kind: 'local-pending', pendingCount: 1 });
        expect(realmA.snapshot()).toBeNull();
        expect(fixture.count('sync_receipts', uid)).toBe(0);
        expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
        const pending = await readSealedArchive();
        expect(pending?.pending).toHaveLength(1);
        const original = pending?.cloudflareDelivery?.batch;
        if (!original) throw Error('Quota refusal must preserve the original encrypted batch');
        expect(a.commits).toEqual([{ body: original, status: 429 }]);
        await expect(realmA.refresh()).rejects.toThrow();
        expect(realmA.snapshot()).toBeNull();
        expect(a.commits).toEqual([{ body: original, status: 429 }, { body: original, status: 429 }]);
        expect(fixture.count('sync_receipts', uid)).toBe(0);

        b.select();
        await expect(realmB.submit({ type: 'profile.patch', patch: { neck: '37' } }))
            .resolves.toEqual({ kind: 'cloud-acknowledged', operations: 1 });
        expect(realmB.snapshot()?.data.profile?.height).toBeUndefined();
        const replicaB = (await readSealedArchive())?.replica?.replicaId;
        expect(replicaB).toBeDefined();
        expect(replicaB).not.toBe(pending?.replica?.replicaId);
        expect(fixture.count('sync_receipts', uid)).toBe(1);

        a.select();
        expect((await readSealedArchive())?.cloudflareDelivery?.batch).toEqual(original);
        a.setQuotaExhausted(false);
        const merged = { height: '183', neck: '37' };
        expect((await realmA.refresh()).data.profile).toMatchObject(merged);
        expect(a.commits.map(({ status }) => status)).toEqual([429, 429, 409, 200]);
        expect(a.commits[2].body).toEqual(original);
        expect(a.commits[3].body).toMatchObject({ lastSeq: original.lastSeq, replica: original.replica });
        expect(a.commits[3].body).not.toMatchObject({ batchId: original.batchId });
        expect(await readSealedArchive()).toMatchObject({ baseline: { profile: merged }, pending: [] });
        expect((await readSealedArchive())?.cloudflareDelivery).toBeUndefined();
        expect((await realmA.refresh()).data.profile).toMatchObject(merged);
        expect(a.commits).toHaveLength(4);
        expect(fixture.count('sync_receipts', uid)).toBe(2);
        expect(fixture.sqlite.prepare('SELECT 1 FROM sync_receipts WHERE uid = ? AND batch_id = ?')
            .get(uid, original.batchId)).toBeUndefined();

        b.select();
        expect((await realmB.refresh()).data.profile).toMatchObject(merged);
        expect((await readSealedArchive())?.replica?.replicaId).toBe(replicaB);
        expect(fixture.count('sync_receipts', uid)).toBe(2);
    } finally {
        fixture.close();
    }
});
