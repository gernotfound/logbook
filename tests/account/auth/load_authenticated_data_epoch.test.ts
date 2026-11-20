import { describe, expect, it, vi } from 'vitest';
import { clear, get } from 'idb-keyval';
import {
    dbState, storeState, data, payload, loadModules, installAuthenticatedHydrationFixture,
} from './loadAuthenticatedDataFixture';

describe('authenticated hydration session fencing', () => {
    installAuthenticatedHydrationFixture();

    it('preserves a missing authenticated envelope without fabricating a replacement journal', async () => {
        await clear();
        const { loadAuthenticatedData, readLocal, invalidateSession } = await loadModules();
        const storageIntegrity = await import('../../../src/lib/storageIntegrity');
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
        const { writeDeviceValue, protectedDeviceKey, deviceKey } = await import('../../../src/lib/sync/deviceStorage');
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
            await import('../../../src/lib/sync/monthlyIntegrity');
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
        const { CloudCiphertextError } = await import('../../../src/lib/sync/cloudDocumentCipher');
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
        const { requireCloudAccountDataKey } = await import('../../../src/lib/sync/cloudAccountKeyAccess');
        invalidateSession();
        await initializeLocal('user:user-a', data('170'));
        const original = await readLocal('user:user-a');
        storeState.current = {
            userData: data('170'), localWorkout: null, localPersistenceBlocked: false,
        };
        const { useAppStore } = await import('../../../src/store/useAppStore');
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
        const { requireCloudAccountDataKey } = await import('../../../src/lib/sync/cloudAccountKeyAccess');
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
});
