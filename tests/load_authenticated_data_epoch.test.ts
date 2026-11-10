import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyUserData } from './setup';
import { clear, get, update } from 'idb-keyval';
import type { UserData } from '../src/types';
import type { User } from 'firebase/auth';
import type { ReplicaCheckpoint } from '../src/lib/sync/replicaProtocol';

const authState = vi.hoisted(() => ({
    currentUser: { uid: 'user-a' } as { uid: string } | null,
}));

const dbState = vi.hoisted(() => ({
    loadCloudPayload: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
    current: { userData: { profile: { height: '170' } } as UserData | null, localWorkout: null as any, localPersistenceBlocked: false },
}));

vi.mock('../src/lib/firebase', () => ({
    auth: authState,
    getDb: vi.fn(() => ({})),
}));

vi.mock('../src/lib/db', () => ({
    DB: {
        loadCloudPayload: dbState.loadCloudPayload,
    },
}));

vi.mock('../src/lib/sync/replicaProtocol', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/lib/sync/replicaProtocol')>();
    return { ...actual, needsReplicaCheckpoint: vi.fn(() => false) };
});

vi.mock('../src/store/useAppStore', () => ({
    useAppStore: {
        getState: () => storeState.current,
        setState: (patch: any) => {
            storeState.current = {
                ...storeState.current,
                ...(typeof patch === 'function' ? patch(storeState.current) : patch),
            };
        },
    },
}));

