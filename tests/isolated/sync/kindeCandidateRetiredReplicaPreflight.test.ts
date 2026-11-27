import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { UserDataSchema } from '../../../src/lib/schema';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { projectDocuments } from '../../../src/lib/sync/documentProjection';
import { inspectKindeCandidateRetiredReplicaPreflight } from '../../../src/lib/sync/kindeCandidateRetiredReplicaPreflight';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults, unlockVaultForOwner, vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection';
import type { CachedGlobalCatalog, UserData } from '../../../src/types';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));
vi.mock('../../../src/lib/firebase', () => { throw Error('Retired replica preflight must not load Firebase'); });
vi.mock('../../../src/lib/sync/cloudflareAccountKeyCandidate', () => {
    throw Error('Read-only preflight must not acquire or provision an ADK');
});

const uid = 'k_' + 'A'.repeat(43);
const owner = `user:${uid}`;
const storage = `logbook:v2:${owner}`;
const key = new Uint8Array(32).fill(31);
const csrf = 'A'.repeat(43);
const expected = { uid, fenceEpoch: 5, healthConsentRevision: 1 };
const replica = { slot: 's03', replicaId: 'old-device', generation: 2,
    leaseUntilMs: Date.now() + 86_400_000, checkpointAtMs: Date.now() };
const legal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-16T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) },
    legalConsent: legal }) as unknown as UserData;
const meta: SyncMeta = { protocolVersion: 3, clock: {}, fields: {},
    writer: { slot: replica.slot, replicaId: replica.replicaId,
        generation: replica.generation, seq: 0, consentRevision: 1 } };
