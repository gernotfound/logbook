import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde restore must not initialize Firebase');
});
const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { issueVerifiedSession } from '../../../cloudflare/auth/session-issuer.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { createBackup } from '../../../src/lib/backup';
import { prepareKindeCandidatePortableBackupJson } from '../../../src/lib/auth/kindeCandidatePortableBackup';
import { restoreKindeCandidateBackup } from '../../../src/lib/auth/kindeCandidateRestore';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { commitDomainOperations } from '../../../src/lib/sync/localDomainCommit';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { UserDataSchema } from '../../../src/lib/schema';
import { createDefaultNutritionPlanning } from '../../../src/lib/nutritionDefaults';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import {
    lockAllVaults, readVaultControl, unlockVaultForOwner,
} from '../../../src/lib/sync/secureArchiveSession';

const uid = 'k_' + 'R'.repeat(43);
const otherUid = 'k_' + 'S'.repeat(43);
const owner = 'user:' + uid;
const principal = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const catalog = {
    manifest: { version: 'restore-synthetic', updatedAt: '2026-11-19T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};
const parse = (raw: unknown) => UserDataSchema.parse(raw);
const backup = (height = '188') => JSON.parse(JSON.stringify(createBackup(parse({
    profile: { height },
    legalConsent: {
        hasAcceptedTerms: true, hasAcceptedHealthData: true,
        acceptedAt: '2026-11-01T00:00:00.000Z',
        termsVersion: 'previous', privacyVersion: 'previous',
    },
}), owner, { scope: 'cloud-and-device', months: [] })));

type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;
function session(fixture: Fixture, observe: (path: string, response: Response) => Response | Promise<Response> =
    (_path, response) => response) {
    const current = fixture.sessions.get(uid);
    const browserCookies = () => '__Host-logbook_csrf=' + current.csrf;
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', current.cookies);
        const response = await routeCandidateFirstPartyApi(new Request(ORIGIN + path, {
            ...init, headers,
        }), {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
            D1_API: { fetch: (request: Request) => api.fetch(request, env) },
        });
        return observe(path, response);
    };
    return { send, stillCurrent: () => true, browserCookies };
}

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
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

describe('CF-05 Kinde Schema 3 restore to encrypted IndexedDB and D1', () => {
    it('durably writes real business + journal before D1, accepts only a verified remote receipt and preserves current consent', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const observed: string[] = [];
            const request = session(fixture, async (path, response) => {
                observed.push(path);
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    // The HTTP handler has committed, but no receipt has
                    // returned to the browser: the local journal must exist.
                    const staged = await readLocal(owner);
                    expect(staged?.data.profile?.height).toBe('188');
                    expect(staged?.pending.length).toBeGreaterThan(0);
                    expect(staged?.cloudflareDelivery).toBeDefined();
                    expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
                }
                return response;
            });
            const result = await restoreKindeCandidateBackup({
                ...request, expected: principal, backup: backup(),
            });
            expect(result).toEqual({ kind: 'cloud-acknowledged' });
            expect(observed).toContain('/v1/sync/commit');
            expect(observed).toContain('/v1/sync/receipt');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(fixture.count('sync_documents', uid)).toBe(1);

            await unlockVaultForOwner(owner);
            const local = await readLocal(owner);
            expect(local?.pending).toEqual([]);
            expect(local?.cloudflareDelivery).toBeUndefined();
            expect(local?.data.profile?.height).toBe('188');
            expect(local?.baseline).toEqual(local?.data);
            expect(local?.data.legalConsent?.acceptedAt).not.toBe('2026-11-01T00:00:00.000Z');
            expect(local?.data.legalConsent?.hasAcceptedHealthData).toBe(true);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);

            lockAllVaults();
            const repeated = await restoreKindeCandidateBackup({
                ...request, expected: principal, backup: backup(),
            });
            expect(repeated).toEqual({ kind: 'already-current' });
            expect(fixture.count('sync_receipts', uid)).toBe(1);
        } finally { fixture.close(); }
    });

    it('restores a real Kinde-exported JSON onto an independent device vault and new authenticated session', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const first = session(fixture);
            await expect(prepareKindeCandidateOwner({
                ...first, expected: principal,
            })).resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const source = await readLocal(owner);
            const firstControl = readVaultControl(owner);
            const firstReplica = source?.replica;
            await commitDomainOperations(owner, {
                type: 'profile.patch', patch: { height: '180' },
            }, source!.data);
            await expect(deliverKindeCandidateJournal(first)).resolves.toBe('acknowledged');
            const delivered = await readLocal(owner);
            await commitDomainOperations(owner, {
                type: 'profile.patch', patch: { height: '193' },
            }, delivered!.data);
            const file = await prepareKindeCandidatePortableBackupJson({
                ...first, expected: principal,
            });
            expect(file.backup.userData.profile?.height).toBe('193');
            expect(fixture.count('sync_receipts', uid)).toBe(1);

            // Destroy all device-local state. A new identity session receives
            // only the exported JSON; the old DEK, journal and replica do not
            // cross into the next browser profile.
            lockAllVaults();
            localStorage.clear();
            await clear();
            const issued = await issueVerifiedSession(fixture.db, uid);
            const cookies = issued.setCookies.map((value: string) => value.split(';')[0]).join('; ');
            const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
            fixture.sessions.set(uid, { cookies, csrf });
            const second = session(fixture);

            await expect(restoreKindeCandidateBackup({
                ...second, expected: principal, backup: JSON.parse(file.json),
            })).resolves.toEqual({ kind: 'cloud-acknowledged' });
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            expect(fixture.count('sync_documents', uid)).toBe(1);
            await unlockVaultForOwner(owner);
            const restored = await readLocal(owner);
            expect(restored?.data.profile?.height).toBe('193');
            expect(restored?.baseline.profile?.height).toBe('193');
            expect(restored?.pending).toEqual([]);
            expect(restored?.replica?.replicaId).not.toBe(firstReplica?.replicaId);
            expect(readVaultControl(owner)?.wrappedKey).not.toEqual(firstControl?.wrappedKey);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
        } finally { fixture.close(); }
    });

    it('does not report an unrelated edit as a pending restore after the D1 receipt', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commitObserved = false;
            let concurrentEditWritten = false;
            const request = session(fixture, async (path, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commitObserved = true;
                }
                if (path === '/v1/sync/receipt' && commitObserved && !concurrentEditWritten) {
                    expect(response.status).toBe(200);
                    const staged = await readLocal(owner);
                    expect(staged?.data.profile?.height).toBe('188');
                    expect(staged?.cloudflareDelivery).toBeDefined();
                    await commitDomainOperations(owner, {
                        type: 'profile.patch', patch: { height: '192' },
                    }, staged!.data);
                    concurrentEditWritten = true;
                }
                return response;
            });

            const outcome = await restoreKindeCandidateBackup({
                ...request, expected: principal, backup: backup(),
            });
            expect(concurrentEditWritten).toBe(true);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            await unlockVaultForOwner(owner);
            const after = await readLocal(owner);
            expect(after?.baseline.profile?.height).toBe('188');
            expect(after?.data.profile?.height).toBe('192');
            expect(after?.pending).toHaveLength(1);
            expect(after?.cloudflareDelivery).toBeUndefined();
            expect(outcome).toEqual({ kind: 'cloud-acknowledged-with-other-edits' });
        } finally { fixture.close(); }
    });

    it('reports a partially delivered restore from the operations still in its own journal', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const months = Array.from({ length: 9 }, (_, index) => `2025-0${index + 1}`);
            const nutrition = Object.fromEntries(months.map((month, index) => {
                const date = month + '-01';
                return [date, { date, weight: 70 + index }];
            }));
            const file = createBackup(parse({ nutrition }), owner, { scope: 'cloud-and-device', months });

            const outcome = await restoreKindeCandidateBackup({
                ...session(fixture), expected: principal, backup: JSON.parse(JSON.stringify(file)),
            });
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(fixture.count('sync_documents', uid)).toBe(8);
            const grant = await unlockVaultForOwner(owner);
            const after = await readLocal(owner);
            expect(after?.data.nutrition?.['2025-09-01']?.weight).toBe(78);
            expect(after?.baseline.nutrition?.['2025-09-01']).toBeUndefined();
            // Empty keyed collections are normalized without ancestor stamps;
            // only actual business edits occupy the causal journal.
            expect(after?.pending.map(op => [op.docPath, op.path])).toEqual([
                ['nutrition_months/2025-09', ['2025-09-01', 'date']],
                ['nutrition_months/2025-09', ['2025-09-01', 'weight']],
            ]);
            expect(outcome).toEqual({ kind: 'local-pending', pendingCount: 2 });
            grant.release();

            await expect(prepareKindeCandidateOwner({
                ...session(fixture), expected: principal, drainPendingJournal: true, retainDeviceVault: false,
            })).resolves.toMatchObject({ journalDrained: true });
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            expect(fixture.count('sync_documents', uid)).toBe(9);
        } finally { fixture.close(); }
    });

    it('preserves the immutable encrypted journal after a committed D1 response is lost, then resumes without a second commit', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            let withholdReceipt = false;
            const dropped = session(fixture, (path, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits++;
                    withholdReceipt = true;
                    throw new TypeError('synthetic committed D1 response lost');
                }
                if (path === '/v1/sync/receipt' && withholdReceipt) {
                    return Response.json({ error: 'unavailable' }, {
                        status: 503, headers: { 'Cache-Control': 'no-store' },
                    });
                }
                return response;
            });
            await expect(restoreKindeCandidateBackup({
                ...dropped, expected: principal, backup: backup('191'),
            })).rejects.toThrow();
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
            expect(readVaultControl(owner)?.phase).toBe('active');
            await unlockVaultForOwner(owner);
            const pending = await readLocal(owner);
            expect(pending?.pending.length).toBeGreaterThan(0);
            expect(pending?.cloudflareDelivery).toBeDefined();
            expect(pending?.data.profile?.height).toBe('191');
            const staged = pending?.cloudflareDelivery?.batch;
            lockAllVaults();

            const recovered = await prepareKindeCandidateOwner({
                ...session(fixture), expected: principal,
                drainPendingJournal: true, retainDeviceVault: false,
            });
            expect(recovered).toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'already-active',
                journalDrained: true,
            });
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            await unlockVaultForOwner(owner);
            const complete = await readLocal(owner);
            expect(complete?.cloudflareDelivery).toBeUndefined();
            expect(complete?.pending).toEqual([]);
            expect(complete?.baseline.profile?.height).toBe('191');
            expect(staged?.batchId).toBeDefined();
        } finally { fixture.close(); }
    });

    it('reports a metadata-only local restore without inventing a D1 operation or receipt', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const request = session(fixture);
            await expect(prepareKindeCandidateOwner({
                ...request, expected: principal, drainPendingJournal: true,
                retainDeviceVault: false,
            })).resolves.toMatchObject({ journalDrained: true });
            await unlockVaultForOwner(owner);
            const before = await readLocal(owner);
            expect(before?.pending).toEqual([]);
            expect(before?.data.pendingConflicts).toBeUndefined();
            const conflict = createDefaultNutritionPlanning();
            const input = JSON.parse(JSON.stringify(createBackup(parse({
                ...before!.data, pendingConflicts: { nutritionPlanning: conflict },
            }), owner, { scope: 'cloud-and-device', months: [] })));
            lockAllVaults();

            await expect(restoreKindeCandidateBackup({
                ...request, expected: principal, backup: input,
            })).resolves.toEqual({ kind: 'local-metadata-restored' });
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            expect(fixture.count('sync_documents', uid)).toBe(0);
            await unlockVaultForOwner(owner);
            const after = await readLocal(owner);
            expect(after?.data.pendingConflicts?.nutritionPlanning).toEqual(conflict);
            expect(after?.pending).toEqual([]);
            expect(after?.revision).toBeGreaterThan(before!.revision);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
        } finally { fixture.close(); }
    });

    it('rejects foreign and incomplete JSON before provisioning keys, contacting D1 or modifying local data', async () => {
        const send = vi.fn<typeof fetch>();
        const opts = {
            expected: principal, stillCurrent: () => true,
            browserCookies: () => '__Host-logbook_csrf=' + 'A'.repeat(43),
            send,
        };
        for (const invalid of [
            { ...backup(), owner: 'user:' + otherUid },
            { ...backup(), coverage: { scope: 'device', months: [] } },
            { ...backup(), type: 'share' },
            { ...backup(), version: 999 },
        ]) {
            await expect(restoreKindeCandidateBackup({ ...opts, backup: invalid })).rejects.toThrow();
        }
        expect(send).not.toHaveBeenCalled();
        expect(await get('logbook:v2:' + owner)).toBeUndefined();
        expect(readVaultControl(owner)).toBeNull();
    });
});
