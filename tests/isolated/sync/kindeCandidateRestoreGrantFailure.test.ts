import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vaultRace = vi.hoisted(() => ({
    bootstrapReady: false, grantIssued: false, keyCheckRejected: false, releases: 0,
}));
const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde restore must not load Firebase');
});
vi.mock('../../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: catalogSource.read,
}));

vi.mock('../../../src/lib/sync/secureArchiveSession', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/lib/sync/secureArchiveSession')>();
    return {
        ...actual,
        unlockVaultForOwner: async (...args: Parameters<typeof actual.unlockVaultForOwner>) => {
            const grant = await actual.unlockVaultForOwner(...args);
            if (!vaultRace.bootstrapReady) return grant;
            vaultRace.grantIssued = true;
            return {
                isCurrent: grant.isCurrent,
                release: () => { vaultRace.releases += 1; grant.release(); },
            };
        },
        requireUnlockedLocalKey: (owner: string) => {
            if (vaultRace.grantIssued && !vaultRace.keyCheckRejected) {
                vaultRace.keyCheckRejected = true;
                throw new actual.LocalVaultLockedError();
            }
            return actual.requireUnlockedLocalKey(owner);
        },
    };
});

vi.mock('../../../src/lib/sync/kindeCandidateOwnerBootstrap', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/lib/sync/kindeCandidateOwnerBootstrap')>();
    return {
        ...actual,
        prepareKindeCandidateOwner: async (
            ...args: Parameters<typeof actual.prepareKindeCandidateOwner>
        ) => {
            const result = await actual.prepareKindeCandidateOwner(...args);
            if (result.kind === 'candidate-observed') vaultRace.bootstrapReady = true;
            return result;
        },
    };
});

import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { createBackup } from '../../../src/lib/backup';
import { restoreKindeCandidateBackup } from '../../../src/lib/auth/kindeCandidateRestore';
import { UserDataSchema } from '../../../src/lib/schema';
import { isVaultUnlocked, lockAllVaults, LocalVaultLockedError } from '../../../src/lib/sync/secureArchiveSession';

const uid = 'k_' + 'V'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const catalog = {
    manifest: {
        version: 'kinde-grant-recovery', updatedAt: '2026-11-20T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    Object.assign(vaultRace, {
        bootstrapReady: false, grantIssued: false, keyCheckRejected: false, releases: 0,
    });
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, task: () => Promise<unknown>) => task(),
    } });
});

afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Kinde candidate restore vault release after a post-unlock failure', () => {
    it('releases the exact DEK grant when the first capability inspection is rejected', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const session = fixture.sessions.get(uid);
            if (!session) throw Error('Synthetic session missing');
            const send: typeof fetch = async (input, init) => {
                const path = String(input);
                const headers = new Headers(init?.headers);
                headers.set('origin', ORIGIN);
                headers.set('sec-fetch-site', 'same-origin');
                headers.set('cookie', session.cookies);
                const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
                return routeCandidateFirstPartyApi(
                    new Request(ORIGIN + path, { ...init, headers }), {
                        APP_ORIGIN: ORIGIN,
                        KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
                        D1_API: { fetch: (request: Request) => api.fetch(request, env) },
                    },
                );
            };
            const backup = createBackup(
                UserDataSchema.parse({ profile: { height: '188' } }),
                owner, { scope: 'cloud-and-device', months: [] },
            );
            await expect(restoreKindeCandidateBackup({
                expected, backup, send, stillCurrent: () => true,
                browserCookies: () => '__Host-logbook_csrf=' + session.csrf,
            })).rejects.toBeInstanceOf(LocalVaultLockedError);

            expect(vaultRace.bootstrapReady).toBe(true);
            expect(vaultRace.grantIssued).toBe(true);
            expect(vaultRace.keyCheckRejected).toBe(true);
            expect(vaultRace.releases).toBe(1);
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            expect(fixture.count('sync_documents', uid)).toBe(0);
        } finally {
            fixture.close();
        }
    });
});
