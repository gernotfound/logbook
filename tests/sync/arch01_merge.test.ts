import { adoptReplicaCheckpoint, initializeLocal } from '../../src/lib/sync/localRepository';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DB } from '../../src/lib/db';
import { useAppStore } from '../../src/store/useAppStore';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider } from '../../src/contexts/AuthContext';
import { AuthContext } from '../../src/contexts/AuthContextDef';
import { useContext } from 'react';
import { auth } from '../../src/lib/firebase';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import type { UserData } from '../../src/types';


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

describe('ARCH-01: Authenticated hydration and recovery integrity', () => {
    describe('Integration: loadData Flow', () => {
        beforeEach(async () => {
            useAppStore.getState().resetStore();
            vi.clearAllMocks();
            await prepareUnlockedTestArchive('user:user123');
        });

        it('T10 & Integration: V3 window hydration preserves unloaded months without triggering DB.saveUserData', async () => {
            (auth as any).currentUser = { uid: 'user123' };
            // Setup local state with an OLD month that is outside the authoritative cloud window.
            const initialLocal = getEmptyUserData();
            initialLocal.history = [{ id: 'local-old', date: '2025-01-10', exercises: [] } as any];
            useAppStore.setState({ userData: initialLocal });
            await initializeLocal('user:user123', initialLocal);
            const checkpointNow = Date.now();
            await adoptReplicaCheckpoint('user:user123', {
                identity: {
                    slot: 's00',
                    replicaId: 'window-test-replica',
                    generation: 1,
                    checkpointAtMs: checkpointNow,
                    leaseUntilMs: checkpointNow + 360 * 24 * 60 * 60 * 1000,
                },
                baseSeq: 0,
            }, { clock: {}, syncMetaByDocument: {} });

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
                await waitFor(() => expect(authCallback).not.toBeNull());

                // Fire auth callback with a mock user
                await act(async () => {
                    (auth as any).currentUser = { uid: 'user123' };
                    await authCallback({ uid: 'user123' });
                });
                await waitFor(() => expect(useAppStore.getState().userData?.history?.map(h => h.id)).toContain('cloud-new'));

                // Verification: unloaded January survives while complete September is adopted.
                const finalState = useAppStore.getState().userData;
                expect(finalState).not.toBeNull();
                const historyIds = finalState!.history?.map(h => h.id);
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

        it('Hydration fail-closed: malformed cloud sync metadata preserves local state and surfaces a recovery error', async () => {
            (auth as any).currentUser = { uid: 'user123' };
            const initialLocal = getEmptyUserData();
            initialLocal.profile = { height: '170' };
            useAppStore.setState({ userData: initialLocal });
            await initializeLocal('user:user123', initialLocal);

            const cloudResponse = getEmptyUserData();
            cloudResponse.profile = { height: '190' };
            const loadSpy = vi.spyOn(DB, 'loadCloudPayload').mockResolvedValue({
                data: cloudResponse,
                completeMonths: [],
                cloudDocuments: new Map([['', {
                    profile: cloudResponse.profile,
                    _sync: { protocolVersion: 1, clock: { broken: -1 }, fields: {} }
                } as any]])
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
                await waitFor(() => expect(authCallback).not.toBeNull());

                await act(async () => {
                    (auth as any).currentUser = { uid: 'user123' };
                    await authCallback({ uid: 'user123' });
                });
                await waitFor(() => expect(useAppStore.getState().saveError).toContain('metadati di sincronizzazione remoti non sono validi'));

                const state = useAppStore.getState();
                expect(state.userData?.profile?.height).toBe('170');
                expect(state.saveError).toContain('metadati di sincronizzazione remoti non sono validi');
                expect(consoleSpy).toHaveBeenCalledWith(
                    'Metadati di sincronizzazione cloud non validi; stato locale preservato:',
                    expect.objectContaining({ code: 'invalid-cloud-sync-metadata' })
                );
            } finally {
                rendered.unmount();
                loadSpy.mockRestore();
                consoleSpy.mockRestore();
            }
        });

        it('Hydration fallback: invalid projected cloud data preserves local state', async () => {
            (auth as any).currentUser = { uid: 'user123' };
            const initialLocal = getEmptyUserData();
            initialLocal.profile = { height: '170' };
            useAppStore.setState({ userData: initialLocal });
            await initializeLocal('user:user123', initialLocal);

            // UserDataSchema accepts arbitrary record keys; documentProjection correctly rejects non-date nutrition keys.
            // This exercises the real hydrateLocal -> projectDocuments failure boundary caught by AuthContext.
            const cloudResponse = getEmptyUserData();
            cloudResponse.profile = { height: '190' };
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
                await waitFor(() => expect(authCallback).not.toBeNull());

                await act(async () => {
                    (auth as any).currentUser = { uid: 'user123' };
                    await authCallback({ uid: 'user123' });
                });
                await waitFor(() => expect(consoleSpy).toHaveBeenCalledWith(
                    "Hydration cloud non valida; stato locale preservato:",
                    expect.any(Error)
                ));

                const finalState = useAppStore.getState().userData;
                expect(finalState?.profile?.height).toBe('170');
                expect(consoleSpy).toHaveBeenCalledWith(
                    "Hydration cloud non valida; stato locale preservato:",
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