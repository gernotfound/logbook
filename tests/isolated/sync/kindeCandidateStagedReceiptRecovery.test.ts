import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { UserDataSchema } from '../../../src/lib/schema';
import { stageCloudflareDelivery } from '../../../src/lib/sync/cloudReplicaDurableDelivery';
import { recoverKindeCandidateStagedReceipt } from '../../../src/lib/sync/kindeCandidateStagedReceiptRecovery';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import type { CloudReplicaControlSnapshot, CloudReplicaSnapshot } from '../../../src/lib/sync/cloudReplicaTransport';
import type { CachedGlobalCatalog, UserData } from '../../../src/types';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));
vi.mock('../../../src/lib/firebase', () => { throw Error('Kinde receipt recovery must not load Firebase'); });
const accountKeySource = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('../../../src/lib/sync/cloudflareAccountKeyCandidate', () => ({
    acquireCloudflareAccountKeyCandidate: accountKeySource.acquire,
}));

const uid = 'k_' + 'B'.repeat(43);
const owner = `user:${uid}`;
const storage = `logbook:v2:${owner}`;
const csrf = 'A'.repeat(43);
const expected = { uid, fenceEpoch: 5, healthConsentRevision: 1 };
const adk = new Uint8Array(32).fill(23);
const legal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-16T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const profile = (height: number) => UserDataSchema.parse({ profile: { height: String(height) },
    legalConsent: legal }) as unknown as UserData;
const catalog: CachedGlobalCatalog = {
    manifest: { version: 'receipt-recovery-fixture', updatedAt: legal.acceptedAt,
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};
const response = (body: unknown) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });

function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
        const item = value as Record<string, unknown>;
        return '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + canonical(item[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}

async function seed(staged = true) {
    await createAndMigrateVault(owner);
    await initializeLocal(owner, profile(170));
    await updateArchiveRecord<unknown>(owner, raw => ({ ...(raw as object), consentRevision: 1 }));
    const now = Date.now();
    const replica = { slot: 's02', replicaId: 'old-logged-device', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 86_400_000 };
    await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 }, {
        clock: {}, syncMetaByDocument: {},
    });
    await commitLocal(owner, profile(171), profile(170));
    if (!staged) return;
    const local = (await readLocal(owner))!;
    const snapshot: CloudReplicaSnapshot = { revision: 0, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision: null, document: null }] };
    const control: CloudReplicaControlSnapshot = { uid, revision: 0, fenceEpoch: 5, consentRevision: 1,
        replicas: { s02: { ...replica, status: 'active', lastSeq: 0, checkpointClock: {} } } };
    await stageCloudflareDelivery(owner, local.pending, snapshot, control, replica,
        'historical-batch-001', adk, () => true);
}

function network({ receipt = true, forged = false, onReceipt }: {
    receipt?: boolean; forged?: boolean; onReceipt?: () => Promise<void>;
} = {}) {
    const send = vi.fn<typeof fetch>(async (input, init) => {
        const path = String(input);
        if (path === '/api/auth/session') return response({ authenticated: true, emailVerified: true,
            uid, fenceEpoch: 5, healthConsentRevision: 1 });
        if (path === '/v1/consent/status') return response({ uid, status: 'active', revision: 1,
            fenceEpoch: 5, acceptedAt: legal.acceptedAt, observedAtMs: Date.parse(legal.acceptedAt),
            privacyVersion: legal.privacyVersion, termsVersion: legal.termsVersion });
        if (path === '/v1/sync/receipt') {
            if (onReceipt) await onReceipt();
            if (!receipt) return response({ receipt: null });
            const batch = (await readLocal(owner))!.cloudflareDelivery!.batch;
            const request = JSON.parse(String(init?.body)) as { batchId: string };
            expect(request).toEqual({ batchId: batch.batchId });
            const requestHash = forged ? '0'.repeat(64)
                : createHash('sha256').update(canonical(batch)).digest('hex');
            return response({ receipt: { revision: batch.expectedRevision + 1,
                lastSeq: batch.lastSeq, consentRevision: batch.consentRevision,
                replica: batch.replica, requestHash } });
        }
        throw Error('Unexpected cloud mutation or key provisioning: ' + path);
    });
    return send;
}

const recover = (send: typeof fetch, stillCurrent = () => true) =>
    recoverKindeCandidateStagedReceipt({ expected, send, stillCurrent,
        browserCookies: () => '__Host-logbook_csrf=' + csrf });

