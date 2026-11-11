import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserData } from '../../../src/types';
import { idbStore } from '../../setup';

describe('Concurrent save rejection and durability', () => {
    describe('R3 Adversarial: Zustand saveUserData Concurrency & Promise Rejection Stress', () => {
        const createMockUserData = (index: number): UserData => ({
            profile: { height: `${170 + index}` },
            library: [{ id: `ex_${index}`, name: `Exercise ${index}`, setsCount: 3, sets: [] }],
            routines: [],
            history: [],
            nutrition: {},
            customFoods: [],
            trainingCycles: [],
            supplements: [],
            activeWorkout: null,
            nutritionPlanning: {} as any
        });

        let useAppStore: any;
        let DB: any;

        beforeEach(async () => {
            for (const k in idbStore) delete idbStore[k];
            // After the Firebase config tests reset module state, provision
            // through the same module instance the store will use.
            const { prepareUnlockedTestArchive } = await import('../../secureVaultFixture');
            await prepareUnlockedTestArchive('user:test-user-id');
            vi.useFakeTimers();
            const storeMod = await import('../../../src/store/useAppStore');
            const dbMod = await import('../../../src/lib/db');
            useAppStore = storeMod.useAppStore;
            DB = dbMod.DB;
            useAppStore.getState().resetStore();
            vi.clearAllMocks();
        });

        afterEach(() => {
            if (useAppStore) {
                useAppStore.getState().resetStore();
            }
            vi.useRealTimers();
        });

        it('BURST STRESS (50 Concurrent Calls - Success): debounces 50 rapid calls into exactly 1 DB write, resolves ALL 50 caller promises with freshest data', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: true, status: 'synced' });
            const burstCount = 50;
            const promises: Promise<void>[] = [];

            for (let i = 1; i <= burstCount; i++) {
                promises.push(useAppStore.getState().saveUserData(createMockUserData(i)));
            }

            expect(useAppStore.getState().syncing).toBe(true);
            expect(useAppStore.getState().saveError).toBeNull();

            const settledPromise = Promise.allSettled(promises);

            // Advance debounce timer past 1000ms
            await vi.advanceTimersByTimeAsync(1100);

            // Await all 50 promises
            const results = await settledPromise;

            // All 50 promises MUST be fulfilled
            expect(results.length).toBe(burstCount);
            for (let i = 0; i < burstCount; i++) {
                expect(results[i].status).toBe('fulfilled');
            }

            // DB.saveUserData must have been called EXACTLY ONCE
            expect(saveSpy).toHaveBeenCalledTimes(1);
            // Must have received the 50th payload (freshest state)
            expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
                profile: expect.objectContaining({ height: '220' })
            }), expect.any(Number));

            // These account writes cross the encrypted local journal boundary.
            expect(idbStore['logbook:v2:user:test-user-id']).toMatch(/^tlb-sealed:v1:/);

            // Final store state must be clean
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().userData?.profile?.height).toBe('220');
            // This suite resets modules: use the store's current vault instance.
            // Verify the durable archive, not just the optimistic Zustand state.
            const { readLocal } = await import('../../../src/lib/sync/localRepository');
            const durable = await readLocal('user:test-user-id');
            expect(durable?.data.profile?.height).toBe('220');
            expect(durable?.data.library?.map(item => item.id)).toEqual(['ex_50']);
        });

        it('BURST STRESS (50 Concurrent Calls - Rejection): when debounced DB write fails, ALL 50 caller promises reject with the identical error', async () => {
            const simulatedError = new Error('Simulated QuotaExceeded or Network Failure');
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(simulatedError);
            const burstCount = 50;
            const promises: Promise<void>[] = [];

            for (let i = 1; i <= burstCount; i++) {
                promises.push(useAppStore.getState().saveUserData(createMockUserData(i)));
            }

            expect(useAppStore.getState().syncing).toBe(true);

            const settledPromise = Promise.allSettled(promises);

            // Advance past debounce timer
            await vi.advanceTimersByTimeAsync(1100);

            // Settle all promises
            const results = await settledPromise;

            expect(results.length).toBe(burstCount);
            for (let i = 0; i < burstCount; i++) {
                expect(results[i].status).toBe('rejected');
                if (results[i].status === 'rejected') {
                    expect((results[i] as PromiseRejectedResult).reason).toBe(simulatedError);
                }
            }

            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(useAppStore.getState().saveError).toBe(simulatedError.message);
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('INTERLEAVED STRESS: alternates Fail -> Burst Success -> Burst Fail -> Null -> Success cleanly', async () => {
            // Stage 1: Single Failure
            vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(new Error('Stage 1 Error'));
            const p1 = useAppStore.getState().saveUserData(createMockUserData(1));
            const a1 = expect(p1).rejects.toThrow('Stage 1 Error');
            await vi.advanceTimersByTimeAsync(1100);
            await a1;
            expect(useAppStore.getState().saveError).toBe('Stage 1 Error');
            expect(useAppStore.getState().syncing).toBe(false);

            // Stage 2: Burst of 5 Successes (recovers error state)
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({ ok: true, status: 'synced' });
            const p2_burst = Array.from({ length: 5 }, (_, idx) => 
                useAppStore.getState().saveUserData(createMockUserData(10 + idx))
            );
            const r2_settled = Promise.allSettled(p2_burst);
            // Starting a new save clears saveError
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(true);
            await vi.advanceTimersByTimeAsync(1100);
            const r2 = await r2_settled;
            r2.forEach(res => expect(res.status).toBe('fulfilled'));
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().userData?.profile?.height).toBe('184');

            // Stage 3: Burst of 10 Failures
            const stage3Err = new Error('Stage 3 Firestore Timeout');
            vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(stage3Err);
            const p3_burst = Array.from({ length: 10 }, (_, idx) => 
                useAppStore.getState().saveUserData(createMockUserData(20 + idx))
            );
            const r3_settled = Promise.allSettled(p3_burst);
            await vi.advanceTimersByTimeAsync(1100);
            const r3 = await r3_settled;
            r3.forEach(res => {
                expect(res.status).toBe('rejected');
                if (res.status === 'rejected') {
                    expect((res as PromiseRejectedResult).reason).toBe(stage3Err);
                }
            });
            expect(useAppStore.getState().saveError).toBe(stage3Err.message);
            expect(useAppStore.getState().syncing).toBe(false);

            // Stage 4: saveUserData(null) immediately clears everything
            for (const k in idbStore) delete idbStore[k];
            const p4 = useAppStore.getState().saveUserData(null);
            await expect(p4).resolves.toEqual({ ok: true, status: 'synced' });
            expect(useAppStore.getState().userData).toBeNull();
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);

            // Stage 5: Final Single Success
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({ ok: true, status: 'synced' });
            const p5 = useAppStore.getState().saveUserData(createMockUserData(100));
            await vi.advanceTimersByTimeAsync(1100);
            await expect(p5).resolves.toEqual({ ok: true, status: 'synced' });
            expect(useAppStore.getState().userData?.profile?.height).toBe('270');
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);
        });

    });
});