const catalog = {
    manifest: { version: 'retired-preflight', updatedAt: legal.acceptedAt,
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
} as CachedGlobalCatalog;
const control = (revision = 8, lastSeq = 0) => ({
    uid, revision, fenceEpoch: 5, consentRevision: 1,
    replicas: { s03: { ...replica, status: 'retired' as const, lastSeq, checkpointClock: {} } },
});
const response = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
const session = (fenceEpoch = 5) => ({ authenticated: true, emailVerified: true,
    uid, fenceEpoch, healthConsentRevision: 1 });
const consent = () => ({ uid, status: 'active', revision: 1, fenceEpoch: 5,
    acceptedAt: legal.acceptedAt, observedAtMs: Date.parse(legal.acceptedAt),
    privacyVersion: legal.privacyVersion, termsVersion: legal.termsVersion });

function network({
    before = control(), after = before, remote = data(170), corrupt = false,
    onScan, sessionEpoch = () => 5,
}: {
    before?: ReturnType<typeof control>;
    after?: ReturnType<typeof control>;
    remote?: UserData;
    corrupt?: boolean;
    onScan?: () => Promise<void>;
    sessionEpoch?: () => number;
} = {}) {
    let controlReads = 0;
    const send = vi.fn<typeof fetch>(async input => {
        const path = String(input);
        if (path === '/api/auth/session') return response(session(sessionEpoch()));
        if (path === '/v1/consent/status') return response(consent());
        if (path === '/v1/sync/control') return response(controlReads++ === 0 ? before : after);
        if (path === '/v1/sync/scan') {
            if (onScan) await onScan();
            const business = projectDocuments(remote, catalog).get('')!;
            return response({ revision: before.revision, fenceEpoch: 5, consentRevision: 1,
                documents: [{ path: '', revision: before.revision,
                    document: sealCloudDocument(key, corrupt ? 'wrong-owner' : uid, '', business, meta) }],
                complete: true, nextAfter: null });
        }
        throw Error('Unexpected mutation or key provisioning: ' + path);
    });
    return send;
}
const inspect = (send: typeof fetch, stillCurrent = () => true) =>
    inspectKindeCandidateRetiredReplicaPreflight({
        expected, accountKey: key, send, stillCurrent,
        browserCookies: () => '__Host-logbook_csrf=' + csrf,
    });

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    localStorage.setItem(`${storage}:health-consent-generation`, '1');
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
        callback: () => Promise<unknown>) => callback() } });
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
    // The trusted consent receipt belongs to this owner before replica claim.
    const { updateArchiveRecord } = await import('../../../src/lib/sync/secureArchiveRepository');
    await updateArchiveRecord<unknown>(owner, raw => ({
        ...(raw as Record<string, unknown>), consentRevision: 1,
    }));
    await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 }, {
        clock: {}, syncMetaByDocument: { '': meta },
    });
    await commitLocal(owner, data(171), data(170));
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Kinde candidate: authenticated retired replica preflight', () => {
    it('joins owner vault, complete AEAD scan and two matching controls without any write or ADK request', async () => {
        const sealed = await get(storage);
        const local = (await readLocal(owner))!;
        const send = network();
        await expect(inspect(send)).resolves.toEqual({
            kind: 'baseline-unchanged', pendingOperations: local.pending.length, cloudRevision: 8,
        });
        expect(await get(storage)).toBe(sealed);
        const paths = vi.mocked(send).mock.calls.map(([input]) => String(input));
        expect(paths.filter(path => path === '/v1/sync/control')).toHaveLength(2);
        expect(paths.filter(path => path === '/v1/sync/scan')).toHaveLength(1);
        expect(paths.every(path => !/cloud-key|commit|claim|retire|receipt/.test(path))).toBe(true);
    });

    it('distinguishes cloud conflict and possible lost ACK, but never acknowledges pending', async () => {
        const sealed = await get(storage);
        const seq = (await readLocal(owner))!.pending[0].seq;
        await expect(inspect(network({ remote: data(172) }))).resolves.toEqual({
            kind: 'reconciliation-required', reason: 'cloud-diverged',
        });
        await expect(inspect(network({ before: control(8, seq) }))).resolves.toEqual({
            kind: 'reconciliation-required', reason: 'possible-lost-ack',
        });
        expect(await get(storage)).toBe(sealed);
    });

    it('fails closed for cloud control drift, corrupt AEAD or a local edit during scan', async () => {
        const sealed = await get(storage);
        await expect(inspect(network({ before: { ...control(), uid: 'another-owner' } })))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        await expect(inspect(network({ after: control(9) }))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        await expect(inspect(network({ corrupt: true }))).rejects.toThrow();
        expect(await get(storage)).toBe(sealed);
        await expect(inspect(network({ onScan: async () => {
            await commitLocal(owner, data(172), data(171));
        } }))).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        const grant = await unlockVaultForOwner(owner);
        expect((await readLocal(owner))!.pending.length).toBeGreaterThan(0);
        grant.release();
    });

    it('blocks same-owner session epoch change and revoked consent before trusting the scan', async () => {
        let epoch = 5;
        const send = network({ onScan: async () => { epoch = 6; }, sessionEpoch: () => epoch });
        await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        localStorage.setItem(`${storage}:health-consent-withdrawal`, 'pending:1');
        const blocked = network();
        await expect(inspect(blocked)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(blocked).not.toHaveBeenCalled();
    });

    it('rejects a replaced CSRF cookie even when UID, consent and epoch are unchanged', async () => {
        let cookie = '__Host-logbook_csrf=' + csrf;
        const send = network({ onScan: async () => {
            cookie = '__Host-logbook_csrf=' + 'B'.repeat(43);
        } });
        await expect(inspectKindeCandidateRetiredReplicaPreflight({
            expected, accountKey: key, stillCurrent: () => true, send, browserCookies: () => cookie,
        })).rejects.toThrow();
    });

    it('does not provision or reclassify a missing/corrupt device vault as an empty archive', async () => {
        lockAllVaults();
        localStorage.setItem(vaultControlKey(owner), '{invalid');
        const sealed = await get(storage);
        const send = network();
        await expect(inspect(send)).rejects.toThrow();
        expect(await get(storage)).toBe(sealed);
        expect(vi.mocked(send).mock.calls.some(([input]) => String(input).startsWith('/v1/sync/'))).toBe(false);
    });
});
