import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore';
import { DB } from '../../src/lib/db';
import type { UserData } from '../../src/types';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { createDefaultNutritionPlanning } from '../../src/lib/nutritionDefaults';
import { readLocal } from '../../src/lib/sync/localRepository';

describe('R3: Zustand saveUserData Error Rejection & Debouncing Suite', () => {
    const mockUserData1: UserData = {
        profile: { height: '175' },
        library: [{ id: 'ex1', name: 'Bench Press', setsCount: 3, sets: [] }],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        trainingCycles: [],
        supplements: [],
        activeWorkout: null,
        nutritionPlanning: createDefaultNutritionPlanning()
    };

    const mockUserData2: UserData = {
        ...mockUserData1,
        profile: { height: '180' }
    };

    const mockUserData3: UserData = {
        ...mockUserData1,
        profile: { height: '185' }
    };

    beforeEach(async () => {
        useAppStore.getState().resetStore();
        await prepareUnlockedTestArchive('user:test-user-id');
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
        vi.useRealTimers();
        lockAllVaults();
    });

    describe('Single Save Flow', () => {
        it('resolves saveUserData promise with SyncResult when DB.saveUserData succeeds', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({ ok: true, status: 'synced' });

            const savePromise = useAppStore.getState().saveUserData(mockUserData1);
            expect(useAppStore.getState().syncing).toBe(true);
            expect(useAppStore.getState().saveError).toBeNull();

            await vi.advanceTimersByTimeAsync(1100);
            const result = await savePromise;

            expect(result.ok).toBe(true);
            expect(result.status).toBe('synced');
            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
                profile: expect.objectContaining({ height: '175' })
            }), expect.any(Number));
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().saveError).toBeNull();
        });

        it('rejects a failed cloud result while keeping the local snapshot durable', async () => {
            const networkError = new Error('Cloud key service unavailable');
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({
                ok: false, status: 'failed', error: networkError,
            });

            const savePromise = useAppStore.getState().saveUserData(mockUserData1);
            const assertion = expect(savePromise).rejects.toThrow('Cloud key service unavailable');
            expect(useAppStore.getState().syncing).toBe(true);

            await vi.advanceTimersByTimeAsync(1100);
            await assertion;

            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(useAppStore.getState().syncHealth).toBe('failed');
            expect(useAppStore.getState().saveError).toBe(networkError.message);
            expect(useAppStore.getState().syncing).toBe(false);
            // A failed cloud result must not be mistaken for a failed local commit.
            expect((await readLocal('user:test-user-id'))?.data.profile?.height).toBe('175');
        });

        it('supports updater function syntax and resolves with SyncResult on success', async () => {
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({ ok: true, status: 'synced' });
            useAppStore.setState({ userData: mockUserData1, dataOwner: 'user:test-user-id' });

            const savePromise = useAppStore.getState().saveUserData((prev) => ({
                ...(prev as UserData),
                profile: { ...(prev?.profile || {}), height: '190' }
            }));

            await vi.advanceTimersByTimeAsync(1100);
            const result = await savePromise;

            expect(result.ok).toBe(true);
            expect(useAppStore.getState().userData?.profile?.height).toBe('190');
            expect(useAppStore.getState().syncing).toBe(false);
        });
    });

    describe('Concurrent & Debounced Calls Flow', () => {
        it('debounces multiple rapid calls into 1 DB write and resolves all caller promises on success', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: true, status: 'synced' });

            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            await vi.advanceTimersByTimeAsync(200);

            const p2 = useAppStore.getState().saveUserData(mockUserData2);
            await vi.advanceTimersByTimeAsync(200);

            const p3 = useAppStore.getState().saveUserData(mockUserData3);
            expect(useAppStore.getState().syncing).toBe(true);

            // Advance past 1000ms debounce
            await vi.advanceTimersByTimeAsync(1100);

            const results = await Promise.all([p1, p2, p3]);
            expect(results).toEqual([
                { ok: true, status: 'synced' },
                { ok: true, status: 'synced' },
                { ok: true, status: 'synced' },
            ]);

            // Only ONE DB save call was executed with the freshest data (mockUserData3)
            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
                profile: expect.objectContaining({ height: '185' })
            }), expect.any(Number));
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().saveError).toBeNull();
            expect((await readLocal('user:test-user-id'))?.data.profile?.height).toBe('185');
        });

    });

    describe('Null User Data & Error Recovery', () => {
        it('cancels pending callers on saveUserData(null) without claiming a save', async () => {
            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            expect(useAppStore.getState().syncing).toBe(true);

            // Nullify while save is pending
            const canceled = expect(p1).rejects.toThrow('cambio sessione');
            const p2 = useAppStore.getState().saveUserData(null);
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().userData).toBeNull();
            expect(useAppStore.getState().saveError).toBeNull();

            await Promise.all([canceled, p2]);
        });

        it('subsequent successful save clears previous saveError', async () => {
            // A structured cloud failure leaves the local snapshot available for retry.
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({
                ok: false, status: 'failed', error: new Error('First fail'),
            });
            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            const a1 = expect(p1).rejects.toThrow('First fail');
            await vi.advanceTimersByTimeAsync(1100);
            await a1;
            expect(useAppStore.getState().saveError).toBe('First fail');

            // Second save succeeds
            saveSpy.mockResolvedValueOnce({ ok: true, status: 'synced' });
            const p2 = useAppStore.getState().saveUserData(mockUserData2);
            // Starting second save resets saveError to null
            expect(useAppStore.getState().saveError).toBeNull();

            await vi.advanceTimersByTimeAsync(1100);
            const result = await p2;
            expect(result).toEqual({ ok: true, status: 'synced' });
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);
            expect((await readLocal('user:test-user-id'))?.data.profile?.height).toBe('180');
        });

    });
});
