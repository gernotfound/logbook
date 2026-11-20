import { describe, expect, it, vi } from 'vitest';
import { clear, get, update } from 'idb-keyval';
import type { User } from 'firebase/auth';
import type { ReplicaCheckpoint } from '../../../src/lib/sync/replicaProtocol';
import {
    dbState, storeState, data, deferred, loadModules, installAuthenticatedHydrationFixture,
} from './loadAuthenticatedDataFixture';

describe('authenticated hydration session fencing', () => {
    installAuthenticatedHydrationFixture();

    it.each([
        { mode: 'renew', boundary: 'catalog', suspend: true },
        { mode: 'replace', boundary: 'catalog', suspend: true },
        { mode: 'renew', boundary: 'transaction', suspend: true },
        { mode: 'replace', boundary: 'transaction', suspend: true },
        { mode: 'renew', boundary: 'catalog', suspend: false },
        { mode: 'replace', boundary: 'transaction', suspend: false },
    ] as const)('honors cloud authorization during checkpoint $mode at $boundary (suspend=$suspend)', async ({ mode, boundary, suspend }) => {
        await clear();
        const { loadAuthenticatedData, initializeLocal, commitDomainOperations, readLocal, invalidateSession } = await loadModules();
        const repository = await import('../../../src/lib/sync/localRepository');
        const protocol = await import('../../../src/lib/sync/replicaProtocol');
        const firebaseProtocol = await import('../../../src/lib/sync/firebaseReplicaProtocol');
        const catalogModule = await import('../../../src/lib/catalog/catalogService');
        const healthConsent = await import('../../../src/lib/healthConsent');
        const { captureSession, isCurrentSession } = await import('../../../src/lib/sync/session');
        const { projectDocuments } = await import('../../../src/lib/sync/documentProjection');
        const { diffDocuments, applySemanticOperations } = await import('../../../src/lib/sync/semanticProjection');
        invalidateSession();

        const initial = data('170');
        const catalog = await catalogModule.getCachedCatalog();
        const documents = projectDocuments(initial, catalog);
        const events = diffDocuments(new Map(), documents, 's02', 1, { s02: 1 });
        const remote = applySemanticOperations(new Map(), events);
        const cloudDocuments = new Map([...remote.documents].map(([path, business]) => [path, {
            ...business, _schemaVersion: 1,
            _sync: { ...remote.syncMetas[path], writer: {
                slot: 's02', replicaId: 'remote-checkpoint-proof', generation: 1, seq: 1,
            } },
        }]));
        const checkpoint = protocol.checkpointFromCloudDocuments(cloudDocuments);
        const now = Date.now();
        const originalIdentity = {
            slot: 's00', replicaId: 'original-checkpoint', generation: 1,
            checkpointAtMs: now - 1000, leaseUntilMs: now + 86_400_000,
        };
        await initializeLocal('user:user-a', initial);
        await repository.adoptReplicaCheckpoint('user:user-a', { identity: originalIdentity, baseSeq: 0 }, checkpoint);
        await commitDomainOperations('user:user-a', { type: 'profile.patch', patch: { height: '175' } }, initial);
        expect((await readLocal('user:user-a'))?.pending.length).toBeGreaterThan(0);
        const session = captureSession();
        const claim: ReplicaCheckpoint = {
            identity: mode === 'renew'
                ? { ...originalIdentity, checkpointAtMs: now, leaseUntilMs: now + 172_800_000 }
                : { ...originalIdentity, slot: 's01', replicaId: 'replacement-checkpoint', generation: 2 },
            baseSeq: mode === 'renew' ? 1 : 7,
        };
        const release = deferred<void>();
        let paused = false;
        let cloudAllowed = true;
        let beforeAdoption: Awaited<ReturnType<typeof readLocal>>;
        let ciphertext: unknown;
        const cloudGate = vi.mocked(healthConsent.isHealthConsentCloudWritable);
        cloudGate.mockImplementation(() => cloudAllowed);
        vi.mocked(protocol.needsReplicaCheckpoint).mockReturnValue(true);
        const retire = vi.spyOn(firebaseProtocol, 'retireExpiredReplicas').mockResolvedValue(undefined);
        const catalogRead = vi.spyOn(catalogModule, 'getCachedCatalog');
        const originalUpdate = vi.mocked(update).getMockImplementation();
        if (!originalUpdate) throw new Error('Missing transactional IndexedDB adapter');
        const claimCheckpoint = vi.spyOn(firebaseProtocol, 'claimReplicaCheckpoint').mockImplementationOnce(async () => {
            beforeAdoption = await readLocal('user:user-a');
            ciphertext = await get('logbook:v2:user:user-a');
            if (boundary === 'catalog') {
                catalogRead.mockImplementationOnce(async () => {
                    paused = true;
                    await release.promise;
                    return catalog;
                });
            } else {
                vi.mocked(update).mockImplementationOnce(async (key, transform, store) => {
                    paused = true;
                    await release.promise;
                    return originalUpdate(key, transform, store);
                });
            }
            return claim;
        });
        dbState.loadCloudPayload.mockResolvedValueOnce({ data: initial, completeMonths: [], cloudDocuments });
        const loading = loadAuthenticatedData({
            user: { uid: 'user-a' } as User, isGuestActive: () => false,
            setSyncing: vi.fn(), setSaveError: vi.fn(),
        });

        try {
            await vi.waitFor(() => expect(paused).toBe(true));
            // Cloud suspension/revalidation can leave Auth and durable consent markers unchanged.
            cloudAllowed = !suspend;
            expect(isCurrentSession(session)).toBe(true);
            release.resolve();
            expect(await loading).toBe(suspend ? 'blocked' : 'ready');
            const afterAdoption = await readLocal('user:user-a');
            expect(beforeAdoption?.pending.length).toBeGreaterThan(0);
            expect(beforeAdoption?.data.profile?.height).toBe('175');
            if (suspend) {
                expect(await get('logbook:v2:user:user-a')).toBe(ciphertext);
                expect(afterAdoption).toEqual(beforeAdoption);
            } else {
                expect(afterAdoption?.replica).toEqual(claim.identity);
                expect(afterAdoption?.actorId).toBe(claim.identity.slot);
                expect(afterAdoption?.actorSeq).toBe(mode === 'renew' ? 1 : 8);
                expect(afterAdoption?.data).toEqual(beforeAdoption?.data);
                expect(afterAdoption?.pending.map(op => [op.docPath, op.path, op.isDelete, op.value, op.guard]))
                    .toEqual(beforeAdoption?.pending.map(op => [op.docPath, op.path, op.isDelete, op.value, op.guard]));
                expect(afterAdoption?.revision).toBe(beforeAdoption!.revision + 1);
                expect(storeState.current.userData?.profile?.height).toBe('175');
            }
            expect(claimCheckpoint).toHaveBeenCalledOnce();
            expect(dbState.loadCloudPayload).toHaveBeenCalledWith(expect.objectContaining({ allMonths: true }));
        } finally {
            release.resolve();
            await loading;
            cloudGate.mockReturnValue(true);
            vi.mocked(protocol.needsReplicaCheckpoint).mockReturnValue(false);
            retire.mockRestore();
            claimCheckpoint.mockRestore();
            catalogRead.mockRestore();
            await clear();
        }
    });
});
