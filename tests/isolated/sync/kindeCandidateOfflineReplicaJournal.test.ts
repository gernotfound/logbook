import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData } from '../../../src/types';
import { inspectKindeCandidateOfflineReplicaJournal } from '../../../src/lib/sync/kindeCandidateOfflineReplicaJournal';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { LocalVaultLockedError, lockAllVaults, unlockVaultForOwner, vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));
vi.mock('../../../src/lib/firebase', () => { throw Error('Offline inspection must not load Firebase'); });
vi.mock('../../../src/lib/sync/cloudflareAccountKeyCandidate', () => { throw Error('Offline inspection must not acquire ADK'); });

const uid = 'k_' + 'A'.repeat(43);
const owner = `user:${uid}`;
const storage = `logbook:v2:${owner}`;
const csrf = 'A'.repeat(43);
const expected = { uid, fenceEpoch: 5, healthConsentRevision: 1 };
const legal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-16T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const data = (height: number) => UserDataSchema.parse({
    profile: { height: String(height) }, legalConsent: legal,
}) as unknown as UserData;
const replica = { slot: 's04', replicaId: 'previous-device', generation: 2,
    leaseUntilMs: Date.now() + 86400000, checkpointAtMs: Date.now() };
const membership = (status: 'active' | 'retired' = 'active') => ({
    ...replica, status, lastSeq: 0, checkpointClock: {},
});
const control = (replicas: Record<string, ReturnType<typeof membership>> = { s04: membership() }) => ({
    uid, revision: 8, fenceEpoch: 5, consentRevision: 1, replicas,
});
const response = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
const session = (user = uid) => ({ authenticated: true, emailVerified: true,
    uid: user, fenceEpoch: 5, healthConsentRevision: 1 });
const consent = () => ({ uid, status: 'active', revision: 1, fenceEpoch: 5,
    acceptedAt: legal.acceptedAt, observedAtMs: Date.parse(legal.acceptedAt),
    privacyVersion: legal.privacyVersion, termsVersion: legal.termsVersion });

function network({
    snapshots = [control(), control()], mutate, secondUid,
}: { snapshots?: Array<ReturnType<typeof control>>; mutate?: () => Promise<void>;
    secondUid?: string } = {}) {
    let reads = 0;
    let sessionCalls = 0;
    const send = vi.fn<typeof fetch>(async input => {
        const path = String(input);
        if (path === '/api/auth/session') {
            sessionCalls += 1;
            return response(session(secondUid && sessionCalls > 3 ? secondUid : uid));
        }
        if (path === '/v1/consent/status') return response(consent());
        if (path === '/v1/sync/control') {
            const snapshot = snapshots[reads++] ?? snapshots.at(-1)!;
            if (mutate && reads === 1) await mutate();
            return response(snapshot);
        }
        throw Error('Unexpected write or untrusted read: ' + path);
    });
    return send;
}
const inspect = (send: typeof fetch, stillCurrent = () => true) =>
    inspectKindeCandidateOfflineReplicaJournal({
        expected, stillCurrent, send, browserCookies: () => '__Host-logbook_csrf=' + csrf,
    });

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    localStorage.setItem(`${storage}:health-consent-generation`, '1');
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
        callback: () => Promise<unknown>) => callback() } });
    catalogSource.read.mockReset().mockResolvedValue({
        manifest: { version: 'offline-journal-fixture', updatedAt: '2026-11-16T00:00:00.000Z',
            schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
            itemCounts: { exercises: 0, foods: 0 } },
        exercises: [], foods: [], cachedAt: 0,
    });
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function withOldPending() {
    await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 }, {
        clock: {}, syncMetaByDocument: {},
    });
    await commitLocal(owner, data(171), data(170));
    const original = await readLocal(owner);
    expect(original?.pending.length).toBeGreaterThan(0);
    return original!;
}