async function openLocal() {
    const grant = await unlockVaultForOwner(owner);
    try { return await readLocal(owner); }
    finally { grant.release(); }
}

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    localStorage.setItem(`${storage}:health-consent-generation`, '1');
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
        action: () => Promise<unknown>) => action() } });
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    accountKeySource.acquire.mockReset().mockImplementation(async (args: { purpose: string }) => {
        expect(args.purpose).toBe('recovery-inspect');
        return adk.slice();
    });
    await seed();
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Kinde candidate: old sealed delivery receipt only', () => {
    it('ACKs only the content-bound historical batch, retaining the original replica and later local edits', async () => {
        const before = (await readLocal(owner))!;
        const key = adk.slice();
        accountKeySource.acquire.mockResolvedValueOnce(key);
        const send = network({ onReceipt: async () => {
            await commitLocal(owner, profile(172), profile(171));
        } });
        await expect(recover(send)).resolves.toBe('acknowledged');
        const after = (await openLocal())!;
        expect(after.cloudflareDelivery).toBeUndefined();
        expect(after.pending).toHaveLength(1);
        expect(after.pending[0].seq).toBeGreaterThan(before.pending[0].seq);
        expect(after.baseline.profile?.height).toBe('171');
        expect(after.data.profile?.height).toBe('172');
        expect(after.replica).toEqual(before.replica);
        expect(vi.mocked(send).mock.calls.map(([input]) => String(input)))
            .not.toContain('/v1/sync/commit');
        expect(vi.mocked(send).mock.calls.filter(([input]) => String(input) === '/v1/sync/receipt'))
            .toHaveLength(1);
        expect(Array.from(key)).toEqual(Array(32).fill(0));
    });

    it('preserves the exact ciphertext and pending journal if no historical receipt exists', async () => {
        const sealed = await get(storage);
        const before = await readLocal(owner);
        await expect(recover(network({ receipt: false }))).resolves.toBe('unconfirmed');
        expect(await get(storage)).toBe(sealed);
        expect(await openLocal()).toEqual(before);
    });

    it('never fetches ADK or sends a receipt when no sealed delivery exists', async () => {
        await updateArchiveRecord<unknown>(owner, raw => {
            const local = { ...(raw as Record<string, unknown>) };
            delete local.cloudflareDelivery;
            return { ...local, revision: Number(local.revision) + 1 };
        });
        const sealed = await get(storage);
        const send = network();
        await expect(recover(send)).resolves.toBe('idle');
        expect(accountKeySource.acquire).not.toHaveBeenCalled();
        expect(vi.mocked(send).mock.calls.some(([input]) => String(input).startsWith('/v1/sync/'))).toBe(false);
        expect(await get(storage)).toBe(sealed);
    });

    it('rejects a forged receipt hash or a revoked local consent without retiring ciphertext', async () => {
        const sealed = await get(storage);
        await expect(recover(network({ forged: true }))).rejects.toThrow();
        expect(await get(storage)).toBe(sealed);
        localStorage.setItem(`${storage}:health-consent-withdrawal`, 'pending:1');
        const send = network();
        await expect(recover(send)).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
    });

    it('rejects a session invalidated during receipt and wipes the operation key', async () => {
        const sealed = await get(storage);
        const key = adk.slice();
        let active = true;
        accountKeySource.acquire.mockResolvedValueOnce(key);
        const send = network({ onReceipt: async () => { active = false; } });
        await expect(recover(send, () => active)).rejects.toThrow();
        expect(Array.from(key)).toEqual(Array(32).fill(0));
        expect(await get(storage)).toBe(sealed);
    });

    it('rejects a replaced CSRF cookie with the same UID and server epoch', async () => {
        const sealed = await get(storage);
        let cookie = '__Host-logbook_csrf=' + csrf;
        const send = network({ onReceipt: async () => {
            cookie = '__Host-logbook_csrf=' + 'B'.repeat(42) + 'A';
        } });
        await expect(recoverKindeCandidateStagedReceipt({ expected, send, stillCurrent: () => true,
            browserCookies: () => cookie })).rejects.toThrow();
        expect(await get(storage)).toBe(sealed);
    });

    it('cannot turn a missing previously issued ADK into an empty remote receipt', async () => {
        const sealed = await get(storage);
        accountKeySource.acquire.mockRejectedValueOnce(new Error('key not issued'));
        const send = network();
        await expect(recover(send)).rejects.toThrow();
        expect(vi.mocked(send).mock.calls.some(([input]) => String(input).startsWith('/v1/sync/'))).toBe(false);
        expect(await get(storage)).toBe(sealed);
    });
});
