import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { get } from 'idb-keyval';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { stageCloudflareReplicaRetirement, resumeCloudflareReplicaRetirement } from '../../../src/lib/sync/cloudReplicaRetirementRecovery';
import { adoptReplicaCheckpoint, readLocal } from '../../../src/lib/sync/localRepository';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { uid, owner, storage, stagedRetirement, remoteRetirement } from './cloudReplicaRetirementFixture';

import { resetRetirementFixture, cleanupRetirementFixture } from './cloudReplicaRetirementFixture';

beforeEach(() => resetRetirementFixture(catalogSource.read));
afterEach(cleanupRetirementFixture);

describe('candidate D1 durable expired-replica retirement', () => {
    it('rejects a moved or inconsistent replica register without clearing retirement or journal', async () => {
        const { target } = await stagedRetirement();
        const sealed = await get(storage);
        const transport = remoteRetirement(target);
        transport.control.mockResolvedValueOnce({
            revision: 2, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active' as const,
                lastSeq: 8, checkpointClock: { s00: 4 } } },
        });
        expect(await resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .toBe('reconciliation-required');
        expect(await get(storage)).toBe(sealed);
    });

    it('preserves the ciphertext when session or consent changes before replay', async () => {
        const { target } = await stagedRetirement();
        await updateArchiveRecord<unknown>(owner, raw => ({ ...(raw as object), consentRevision: 2 }));
        const sealed = await get(storage);
        const transport = remoteRetirement(target);
        await expect(resumeCloudflareReplicaRetirement(owner, transport, 'session-csrf', () => true))
            .rejects.toThrow('Barriera integrità D1');
        expect(transport.replayStoredRetirement).not.toHaveBeenCalled();
        expect(await get(storage)).toBe(sealed);

        await expect(stageCloudflareReplicaRetirement(owner, {
            revision: 0, fenceEpoch: 5, consentRevision: 1,
            replicas: { s02: { ...target, status: 'active' as const,
                lastSeq: 8, checkpointClock: {} } },
        }, target, () => false)).rejects.toThrow('sessione');
    });

    it('blocks simultaneous claim and checkpoint mutation while retirement is unresolved', async () => {
        const { control } = await stagedRetirement();
        const sealed = await get(storage);
        const verified = await readAuthenticatedCloudflareCheckpoint(
            async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] }),
            uid, new Uint8Array(32).fill(5), 1, () => true,
        );
        await expect(stageCloudflareReplicaClaim(owner, verified, control, 'new-device-id', () => true))
            .rejects.toThrow('Claim D1 non installabile');
        await expect(adoptReplicaCheckpoint(owner, {
            identity: { slot: 's00', replicaId: 'new-device-id', generation: 1,
                leaseUntilMs: Date.now() + 86400000, checkpointAtMs: Date.now() },
            baseSeq: 0,
        }, { clock: {}, syncMetaByDocument: {} }))
            .rejects.toThrow('Intento D1');
        expect(await get(storage)).toBe(sealed);
    });

    it('rejects invalid retirement intent from the encrypted archive without erasing the original', async () => {
        const { intent } = await stagedRetirement();
        const original = await get(storage);
        await updateArchiveRecord<unknown>(owner, raw => {
            const saved = raw as { cloudflareReplicaRetirement: {
                replica: { slot: string; replicaId: string; generation: number };
            } };
            return { ...saved, cloudflareReplicaRetirement: { ...saved.cloudflareReplicaRetirement,
                replica: { ...saved.cloudflareReplicaRetirement.replica, slot: 's99' } } };
        });
        const tamperedCiphertext = await get(storage);
        expect(tamperedCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(tamperedCiphertext).not.toBe(original);
        expect(JSON.stringify(tamperedCiphertext)).not.toContain(intent.replica.replicaId);

        await expect(readLocal(owner)).rejects.toThrow('Intento retirement D1 non valido');
        expect(await get(storage)).toBe(tamperedCiphertext);
    });
});