describe('Kinde candidate: read-only retired replica journal inspection', () => {
    it.each([
        ['retired', control({ s04: membership('retired') }), 'retired'],
        ['replaced', control({ s04: { ...membership(), replicaId: 'new-device', generation: 3 } }), 'replaced'],
        ['expired', control({ s04: { ...membership(), leaseUntilMs: Date.now() - 60000 } }), 'expired'],
        ['missing', control({}), 'missing'],
    ] as const)('recognizes %s without ACK, claim, ADK or modifying encrypted pending', async (_name, snapshot, reason) => {
        const original = await withOldPending();
        const sealed = await get(storage);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        const send = network({ snapshots: [snapshot, snapshot] });
        await expect(inspect(send)).resolves.toEqual({ kind: 'retired-pending', reason,
            slot: replica.slot, generation: replica.generation, pendingOperations: original.pending.length });
        expect(await get(storage)).toBe(sealed);
        expect(vi.mocked(send).mock.calls.filter(([path]) => String(path).startsWith('/v1/sync/'))).toHaveLength(2);
        expect(vi.mocked(send).mock.calls.every(([path]) => !/claim|commit|scan|cloud-key/.test(String(path)))).toBe(true);
        const grant = await unlockVaultForOwner(owner);
        expect((await readLocal(owner))?.pending).toEqual(original.pending);
        grant.release();
    });

    it('distinguishes the still-active old incarnation from a retired one without claiming delivery', async () => {
        const old = await withOldPending();
        const send = network();
        await expect(inspect(send)).resolves.toEqual({ kind: 'active-pending',
            slot: replica.slot, generation: replica.generation, pendingOperations: old.pending.length });
        expect(vi.mocked(send).mock.calls.filter(([path]) => String(path) === '/v1/sync/control')).toHaveLength(2);
    });

    it('does not mistake a first claim or an empty journal for a retired replica', async () => {
        await expect(inspect(network())).resolves.toEqual({ kind: 'no-pending' });
        await unlockVaultForOwner(owner);
        await commitLocal(owner, data(171), data(170));
        const pending = (await readLocal(owner))!.pending.length;
        const send = network();
        await expect(inspect(send)).resolves.toEqual({ kind: 'first-claim-pending', pendingOperations: pending });
        expect(vi.mocked(send).mock.calls.some(([path]) => String(path) === '/v1/sync/control')).toBe(false);
    });

    it('reports an in-flight mutation separately without issuing another request', async () => {
        const before = await withOldPending();
        await updateArchiveRecord<unknown>(owner, raw => ({
            ...(raw as Record<string, unknown>), cloudflareReplicaClaim: {
                mutationId: 'held-mutation-id-123', expectedRevision: 8, expectedFenceEpoch: 5,
                consentRevision: 1, candidateReplicaId: 'another-device', currentReplica: {
                    slot: replica.slot, replicaId: replica.replicaId, generation: replica.generation,
                }, checkpointClock: {},
            },
        }));
        const send = network();
        await expect(inspect(send)).resolves.toEqual({
            kind: 'transition-pending', pendingOperations: before.pending.length,
        });
        expect(vi.mocked(send).mock.calls.some(([path]) => String(path) === '/v1/sync/control')).toBe(false);
    });

    it('fails closed for a foreign account, stale controls or a simultaneous local edit', async () => {
        await withOldPending();
        const original = await get(storage);
        await expect(inspect(network({ secondUid: 'k_' + 'B'.repeat(43) })))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        await expect(inspect(network({ snapshots: [control(), { ...control(), revision: 9 }] })))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        await expect(inspect(network({ snapshots: [{ ...control(), uid: 'another-owner' }] })))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(await get(storage)).toBe(original);
        await expect(inspect(network({ mutate: async () => { await commitLocal(owner, data(172), data(171)); } })))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect((await get(storage))!).not.toBe(original);
        const grant = await unlockVaultForOwner(owner);
        expect((await readLocal(owner))?.data.profile?.height).toBe('172');
        grant.release();
    });

    it('does not open a vault or D1 after guest marker, revoked consent, or session invalidation', async () => {
        await withOldPending();
        for (const setup of [
            () => localStorage.setItem('logbook_is_guest', 'true'),
            () => localStorage.setItem(`${storage}:health-consent-withdrawal`, 'pending:1'),
        ]) {
            setup();
            const send = network();
            await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
            localStorage.removeItem('logbook_is_guest');
            localStorage.removeItem(`${storage}:health-consent-withdrawal`);
        }
        const send = network();
        await expect(inspect(send, () => false)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).not.toHaveBeenCalled();
    });

    it('preserves a damaged device vault instead of reporting an empty offline journal', async () => {
        await withOldPending();
        const sealed = await get(storage);
        lockAllVaults();
        localStorage.setItem(vaultControlKey(owner), '{invalid');
        const send = network();
        await expect(inspect(send)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(vi.mocked(send).mock.calls.some(([path]) => String(path) === '/v1/sync/control')).toBe(false);
        expect(await get(storage)).toBe(sealed);
    });

    it('does not publish a registry observation when the caller loses its session mid-read', async () => {
        await withOldPending();
        const sealed = await get(storage);
        let live = true;
        const send = network({ mutate: async () => { live = false; } });
        await expect(inspect(send, () => live)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(vi.mocked(send).mock.calls.filter(([path]) => String(path) === '/v1/sync/control')).toHaveLength(1);
        expect(await get(storage)).toBe(sealed);
    });
});
