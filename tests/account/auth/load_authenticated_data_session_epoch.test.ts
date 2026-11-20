import { describe, expect, it, vi } from 'vitest';
import { clear, get, update } from 'idb-keyval';
import {
    mockControls, data, deferred, payload, loadModules, installAuthenticatedHydrationFixture,
} from './loadAuthenticatedDataFixture';

const { authState, dbState, storeState } = mockControls;

describe('authenticated hydration session fencing', () => {
    installAuthenticatedHydrationFixture();

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
        const { CloudCiphertextError } = await import('../../../src/lib/sync/cloudDocumentCipher');
        const { useAppStore } = await import('../../../src/store/useAppStore');
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
        const { CloudCiphertextError } = await import('../../../src/lib/sync/cloudDocumentCipher');
        const { useAppStore } = await import('../../../src/store/useAppStore');
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
});
