import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { UserDataSchema } from '../../../src/lib/schema';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { projectDocuments } from '../../../src/lib/sync/documentProjection';
import { inspectKindeCandidateRetiredReplicaPreflight } from '../../../src/lib/sync/kindeCandidateRetiredReplicaPreflight';
import { inspectKindeCandidateRetiredReplicaWithExistingKey } from '../../../src/lib/sync/kindeCandidateRetiredReplicaReadOnly';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults, unlockVaultForOwner, vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection';
import type { CachedGlobalCatalog, UserData } from '../../../src/types';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));
vi.mock('../../../src/lib/firebase', () => { throw Error('Retired replica preflight must not load Firebase'); });
const accountKeySource = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('../../../src/lib/sync/cloudflareAccountKeyCandidate', () => ({
    acquireCloudflareAccountKeyCandidate: accountKeySource.acquire,
}));

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
    accountKeySource.acquire.mockReset().mockImplementation(() => {
        throw Error('Raw preflight must not acquire or provision an ADK');
    });
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
        expect(accountKeySource.acquire).not.toHaveBeenCalled();
    });

    it('distinguishes cloud conflict and possible lost ACK, but never acknowledges pending', async () => {
        const sealed = await get(storage);
        const seq = (await readLocal(owner))!.pending[0].seq;
        await expect(inspect(network({ remote: data(172) }))).resolves.toEqual({
            kind: 'reconciliation-required', reason: 'cloud-diverged',
            evidence: { changedCloudFieldStamps: 0,
                pendingWithOverlappingCloudStamps: 0, unclassifiedDocuments: 1 },
        });
        await expect(inspect(network({ before: control(8, seq) }))).resolves.toEqual({
            kind: 'reconciliation-required', reason: 'possible-lost-ack',
        });
        const reused = control(8, seq);
        reused.replicas.s03.replicaId = 'another-device';
        reused.replicas.s03.generation = replica.generation + 1;
        await expect(inspect(network({ before: reused }))).resolves.toEqual({
            kind: 'reconciliation-required', reason: 'possible-lost-ack',
        });
        expect(await get(storage)).toBe(sealed);
    });

    it('preserves the encrypted journal when authenticated D1 control contradicts replica lineage', async () => {
        const sealed = await get(storage);
        const contradictory = control();
        contradictory.replicas.s03.replicaId = 'another-id-with-same-generation';
        const send = network({ before: contradictory });
        await expect(inspect(send)).resolves.toEqual({
            kind: 'reconciliation-required', reason: 'unverifiable-lineage',
        });
        expect(await get(storage)).toBe(sealed);
        expect(vi.mocked(send).mock.calls.map(([input]) => String(input)))
            .toEqual(expect.not.arrayContaining(['/v1/sync/commit', '/v1/replica/claim']));
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

    it('acquires the existing ADK only for inspection, then wipes it after an unchanged preflight', async () => {
        const transient = key.slice();
        accountKeySource.acquire.mockImplementation(async (args: { purpose: string; csrfToken: () => string }) => {
            expect(args.purpose).toBe('recovery-inspect');
            expect(args.csrfToken()).toBe(csrf);
            return transient;
        });
        const sealed = await get(storage);
        const send = network();
        const result = await inspectKindeCandidateRetiredReplicaWithExistingKey({
            expected, stillCurrent: () => true, send,
            browserCookies: () => '__Host-logbook_csrf=' + csrf,
        });
        expect(result.kind).toBe('baseline-unchanged');
        expect(accountKeySource.acquire).toHaveBeenCalledTimes(1);
        expect(Array.from(transient)).toEqual(Array(32).fill(0));
        expect(await get(storage)).toBe(sealed);
        expect(vi.mocked(send).mock.calls.every(([input]) =>
            !/cloud-key|commit|claim|retire|receipt/.test(String(input)))).toBe(true);
    });

    it('wipes the inspection key when the session changes during scan or immediately after acquisition', async () => {
        for (const changeDuringScan of [false, true]) {
            let current = true;
            const transient = key.slice();
            accountKeySource.acquire.mockImplementation(async () => {
                if (!changeDuringScan) current = false;
                return transient;
            });
            const send = network({ onScan: async () => { if (changeDuringScan) current = false; } });
            await expect(inspectKindeCandidateRetiredReplicaWithExistingKey({
                expected, stillCurrent: () => current, send,
                browserCookies: () => '__Host-logbook_csrf=' + csrf,
            })).rejects.toThrow();
            expect(Array.from(transient)).toEqual(Array(32).fill(0));
        }
        const grant = await unlockVaultForOwner(owner);
        expect((await readLocal(owner))!.pending.length).toBeGreaterThan(0);
        grant.release();
    });

    it('preserves the vault if no previously issued ADK exists', async () => {
        const sealed = await get(storage);
        accountKeySource.acquire.mockRejectedValueOnce(new Error('no-existing-key'));
        const send = network();
        await expect(inspectKindeCandidateRetiredReplicaWithExistingKey({
            expected, stillCurrent: () => true, send,
            browserCookies: () => '__Host-logbook_csrf=' + csrf,
        })).rejects.toThrow();
        expect(await get(storage)).toBe(sealed);
        expect(vi.mocked(send).mock.calls.some(([input]) => String(input).startsWith('/v1/sync/'))).toBe(false);
    });
});