function data(height: string): UserData {
    return {
        ...structuredClone(emptyUserData),
        profile: { ...emptyUserData.profile, height },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

function payload(height: string) {
    return {
        data: data(height),
        completeMonths: [],
        cloudDocuments: new Map(),
    };
}

async function loadModules() {
    vi.resetModules();
    const [{ loadAuthenticatedData }, { readLocal, initializeLocal, commitDomainOperations }, { invalidateSession }, { createAndMigrateVault }] = await Promise.all([
        import('../src/contexts/auth/loadAuthenticatedData'),
        import('../src/lib/sync/localRepository'),
        import('../src/lib/sync/session'),
        import('../src/lib/sync/secureArchiveMigration'),
    ]);
    // Each resetModules() starts a new authenticated realm. Seed only its
    // current owner's real AEAD vault; an empty envelope is still allowed.
    await createAndMigrateVault('user:user-a');
    return { loadAuthenticatedData, readLocal, initializeLocal, commitDomainOperations, invalidateSession };
}

describe('authenticated hydration session fencing', () => {
    beforeEach(() => {
        localStorage.clear();
        authState.currentUser = { uid: 'user-a' };
        storeState.current = {
            userData: { profile: { height: '170' } } as UserData,
            localWorkout: null,
            localPersistenceBlocked: false,
        };
        dbState.loadCloudPayload.mockReset();
    });
    afterEach(async () => {
        const { lockAllVaults } = await import('../src/lib/sync/secureArchiveSession');
        lockAllVaults();
    });

    it('preserves a missing authenticated envelope without fabricating a replacement journal', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        const storageIntegrity = await import('../src/lib/storageIntegrity');
        invalidateSession();
        storeState.current = { userData: null, localWorkout: null, localPersistenceBlocked: false };
        storageIntegrity.updateStorageMarker(12345, undefined, 'user:user-a');
        dbState.loadCloudPayload.mockRejectedValueOnce(Object.assign(new Error('Cloud unavailable'), { code: 'unavailable' }));

        const result = await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });

        expect(result).toBe('blocked');
        expect(dbState.loadCloudPayload).toHaveBeenCalledOnce();
        expect(await readLocal('user:user-a')).toBeUndefined();
        expect(await get('logbook:v2:user:user-a')).toBeUndefined();
        expect(storeState.current.userData).toBeNull();
        await clear();
    });

    it('rejects a stale workout when an owner envelope appears during an offline cloud-load failure', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, initializeLocal, commitDomainOperations, invalidateSession } = await loadModules();
        invalidateSession();
        storeState.current = { userData: null, localWorkout: null, localPersistenceBlocked: false };
        const oldWorkout = { id: 'closed-during-cloud-load', date: '2026-10-09', exercises: [] };
        const { writeDeviceValue, protectedDeviceKey, deviceKey } = await import('../src/lib/sync/deviceStorage');
        // This test models a current-epoch stale tab, not a pre-launch unmarked copy.
        localStorage.setItem('logbook:v2:user:user-a:health-consent-generation', '1');
        writeDeviceValue('workout', JSON.stringify({
            __logbookWorkoutSnapshot: 1, owner: 'user:user-a', consentRevision: 1, workout: oldWorkout,
        }), 'user:user-a');
        const sealedWorkoutKey = protectedDeviceKey('workout', 'user:user-a');
        expect(localStorage.getItem(sealedWorkoutKey)).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey('workout', 'user:user-a'))).toBeNull();

        const initial = data('170');
        dbState.loadCloudPayload.mockImplementationOnce(async () => {
            // Another tab initialized and closed the session after the first readLocal.
            await initializeLocal('user:user-a', initial);
            await commitDomainOperations('user:user-a', {
                type: 'active-workout.set', workout: null, deletedWorkoutId: oldWorkout.id,
            }, initial);
            throw Object.assign(new Error('Cloud unavailable'), { code: 'unavailable' });
        });
        await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        expect((await readLocal('user:user-a'))?.closedWorkoutIds).toContain(oldWorkout.id);
        expect(storeState.current.localWorkout).toBeNull();
        expect(localStorage.getItem(sealedWorkoutKey)).toBeNull();
        await clear();
    });

    it('installs a durable fence when a cloud month fails strict integrity validation', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, initializeLocal, invalidateSession } = await loadModules();
        const { IncompleteCloudMonthError, requireCompleteHistoryMonthDocument } =
            await import('../src/lib/sync/monthlyIntegrity');
        invalidateSession();
        const local = data('170');
        await initializeLocal('user:user-a', local);
        expect(await get('logbook:v2:user:user-a')).toMatch(/^tlb-sealed:v1:/);
        let invalidMonthError: unknown;
        try { requireCompleteHistoryMonthDocument('2026-09', { malformed: {} }); }
        catch (error) { invalidMonthError = error; }
        expect(invalidMonthError).toBeInstanceOf(IncompleteCloudMonthError);
        dbState.loadCloudPayload.mockRejectedValueOnce(invalidMonthError);
        const setSaveError = vi.fn();

        const result = await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError,
        });

        const preserved = await readLocal('user:user-a');
        expect(result).toBe('blocked');
        expect(preserved?.data.profile?.height).toBe('170');
        expect(preserved?.cloudIntegrityFence).toEqual(expect.any(String));
        expect('cloudIntegrityBlocked' in storeState.current && storeState.current.cloudIntegrityBlocked).toBe(true);
        expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('sincronizzazione sospesa'));
        await clear();
    });

    it('persists a cloud-integrity fence when a sealed document fails authenticated decryption', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, initializeLocal, invalidateSession } = await loadModules();
        const { CloudCiphertextError } = await import('../src/lib/sync/cloudDocumentCipher');
        invalidateSession();
        await initializeLocal('user:user-a', data('170'));
        expect(await get('logbook:v2:user:user-a')).toMatch(/^tlb-sealed:v1:/);
        dbState.loadCloudPayload.mockRejectedValueOnce(new CloudCiphertextError());
        const setSaveError = vi.fn();

        const result = await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError,
        });

        const preserved = await readLocal('user:user-a');
        expect(result).toBe('blocked');
        expect(preserved?.data.profile?.height).toBe('170');
        expect(preserved?.cloudIntegrityFence).toEqual(expect.any(String));
        expect('cloudIntegrityBlocked' in storeState.current && storeState.current.cloudIntegrityBlocked).toBe(true);
        expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('sincronizzazione sospesa'));
        await clear();
    });

    it('marks an ADK denial as failed without changing durable local data or inventing a cloud ACK', async () => {
        await clear();
        const { loadAuthenticatedData, initializeLocal, readLocal, invalidateSession } = await loadModules();
        const { requireCloudAccountDataKey } = await import('../src/lib/sync/cloudAccountKeyAccess');
        invalidateSession();
        await initializeLocal('user:user-a', data('170'));
        const original = await readLocal('user:user-a');
        storeState.current = {
            userData: data('170'), localWorkout: null, localPersistenceBlocked: false,
        };
        const { useAppStore } = await import('../src/store/useAppStore');
        useAppStore.setState({ syncHealth: 'synced' });
        vi.mocked(requireCloudAccountDataKey).mockRejectedValueOnce(
            Object.assign(new Error('Chiave cloud non disponibile'), { code: 'cloud-key-unavailable' }),
        );
        const setSaveError = vi.fn();

        expect(await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError,
        })).toBe('blocked');
        expect('syncHealth' in storeState.current && storeState.current.syncHealth).toBe('failed');
        expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('sincronizzazione sospesa'));
        expect(dbState.loadCloudPayload).not.toHaveBeenCalled();
        expect(await readLocal('user:user-a')).toEqual(original);
        await clear();
    });

    it('zeroizes the newly acquired ADK when a cloud read rejects, preserving the local archive', async () => {
        await clear();
        const { loadAuthenticatedData, initializeLocal, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        await initializeLocal('user:user-a', data('170'));
        storeState.current = { userData: data('170'), localWorkout: null, localPersistenceBlocked: false };
        const { requireCloudAccountDataKey } = await import('../src/lib/sync/cloudAccountKeyAccess');
        const cloudKey = new Uint8Array(32).fill(18);
        vi.mocked(requireCloudAccountDataKey).mockResolvedValueOnce(cloudKey);
        dbState.loadCloudPayload.mockImplementationOnce(async ({ cloudKey: supplied }: { cloudKey: Uint8Array }) => {
            expect(supplied).toBe(cloudKey);
            expect(supplied[0]).toBe(18);
            throw new Error('Injected cloud read failure');
        });

        const status = await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        expect(status).toBe('blocked');
        expect(cloudKey).toEqual(new Uint8Array(32));
        expect((await readLocal('user:user-a'))?.data.profile?.height).toBe('170');
        await clear();
    });

    it('does not create an empty account journal when a cloud read fails without a local envelope', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        storeState.current = { userData: null, localWorkout: null, localPersistenceBlocked: false };
        dbState.loadCloudPayload.mockRejectedValueOnce(Object.assign(new Error('Cloud unavailable'), { code: 'unavailable' }));
        const setSaveError = vi.fn();
        const options = {
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError,
        };

        expect(await loadAuthenticatedData(options)).toBe('blocked');
        expect((await readLocal('user:user-a'))).toBeUndefined();
        expect(await get('logbook:v2:user:user-a')).toBeUndefined();
        expect(storeState.current.userData).toBeNull();
        expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('nessun archivio locale'));

        // The failure is retryable: a later verified server read still hydrates
        // this same account normally, without any fabricated local baseline.
        dbState.loadCloudPayload.mockResolvedValueOnce(payload('185'));
        expect(await loadAuthenticatedData(options)).toBe('ready');
        expect(storeState.current.userData?.profile?.height).toBe('185');
        expect((await readLocal('user:user-a'))?.data.profile?.height).toBe('185');
        expect((await readLocal('user:user-a'))?.pending).toEqual([]);
        await clear();
    });

    it('does not publish or persist A when the session changes before cloud data arrives', async () => {
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        const firstPayload = deferred<ReturnType<typeof payload>>();
        dbState.loadCloudPayload.mockReturnValueOnce(firstPayload.promise);
        const setSyncing = vi.fn();
        const setSaveError = vi.fn();

        const loadPromise = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing,
            setSaveError,
        });

        await vi.waitFor(() => expect(dbState.loadCloudPayload).toHaveBeenCalledTimes(1));
        authState.currentUser = { uid: 'user-b' };
        invalidateSession();
        firstPayload.resolve(payload('171'));
        await loadPromise;

        expect(await readLocal('user:user-a')).toBeUndefined();
        expect(setSaveError).not.toHaveBeenCalled();
        expect(setSyncing).not.toHaveBeenCalledWith(false);
    });

    it('does not resurrect an older A load after A to B to A', async () => {
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        const firstPayload = deferred<ReturnType<typeof payload>>();
        dbState.loadCloudPayload
            .mockReturnValueOnce(firstPayload.promise)
            .mockResolvedValueOnce(payload('182'));

        const firstLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await vi.waitFor(() => expect(dbState.loadCloudPayload).toHaveBeenCalledTimes(1));

        authState.currentUser = { uid: 'user-b' };
        invalidateSession();
        authState.currentUser = { uid: 'user-a' };
        invalidateSession();

        const secondLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await secondLoad;

        expect((await readLocal('user:user-a'))?.data.profile?.height).toBe('182');
        // The cloud snapshot is already durably committed by hydrateLocal:
        // exposing it through the user-edit writer would spawn duplicate
        // SemanticOperations. The authenticated view must update directly.
        expect(storeState.current.userData?.profile?.height).toBe('182');
        expect((await readLocal('user:user-a'))?.pending).toEqual([]);
        const ciphertext = await get('logbook:v2:user:user-a');

        firstPayload.resolve(payload('171'));
        await firstLoad;

        expect((await readLocal('user:user-a'))?.data.profile?.height).toBe('182');
        expect(storeState.current.userData?.profile?.height).toBe('182');
        expect(await get('logbook:v2:user:user-a')).toBe(ciphertext);
    });

    it('lets the newest same-account load supersede an older overlapping load', async () => {
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        invalidateSession();
        const firstPayload = deferred<ReturnType<typeof payload>>();
        dbState.loadCloudPayload
            .mockReturnValueOnce(firstPayload.promise)
            .mockResolvedValueOnce(payload('183'));

        const firstLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await vi.waitFor(() => expect(dbState.loadCloudPayload).toHaveBeenCalledTimes(1));

        const secondLoad = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: vi.fn(),
            setSaveError: vi.fn(),
        });
        await secondLoad;

        expect((await readLocal('user:user-a'))?.data.profile?.height).toBe('183');
        // The cloud snapshot is already durably committed by hydrateLocal:
        // exposing it through the user-edit writer would spawn duplicate
        // SemanticOperations. The authenticated view must update directly.
        expect(storeState.current.userData?.profile?.height).toBe('183');
        expect((await readLocal('user:user-a'))?.pending).toEqual([]);
        const ciphertext = await get('logbook:v2:user:user-a');

        firstPayload.resolve(payload('171'));
        await firstLoad;

        expect((await readLocal('user:user-a'))?.data.profile?.height).toBe('183');
        expect(storeState.current.userData?.profile?.height).toBe('183');
        expect(await get('logbook:v2:user:user-a')).toBe(ciphertext);
    });

    it('does not overwrite an unsaved UI draft with an older readable owner envelope', async () => {
        await clear();
        const { loadAuthenticatedData, initializeLocal, invalidateSession } = await loadModules();
        invalidateSession();
        await initializeLocal('user:user-a', data('170'));
        storeState.current = { userData: data('199'), localWorkout: null, localPersistenceBlocked: true };
        const setSyncing = vi.fn();
        await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing,
            setSaveError: vi.fn(),
        });
        expect(storeState.current.userData?.profile?.height).toBe('199');
        expect(storeState.current.localPersistenceBlocked).toBe(true);
        expect(dbState.loadCloudPayload).not.toHaveBeenCalled();
        expect(setSyncing).not.toHaveBeenCalled();
        await clear();
    });

    it('stops loading and preserves the journal when the cloud integrity fence cannot be persisted', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, initializeLocal, commitDomainOperations, invalidateSession } = await loadModules();
        const { CloudCiphertextError } = await import('../src/lib/sync/cloudDocumentCipher');
        const { useAppStore } = await import('../src/store/useAppStore');
        invalidateSession();
        const initial = data('170');
        await initializeLocal('user:user-a', initial);
        await commitDomainOperations('user:user-a', { type: 'profile.patch', patch: { height: '175' } }, initial);
        const original = await readLocal('user:user-a');
        const ciphertext = await get('logbook:v2:user:user-a');
        expect(original?.pending.length).toBeGreaterThan(0);
        storeState.current = { userData: null, localWorkout: null, localPersistenceBlocked: false };
        dbState.loadCloudPayload.mockImplementationOnce(async () => {
            vi.mocked(update).mockRejectedValueOnce(new Error('IndexedDB write failed'));
            throw new CloudCiphertextError();
        });

        expect(await loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: value => useAppStore.setState({ syncing: value }),
            setSaveError: vi.fn(),
        })).toBe('blocked');

        expect(useAppStore.getState().syncing).toBe(false);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(storeState.current.localPersistenceBlocked).toBe(true);
        expect(storeState.current.userData?.profile?.height).toBe('175');
        expect(await get('logbook:v2:user:user-a')).toBe(ciphertext);
        expect(await readLocal('user:user-a')).toEqual(original);
        await clear();
    });

    it('does not stop the new session loading when a stale integrity fence write fails', async () => {
        await clear();
        const { loadAuthenticatedData, initializeLocal, invalidateSession } = await loadModules();
        const { CloudCiphertextError } = await import('../src/lib/sync/cloudDocumentCipher');
        const { useAppStore } = await import('../src/store/useAppStore');
        invalidateSession();
        await initializeLocal('user:user-a', data('170'));
        let failFence!: (error: Error) => void;
        dbState.loadCloudPayload.mockImplementationOnce(async () => {
            vi.mocked(update).mockImplementationOnce(() => new Promise((_, reject) => { failFence = reject; }));
            throw new CloudCiphertextError();
        });
        const setSaveError = vi.fn();
        const loading = loadAuthenticatedData({
            user: { uid: 'user-a' } as any,
            isGuestActive: () => false,
            setSyncing: value => useAppStore.setState({ syncing: value }),
            setSaveError,
        });
        await vi.waitFor(() => expect(failFence).toBeTypeOf('function'));
        authState.currentUser = { uid: 'user-b' };
        invalidateSession();
        useAppStore.setState({ userData: data('190'), dataOwner: 'user:user-b', syncing: true });
        failFence(new Error('IndexedDB write failed'));
        expect(await loading).toBe('blocked');

        expect(useAppStore.getState().syncing).toBe(true);
        expect(storeState.current.localPersistenceBlocked).toBe(false);
        expect(storeState.current.userData?.profile?.height).toBe('190');
        expect(setSaveError).not.toHaveBeenCalled();
        await clear();
    });

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
        const repository = await import('../src/lib/sync/localRepository');
        const protocol = await import('../src/lib/sync/replicaProtocol');
        const catalogModule = await import('../src/lib/catalog/catalogService');
        const healthConsent = await import('../src/lib/healthConsent');
        const { captureSession, isCurrentSession } = await import('../src/lib/sync/session');
        const { projectDocuments } = await import('../src/lib/sync/documentProjection');
        const { diffDocuments, applySemanticOperations } = await import('../src/lib/sync/semanticProjection');
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
        const retire = vi.spyOn(protocol, 'retireExpiredReplicas').mockResolvedValue(undefined);
        const catalogRead = vi.spyOn(catalogModule, 'getCachedCatalog');
        const originalUpdate = vi.mocked(update).getMockImplementation();
        if (!originalUpdate) throw new Error('Missing transactional IndexedDB adapter');
        const claimCheckpoint = vi.spyOn(protocol, 'claimReplicaCheckpoint').mockImplementationOnce(async () => {
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
