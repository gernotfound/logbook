import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { UserData, CachedGlobalCatalog } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim, resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaMutationReconciliationRequiredError } from '../../../src/lib/sync/cloudReplicaTransport';
import { initializeLocal, readLocal, commitLocal, adoptReplicaCheckpoint } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';

const owner = 'user:a';
const uid = 'a';
const storage = 'logbook:v2:user:a';
const key = new Uint8Array(32).fill(27);
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'claim-recovery-fixture', updatedAt: '2026-11-13T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const data = (height: number) =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
    } });
    localStorage.setItem('logbook:v2:user:a:health-consent-generation', '1');
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
    await initializeLocal(owner, data(170));
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function prepare() {
    const cloud = sealCloudDocument(key, uid, '', { profile: { height: '168' } }, {
        protocolVersion: 3, clock: { s00: 1 }, fields: {},
        writer: { slot: 's00', replicaId: 'existing-remote', generation: 1,
            seq: 1, consentRevision: 1 },
    });
    const snapshot = async (revision: number) => ({
        revision, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision, document: cloud }],
    });
    const verified = await readAuthenticatedCloudflareCheckpoint(
        () => snapshot(0), uid, key, 1, () => true,
    );
    const control = { revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} };
    const staged = await stageCloudflareReplicaClaim(owner, verified, control,
        'durable-new-device', () => true);
    return { snapshot, staged };
}

function transport(snapshot: (revision: number) => Promise<{
    revision: number; fenceEpoch: number; consentRevision: number;
    documents: Array<{ path: string; revision: number; document: ReturnType<typeof sealCloudDocument> }>;
}>) {
    const now = Date.now();
    const replica = {
        slot: 's01', replicaId: 'durable-new-device', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 86400000,
    };
    const mutationResult = {
        mutationId: '', action: 'register' as const, revision: 1, currentRevision: 1,
        reconciliationRequired: false, replayed: true, baseSeq: 0, replica,
    };
    return {
        replica,
        replayStoredClaim: vi.fn(async (claim: { mutationId: string }, csrf: string) => {
            expect(csrf).toBe('session-csrf');
            return { ...mutationResult, mutationId: claim.mutationId };
        }),
        control: vi.fn(async () => ({
            revision: 1, fenceEpoch: 5, consentRevision: 1,
            replicas: {
                s01: { ...replica, lastSeq: 0, status: 'active' as const,
                    checkpointClock: { s00: 1 } },
            },
        })),
        scanAll: vi.fn(async () => snapshot(1)),
    };
}

