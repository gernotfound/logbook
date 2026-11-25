import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { get } from 'idb-keyval';
import { CloudReplicaMutationReconciliationRequiredError } from '../../../src/lib/sync/cloudReplicaTransport';
import { resumeCloudflareReplicaRetirement } from '../../../src/lib/sync/cloudReplicaRetirementRecovery';
import { commitLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { data, uid, owner, storage, stagedRetirement, remoteRetirement, resetRetirementFixture, cleanupRetirementFixture } from './cloudReplicaRetirementFixture';

beforeEach(() => resetRetirementFixture(catalogSource.read));
afterEach(cleanupRetirementFixture);

describe('candidate D1 durable expired-replica retirement', () => {
    it('reconciles a historical retirement after unrelated writes without acknowledging journal data', async () => {
        await commitLocal(owner, data(171), data(170));
        const { target, intent } = await stagedRetirement();
        const beforeJournal = (await readLocal(owner))!.pending;
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockImplementation(async () => ({
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const, lastSeq: 8,
                checkpointClock: { s00: 4 } } },
        }));
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('retired');
        expect(transport.replayStoredRetirement).toHaveBeenCalledWith(intent, 'session-csrf');
        expect(transport.control).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toBeUndefined();
        expect((await readLocal(owner))?.pending).toEqual(beforeJournal);
    });

    it('closes proven retired membership superseded by a higher generation, without ACK', async () => {
        await commitLocal(owner, data(171), data(170));
        const { target, intent } = await stagedRetirement();
        const journal = (await readLocal(owner))!.pending;
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValue({
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, generation: 2, replicaId: 'new-replica',
                status: 'active', lastSeq: 8, checkpointClock: {} } },
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('superseded');
        expect(transport.control).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toBeUndefined();
        expect((await readLocal(owner))?.pending).toEqual(journal);
    });

    it('preserves a historical retirement when identity changes without a higher generation', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValue({
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, replicaId: 'unexpected-id',
                status: 'active', lastSeq: 8, checkpointClock: {} } },
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(transport.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(saved);
    });

    it('preserves superseded retirement if remote controls diverge', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        const successor = { uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, generation: 2, replicaId: 'successor',
                status: 'active' as const, lastSeq: 8, checkpointClock: {} } } };
        transport.control.mockResolvedValueOnce(successor)
            .mockResolvedValueOnce({ ...successor, revision: 3 });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(await get(storage)).toBe(saved);
    });

    it('keeps historical intent if the control moves during confirmation', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValueOnce({
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const, lastSeq: 8,
                checkpointClock: { s00: 4 } } },
        }).mockResolvedValueOnce({
            uid, revision: 3, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const, lastSeq: 8,
                checkpointClock: { s00: 4 } } },
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(transport.control).toHaveBeenCalledTimes(2);
        expect(await get(storage)).toBe(saved);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toEqual(intent);
    });

    it('does not clear a historical intent if the control revision is older than the receipt', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(transport.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(saved);
    });

    it('does not clear historical retirement if receipt membership metadata differs from D1', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValue({
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const,
                lastSeq: 9, checkpointClock: { s00: 4 } } },
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .resolves.toBe('reconciliation-required');
        expect(transport.control).toHaveBeenCalledOnce();
        expect(await get(storage)).toBe(saved);
    });

    it('preserves historical retirement when session guard expires after remote confirmation', async () => {
        const { target, intent } = await stagedRetirement();
        const saved = await get(storage);
        const transport = remoteRetirement(target);
        transport.replayStoredRetirement.mockRejectedValueOnce(
            new CloudReplicaMutationReconciliationRequiredError({
                mutationId: intent.mutationId, action: 'retire', revision: 1, currentRevision: 2,
                reconciliationRequired: true, replayed: true, baseSeq: 8, replica: target,
            }),
        );
        transport.control.mockResolvedValue({
            uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'retired' as const,
                lastSeq: 8, checkpointClock: { s00: 4 } } },
        });
        let current = true;
        transport.control.mockImplementationOnce(async () => {
            current = false;
            return { uid, revision: 2, fenceEpoch: 5, consentRevision: 1,
                replicas: { s02: { ...target, status: 'retired' as const,
                    lastSeq: 8, checkpointClock: { s00: 4 } } } };
        });
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => current))
            .rejects.toThrow('sessione');
        expect(await get(storage)).toBe(saved);
        expect((await readLocal(owner))?.cloudflareReplicaRetirement).toEqual(intent);
    });
});
