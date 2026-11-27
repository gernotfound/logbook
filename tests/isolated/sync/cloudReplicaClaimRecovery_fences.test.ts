import { describe, expect, it, vi } from 'vitest';
import { owner, uid, storage, key, prepare, transport } from './cloudReplicaClaimRecoveryFixture';
import { get } from 'idb-keyval';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim, resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { CloudReplicaMutationReconciliationRequiredError, CloudReplicaTransportError } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal, adoptReplicaCheckpoint } from '../../../src/lib/sync/localRepository';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';

describe('D1 claim: retirement, concurrency, consent and corrupt ciphertext', () => {
    it.each(['committed', 'not-committed'])('preserves the sealed claim on a foreign control after %s', async outcome => {
        const { snapshot } = await prepare();
        const remote = transport(snapshot);
        const control = await remote.control();
        const revision = outcome === 'committed' ? 1 : 2;
        if (outcome === 'not-committed') {
            remote.replayStoredClaim.mockRejectedValueOnce(new CloudReplicaTransportError(409));
            remote.claimMutationOutcome.mockResolvedValueOnce({ outcome, currentRevision: revision });
        }
        remote.control.mockResolvedValue({ ...control, uid: 'other-owner', revision });
        const sealed = await get(storage);
        await expect(resumeCloudflareReplicaClaim(owner, key, remote, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);
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
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
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
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s01: { ...remote.replica, lastSeq: 0,
                status: 'active' as const, checkpointClock: { s00: 1 } } },
        }).mockResolvedValueOnce({
            uid, revision: 3, fenceEpoch: 5, consentRevision: 1,
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
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
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
            { uid, revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
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
            replayStoredClaim: vi.fn(), claimMutationOutcome: vi.fn(), control: vi.fn(), scanAll: vi.fn(),
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