describe('candidate encrypted D1 claim intent', () => {
    it('persists the request before network and atomically adopts after a fresh AEAD scan', async () => {
        const { staged, snapshot } = await prepare();
        expect(staged.mutationId).toMatch(/^[0-9a-f-]{36}$/);
        const sealed = await get(storage);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(JSON.stringify(sealed)).not.toContain('durable-new-device');
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(staged);

        const remote = transport(snapshot);
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('adopted');
        expect(remote.replayStoredClaim).toHaveBeenCalledWith(staged, 'session-csrf');
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.control).toHaveBeenCalledTimes(2);
        const local = (await readLocal(owner))!;
        expect(local.cloudflareReplicaClaim).toBeUndefined();
        expect(local.replica).toEqual(remote.replica);
        expect(local.actorId).toBe(remote.replica.slot);
        expect(local.clock).toEqual({ s00: 1 });
        expect(await resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .toBe('idle');
    });

    it('keeps the same mutation ID and all journal edits after a network timeout, then recovers', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(new Error('lost reply'));
        const saved = await get(storage);
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .rejects.toThrow('lost reply');
        expect(await get(storage)).toBe(saved);
        const pending = (await readLocal(owner))!.pending;
        expect(pending.length).toBeGreaterThan(0);

        expect(await resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .toBe('adopted');
        expect(remote.replayStoredClaim).toHaveBeenCalledTimes(2);
        expect(remote.replayStoredClaim.mock.calls[0][0]).toEqual(staged);
        expect(remote.replayStoredClaim.mock.calls[1][0]).toEqual(staged);
        expect((await readLocal(owner))!.pending.length).toBeGreaterThan(0);
        expect((await readLocal(owner))!.pending.every(op => op.actorId === 's01')).toBe(true);
    });

    it('retains the sealed intent when a historical reply is not a current grant', async () => {
        const { snapshot } = await prepare();
        const before = await get(storage);
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: 'historic', action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(before);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toBeDefined();
    });

    it('adopts a historical claim only after an unchanged active replica and a fresh AEAD scan', async () => {
        const { staged, snapshot } = await prepare();
        await commitLocal(owner, data(171), data(170));
        const pendingBefore = (await readLocal(owner))!.pending;
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        remote.control.mockImplementation(async () => ({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: {
                s01: { ...remote.replica, lastSeq: 0, status: 'active' as const,
                    checkpointClock: { s00: 1 } },
            },
        }));
        remote.scanAll.mockImplementation(async () => snapshot(2));

        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('adopted');
        expect(remote.replayStoredClaim).toHaveBeenCalledWith(staged, 'session-csrf');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        const local = (await readLocal(owner))!;
        expect(local.cloudflareReplicaClaim).toBeUndefined();
        expect(local.replica).toEqual(remote.replica);
        expect(local.pending.length).toBeGreaterThan(0);
        expect(local.pending.every(op => op.actorId === 's01')).toBe(true);
        expect(pendingBefore.length).toBeGreaterThan(0);
    });

    it('retains a historical claim when the remote causal clock changed since staging', async () => {
        const { staged, snapshot } = await prepare();
        const sealed = await get(storage);
        const remote = transport(snapshot);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        remote.control.mockImplementation(async () => ({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: {
                s01: { ...remote.replica, lastSeq: 0, status: 'active' as const,
                    checkpointClock: { s00: 1 } },
            },
        }));
        const changed = sealCloudDocument(key, uid, '', { profile: { height: '169' } }, {
            protocolVersion: 3, clock: { s00: 2 }, fields: {},
            writer: { slot: 's00', replicaId: 'existing-remote', generation: 1,
                seq: 2, consentRevision: 1 },
        });
        remote.scanAll.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 2, document: changed }],
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(staged);
        expect((await readLocal(owner))?.replica).toBeNull();
    });

    it('does not adopt a historical receipt when the server checkpoint clock differs', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const sealed = await get(storage);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        remote.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0,
                status: 'active' as const, checkpointClock: { s00: 2 } } },
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(staged);
    });

    it('preserves historical claim if the replica was retired or reused', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const sealed = await get(storage);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        remote.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, generation: 2, replicaId: 'reused-other-device',
                lastSeq: 0, status: 'active' as const, checkpointClock: { s00: 1 } } },
        });
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
    });

    it('preserves historical claim if the control changes between verification reads', async () => {
        const { staged, snapshot } = await prepare();
        const remote = transport(snapshot);
        const sealed = await get(storage);
        remote.replayStoredClaim.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: staged.mutationId, action: 'register', revision: 1,
                currentRevision: 2, reconciliationRequired: true, replayed: true,
                baseSeq: 0, replica: remote.replica,
            }),
        );
        remote.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0,
                status: 'active' as const, checkpointClock: { s00: 1 } } },
        }).mockResolvedValueOnce({
            revision: 3, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0,
                status: 'active' as const, checkpointClock: { s00: 1 } } },
        });
        remote.scanAll.mockImplementation(async () => snapshot(2));
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(await get(storage)).toBe(sealed);
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(staged);
    });

    it('scans after a control revision change but refuses a mixed-revision snapshot', async () => {
        const { snapshot } = await prepare();
        const remote = transport(snapshot);
        const before = await get(storage);
        remote.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0, status: 'active',
                checkpointClock: { s00: 1 } } },
        });
        expect(await resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .toBe('reconciliation-required');
        expect(await get(storage)).toBe(before);
        // A newer control requires a full authenticated scan; the old revision
        // must still be rejected, without replacing the staged request.
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect((await readLocal(owner))?.cloudflareReplicaClaim).toBeDefined();
    });

    it('rejects a second stage and unrelated checkpoint while a claim intent exists', async () => {
        const { staged } = await prepare();
        const sealed = await get(storage);
        const root = await readLocal(owner);
        expect(root?.cloudflareReplicaClaim).toEqual(staged);
        const remote = sealCloudDocument(key, uid, '', { profile: { height: '168' } }, {
            protocolVersion: 3, clock: { s00: 1 }, fields: {},
            writer: { slot: 's00', replicaId: 'existing-remote', generation: 1, seq: 1,
                consentRevision: 1 },
        });
        const verified = await readAuthenticatedCloudflareCheckpoint(
            async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1,
                documents: [{ path: '', document: remote, revision: 0 }] }),
            uid, key, 1, () => true,
        );
        await expect(stageCloudflareReplicaClaim(owner, verified,
            { revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            'other-device', () => true)).rejects.toThrow('Claim D1 non installabile');
        await expect(adoptReplicaCheckpoint(owner, {
            identity: { slot: 's00', replicaId: 'other', generation: 1,
                checkpointAtMs: Date.now(), leaseUntilMs: Date.now() + 86400000 },
            baseSeq: 0,
        }, { clock: {}, syncMetaByDocument: {} })).rejects.toThrow('Checkpoint replica incompatibile');
        expect(await get(storage)).toBe(sealed);
    });

    it('keeps the vault readable but refuses replay after a trusted consent generation changes', async () => {
        await prepare();
        await updateArchiveRecord<unknown>(owner, raw => ({
            ...(raw as Record<string, unknown>), consentRevision: 2,
        }));
        const saved = await get(storage);
        const local = await readLocal(owner);
        expect(local?.cloudflareReplicaClaim?.consentRevision).toBe(1);
        const brokenTransport = {
            replayStoredClaim: vi.fn(), control: vi.fn(), scanAll: vi.fn(),
        };
        await expect(resumeCloudflareReplicaClaim(owner, key, brokenTransport,
            'session-csrf', () => true)).rejects.toThrow('Barriera integrità D1');
        expect(brokenTransport.replayStoredClaim).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(saved);
    });

    it('preserves tampered claim ciphertext and refuses the pending archive instead of resetting it', async () => {
        await prepare();
        await updateArchiveRecord<unknown>(owner, raw => ({
            ...(raw as Record<string, unknown>),
            cloudflareReplicaClaim: { ...(raw as { cloudflareReplicaClaim: object }).cloudflareReplicaClaim,
                checkpointClock: { s99: 99 } },
        }));
        await expect(readLocal(owner)).rejects.toThrow('Intento claim D1 non valido');
    });
});
