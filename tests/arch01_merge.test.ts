import { initializeLocal } from '../src/lib/sync/localRepository';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeCloudIntoLocal, mergeHistoryNonDestructive, mergeNutritionNonDestructive } from '../src/lib/merge';
import { DB } from '../src/lib/db';
import { useAppStore } from '../src/store/useAppStore';
import { renderHook, act } from '@testing-library/react';
import { AuthProvider } from '../src/contexts/AuthContext';
import { AuthContext } from '../src/contexts/AuthContextDef';
import { useContext } from 'react';
import { auth } from '../src/lib/firebase';
import type { UserData, NutritionDay } from '../src/types';


const getEmptyUserData = (): UserData => ({
    profile: {},
    library: [],
    routines: [],
    history: [],
    nutrition: {},
    customFoods: [],
    catalogOverrides: {},
    activeWorkout: null,
    trainingCycles: [],
    activeCycleId: null,
    nutritionPlanning: {} as any,
    supplements: [],
    activePains: [],
});

describe('ARCH-01: Non-destructive Cache Merge', () => {
    describe('Pure Functions', () => {
        it('T1: Preserves historical records absent in cloud', () => {
            const localHistory = [{ id: 'WID-2023-01', name: 'Old Workout' }];
            const cloudHistory = [{ id: 'WID-2026-09', name: 'Recent Workout' }];
            
            const merged = mergeHistoryNonDestructive(localHistory, cloudHistory);
            
            expect(merged).toHaveLength(2);
            expect(merged.find(h => h.id === 'WID-2023-01')).toBeDefined();
            expect(merged.find(h => h.id === 'WID-2026-09')).toBeDefined();
        });

        it('T2 & T6: Local wins on history ID collision (Conservative Policy)', () => {
            const localHistory = [{ id: 'WID-COLLISION', name: 'Local Edit Offline' }];
            const cloudHistory = [{ id: 'WID-COLLISION', name: 'Cloud Older Version' }];
            
            const merged = mergeHistoryNonDestructive(localHistory, cloudHistory);
            
            expect(merged).toHaveLength(1);
            expect(merged[0].name).toBe('Local Edit Offline');
        });

        it('T3: Preserves historical nutrition absent in cloud', () => {
            const localNut: Record<string, NutritionDay> = {
                '2023-01-15': { date: '2023-01-15', kcal: 2000, carbs: 200, pro: 150, fat: 60 }
            };
            const cloudNut: Record<string, NutritionDay> = {
                '2026-09-01': { date: '2026-09-01', kcal: 2500, carbs: 300, pro: 180, fat: 70 }
            };

            const merged = mergeNutritionNonDestructive(localNut, cloudNut);
            
            expect(merged['2023-01-15']).toBeDefined();
            expect(merged['2026-09-01']).toBeDefined();
        });

        it('T4: Local wins on nutrition date collision (Conservative Policy)', () => {
            const localNut: Record<string, NutritionDay> = {
                '2026-09-01': { date: '2026-09-01', kcal: 9999, carbs: 200, pro: 150, fat: 60 } // local offline edit
            };
            const cloudNut: Record<string, NutritionDay> = {
                '2026-09-01': { date: '2026-09-01', kcal: 2500, carbs: 300, pro: 180, fat: 70 }
            };

            const merged = mergeNutritionNonDestructive(localNut, cloudNut);
            
            expect(merged['2026-09-01'].kcal).toBe(9999);
        });

        it('T7 & T8: Handles empty data gracefully', () => {
            const mergedHist = mergeHistoryNonDestructive(undefined, []);
            expect(mergedHist).toEqual([]);

            const mergedNut = mergeNutritionNonDestructive({}, undefined);
            expect(mergedNut).toEqual({});
        });

        it('T9: mergeCloudIntoLocal parses through Zod and respects policies', () => {
            const localData = getEmptyUserData();
            localData.history = [{ id: 'old-1', globalStartTime: 1000 } as any];
            localData.profile = { name: 'Local Name' };

            const cloudData = getEmptyUserData();
            cloudData.history = [{ id: 'new-1', globalStartTime: 2000 } as any];
            cloudData.profile = { name: 'Cloud Name' }; // Cloud overrides non-windowed

            const merged = mergeCloudIntoLocal(localData, cloudData);

            expect(merged.profile?.name).toBe('Cloud Name');
            expect(merged.history.find(h => h.id === 'old-1')).toBeDefined();
            expect(merged.history.find(h => h.id === 'new-1')).toBeDefined();
        });
    });

    describe('Integration: loadData Flow', () => {
        beforeEach(() => {
            useAppStore.getState().resetStore();
            vi.clearAllMocks();
        });

        it('T10 & Integration: V3 window hydration preserves unloaded months without triggering DB.saveUserData', async () => {
            (auth as any).currentUser = { uid: 'user123' };
            // Setup local state with an OLD month that is outside the authoritative cloud window.
            const initialLocal = getEmptyUserData();
            initialLocal.history = [{ id: 'local-old', date: '2025-01-10', exercises: [] } as any];
            useAppStore.setState({ userData: initialLocal });
            await initializeLocal('user:user123', initialLocal);

            // Setup cloud response for a different, complete month.
            const cloudResponse = getEmptyUserData();
            cloudResponse.history = [{ id: 'cloud-new', date: '2026-09-10', exercises: [] } as any];
            const loadSpy = vi.spyOn(DB, 'loadCloudPayload').mockResolvedValue({
                data: cloudResponse,
                completeMonths: ['2026-09'],
                cloudDocuments: new Map()
            });
            const saveSpy = vi.spyOn(DB, 'saveUserData');

            let authCallback: any = null;
            const { onAuthStateChanged } = await import('firebase/auth');
            (onAuthStateChanged as any).mockImplementation((_auth: any, cb: any) => {
                authCallback = cb;
                return () => {};
            });

            const rendered = renderHook(() => useContext(AuthContext), { wrapper: AuthProvider });

            try {
                // Give React a moment to run the effect
                await act(async () => {
                    await new Promise(r => setTimeout(r, 10));
                });

                if (!authCallback) throw new Error("authCallback was not set by renderHook!");

                // Fire auth callback with a mock user
                await act(async () => {
                    (auth as any).currentUser = { uid: 'user123' };
                    await authCallback({ uid: 'user123' });
                    // Flush loadData promises
                    await new Promise(r => setTimeout(r, 10));
                });

                // Verification: unloaded January survives while complete September is adopted.
                const finalState = useAppStore.getState().userData;
                expect(finalState).not.toBeNull();
                const historyIds = finalState!.history.map(h => h.id);
                expect(historyIds).toContain('local-old');
                expect(historyIds).toContain('cloud-new');

                // Hydration must NOT trigger a write to Firestore.
                expect(saveSpy).not.toHaveBeenCalled();
                expect(loadSpy).toHaveBeenCalledTimes(1);
            } finally {
                rendered.unmount();
                loadSpy.mockRestore();
                saveSpy.mockRestore();
            }
        });

        it('Hydration fallback: invalid projected cloud data preserves local state', async () => {
            (auth as any).currentUser = { uid: 'user123' };
            const initialLocal = getEmptyUserData();
            initialLocal.profile = { name: 'Valid Local' } as any;
            useAppStore.setState({ userData: initialLocal });
            await initializeLocal('user:user123', initialLocal);

            // UserDataSchema accepts arbitrary record keys; documentProjection correctly rejects non-date nutrition keys.
            // This exercises the real hydrateLocal -> projectDocuments failure boundary caught by AuthContext.
            const cloudResponse = getEmptyUserData();
            cloudResponse.profile = { name: 'Cloud Name' } as any;
            cloudResponse.nutrition = {
                'not-a-date': { date: 'not-a-date', kcal: 100, carbs: 10, pro: 10, fat: 1 }
            } as any;
            const loadSpy = vi.spyOn(DB, 'loadCloudPayload').mockResolvedValue({
                data: cloudResponse,
                completeMonths: [],
                cloudDocuments: new Map()
            });
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            let authCallback: any = null;
            const { onAuthStateChanged } = await import('firebase/auth');
            (onAuthStateChanged as any).mockImplementation((_auth: any, cb: any) => {
                authCallback = cb;
                return () => {};
            });

            const rendered = renderHook(() => useContext(AuthContext), { wrapper: AuthProvider });

            try {
                await act(async () => {
                    await new Promise(r => setTimeout(r, 10));
                });

                if (!authCallback) throw new Error("authCallback was not set by renderHook!");

                await act(async () => {
                    (auth as any).currentUser = { uid: 'user123' };
                    await authCallback({ uid: 'user123' });
                    // Flush loadData promises
                    await new Promise(r => setTimeout(r, 10));
                });

                const finalState = useAppStore.getState().userData;
                expect(finalState?.profile?.name).toBe('Valid Local');
                expect(consoleSpy).toHaveBeenCalledWith(
                    "Zod parse failed during hydration merge, preserving local valid state:",
                    expect.any(Error)
                );
            } finally {
                rendered.unmount();
                loadSpy.mockRestore();
                consoleSpy.mockRestore();
            }
        });
    });
});