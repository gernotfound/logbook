import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { doc, getDoc, getDocFromServer, writeBatch } from 'firebase/firestore';

vi.unmock('../../../src/lib/db');
import { ConsentedTestDB as DB, openTestCloudBusiness, openTestCloudDocument, sealTestCloudFixture, testCloudKey } from '../../testUtils';

import type { UserData } from '../../../src/types';

vi.mock('../../../src/lib/firebase', () => ({
    auth: {
        currentUser: { uid: 'test-user-id' },
        signOut: vi.fn().mockResolvedValue(undefined),
    },
    db: {},
    getDb: vi.fn().mockReturnValue({}),
    ensureAppCheck: vi.fn().mockResolvedValue(undefined),
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/lib/sync/session', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/sync/session')>('../../../src/lib/sync/session');
    const { auth } = await import('../../../src/lib/firebase');
    return {
        ...actual,
        storageOwner: () => auth.currentUser?.uid ? `user:${auth.currentUser.uid}` : 'guest',
        captureSession: () => ({ owner: auth.currentUser?.uid ? `user:${auth.currentUser.uid}` : 'guest', epoch: 0 }),
        isCurrentSession: (session: any) => session.owner === (auth.currentUser?.uid ? `user:${auth.currentUser.uid}` : 'guest'),
    };
});

describe('Empirical Challenger: Persistence, Save Amnesia, 3-Month Windowing & DomainParsers Stress Suite', () => {
    let mockBatch: any;
    let mockDocs: Record<string, any> = {};

    beforeEach(async () => {
        vi.clearAllMocks();
        DB.resetCache();
        mockDocs = {};

        vi.mocked(doc).mockImplementation((_db: any, ...parts: string[]) => {
            const path = parts.join('/');
            return { path, toString: () => path } as any;
        });

        let pendingWrites: Array<() => void> = [];

        mockBatch = {
            set: vi.fn().mockImplementation((docRef: any, data: any) => {
                const path = docRef?.path || String(docRef);
                pendingWrites.push(() => {
                    mockDocs[path] = structuredClone(data);
                });
            }),
            delete: vi.fn().mockImplementation((docRef: any) => {
                const path = docRef?.path || String(docRef);
                pendingWrites.push(() => {
                    delete mockDocs[path];
                });
            }),
            commit: vi.fn().mockImplementation(async () => {
                const writes = pendingWrites;
                pendingWrites = [];
                for (const write of writes) write();
            }),
        };
        vi.mocked(writeBatch).mockImplementation(() => {
            pendingWrites = [];
            return mockBatch;
        });

        vi.mocked(getDoc).mockImplementation(async (docRef: any) => {
            const path = docRef?.path || String(docRef);
            if (mockDocs[path] !== undefined) {
                return { exists: () => true, data: () => structuredClone(mockDocs[path]) } as any;
            }
            return { exists: () => false, data: () => ({}) } as any;
        });
        // Both APIs model the same simulated remote store, but retain separate
        // spies so cache-based reads cannot satisfy the authoritative-read oracle.
        vi.mocked(getDocFromServer).mockImplementation(async ref => vi.mocked(getDoc)(ref));
        // Exercise authenticated persistence only after the real device-vault bootstrap.
        await prepareUnlockedTestArchive('user:test-user-id');
    });

    describe('1. Persistence and Save Amnesia Adversarial Tests', () => {
        const createBaseState = (): Record<string, any> => ({
            profile: { height: '180', gender: 'male' },
            library: [{ id: 'ex_1', name: 'Squat', setsCount: 4, sets: [] }],
            routines: [{ id: 'r_1', name: 'Legs', exercises: [{ exId: 'ex_1', setsCount: 4 }] }],
            customFoods: [{ id: 'food_1', name: 'Avena', kcal: 370, pro: 13, carbs: 68, fat: 7 }],
            history: [{ id: 'h_1', date: '2026-08-16', exercises: [] }],
            nutrition: { '2026-08-16': { date: '2026-08-16', kcal: 2500, carbs: 300, pro: 160, fat: 70, meals: [] } },
            activeWorkout: null,
            trainingCycles: [{ id: 'c_1', name: 'Cycle 1', durationWeeks: 4, routines: [] }],
            activeCycleId: 'c_1',
            nutritionPlanning: { weight: 80, avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 } },
            supplements: [{ id: 'sup_1', name: 'Creatina', unit: 'g' }]
        });

        it('1.1: Prevents Save Amnesia when commit fails with network timeout, successfully retrying on next invocation', async () => {
            const state = createBaseState();

            // First save succeeds
            await DB.saveUserData(state);
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Mutate profile and attempt save with timeout rejection
            const mutatedState1 = { ...state, profile: { height: '185', gender: 'male' } };
            mockBatch.commit.mockRejectedValueOnce(new Error('Timeout sincronizzazione Firestore'));

            await DB.saveUserData(mutatedState1);
            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Next save with the same mutatedState1 MUST detect that data was never committed to Firestore
            mockBatch.commit.mockResolvedValueOnce(undefined);
            await DB.saveUserData(mutatedState1);

            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Subsequent identical save should now be recognized as clean (hasWrites = false)
            await DB.saveUserData(mutatedState1);
            expect(mockBatch.set).not.toHaveBeenCalled();
            expect(mockBatch.commit).not.toHaveBeenCalled();
        });

        it('1.2: Prevents Save Amnesia when commit fails with offline unavailable code', async () => {
            const state = createBaseState();
            await DB.saveUserData(state);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            const mutatedState = {
                ...state,
                customFoods: [
                    ...state.customFoods,
                    { id: 'food_2', name: 'Riso Basmati', kcal: 350, pro: 8, carbs: 78, fat: 1 }
                ]
            };

            const unavailableError: any = new Error('The service is currently unavailable.');
            unavailableError.code = 'unavailable';
            mockBatch.commit.mockRejectedValueOnce(unavailableError);

            await DB.saveUserData(mutatedState);
            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Retry should re-attempt the uncommitted food_2
            mockBatch.commit.mockResolvedValueOnce(undefined);
            await DB.saveUserData(mutatedState);
            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });

        it('1.3: Prevents Save Amnesia on fatal permission errors by re-throwing and preserving dirty state', async () => {
            const state = createBaseState();
            const permError: any = new Error('Missing or insufficient permissions.');
            permError.code = 'permission-denied';
            mockBatch.commit.mockRejectedValueOnce(permError);

            const saveRes = await DB.saveUserData(state);
            expect(saveRes).toEqual({ ok: false, status: 'rejected', error: permError });
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Next attempt must still see state as dirty
            mockBatch.commit.mockResolvedValueOnce(undefined);
            await DB.saveUserData(state);
            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });

        it('1.4: Accurately skips writes and commits on repeated identical saves (zero redundant traffic)', async () => {
            const state = createBaseState();

            // Initial commit
            await DB.saveUserData(state);
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Repeat 5 times with identical state
            for (let i = 0; i < 5; i++) {
                await DB.saveUserData(state);
                expect(mockBatch.set).not.toHaveBeenCalled();
                expect(mockBatch.commit).not.toHaveBeenCalled();
            }
        });

        it('1.5: Accumulates offline state mutations across multiple failures and commits the complete aggregate state on recovery', async () => {
            const state1: UserData = createBaseState();
            await DB.saveUserData(state1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Offline mutation 1 (Profile changed)
            const timeoutErr = new Error('Timeout sincronizzazione Firestore');
            mockBatch.commit.mockRejectedValueOnce(timeoutErr);
            const state2 = { ...state1, profile: { height: '182', gender: 'male' } };
            await DB.saveUserData(state2);

            // Offline mutation 2 (Routine added)
            mockBatch.commit.mockRejectedValueOnce(timeoutErr);
            const state3 = {
                ...state2,
                routines: [...(state2.routines ?? []), { id: 'r_2', name: 'Pull', exercises: [] }]
            };
            await DB.saveUserData(state3);

            // Offline mutation 3 (Workout added)
            mockBatch.commit.mockRejectedValueOnce(timeoutErr);
            const state4 = {
                ...state3,
                history: [
                    ...(state3.history ?? []),
                    { id: 'h_2', date: '2026-08-17', exercises: [] }
                ]
            };
            await DB.saveUserData(state4);

            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Online recovery: save state4 successfully
            mockBatch.commit.mockResolvedValueOnce(undefined);
            await DB.saveUserData(state4);

            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);

            // Check that all mutations (profile, routines, history) are reflected in the committed writeBatch
            const setCalls = mockBatch.set.mock.calls;
            const userDocCall = setCalls.find((c: any) => c[0]?.path === 'users/test-user-id' && c[1]?._sealed);
            expect(userDocCall).toBeDefined();
            const rootBusiness = openTestCloudBusiness(userDocCall[1]);
            expect(rootBusiness.profile.height).toBe('182');
            expect(rootBusiness.routines).toHaveLength(2);

            const historyDocCall = setCalls.find((c: any) => c[0].path?.includes('history_months') || c[1]?.h_2 !== undefined);
            expect(historyDocCall).toBeDefined();
            expect(openTestCloudBusiness(historyDocCall[1], 'history_months/2026-08').h_2).toBeDefined();

            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Subsequent save is now clean
            await DB.saveUserData(state4);
            expect(mockBatch.set).not.toHaveBeenCalled();
            expect(mockBatch.commit).not.toHaveBeenCalled();
        });

        it('1.6: Enforces the real 950KB checkDocSize threshold and rejects before Firestore commit without poisoning the journal', async () => {
            const state = createBaseState();
            await DB.saveUserData(state);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // FoodSchema is passthrough: this valid custom item reaches the V3 root doc with the large extension field intact.
            const oversizedState = {
                ...state,
                customFoods: [
                    ...state.customFoods,
                    {
                        id: 'giant_food',
                        name: 'Oversized but schema-valid custom food',
                        kcal: 500,
                        pro: 30,
                        carbs: 50,
                        fat: 20,
                        isCustom: true,
                        extraNutritionNote: 'x'.repeat(960_000)
                    }
                ]
            };

            const saveRes = await DB.saveUserData(oversizedState);
            expect(saveRes.ok).toBe(false);
            expect(saveRes.status).toBe('failed');
            expect(String('error' in saveRes ? saveRes.error : undefined)).toMatch(/supera il limite di dimensione/);
            expect(mockBatch.commit).not.toHaveBeenCalled();

            // A later clean semantic update must supersede the oversized pending operation and sync successfully.
            const cleanState = { ...state, profile: { height: '190' } };
            mockBatch.commit.mockResolvedValueOnce(undefined);
            const cleanRes = await DB.saveUserData(cleanState);
            expect(cleanRes.ok).toBe(true);
            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });

        it('1.7: Safely handles unauthenticated calls without throwing or updating lastSavedStateStr', async () => {
            const { auth } = await import('../../../src/lib/firebase');
            const originalUser = auth.currentUser;
            (auth as any).currentUser = null;
            try {
                // No authenticated owner capability: saving must fail closed
                // instead of creating the guest's plaintext archive.
                await expect(DB.saveUserData(createBaseState())).rejects.toThrow('Archivio protetto non pronto');
                expect(mockBatch.set).not.toHaveBeenCalled();
                expect(mockBatch.commit).not.toHaveBeenCalled();
            } finally {
                (auth as any).currentUser = originalUser;
            }
        });
    });

    describe('2. 3-Month Windowing & Multi-Month Firestore Isolation', () => {
        it('2.1: DB.loadCloudPayload reads 3 months with 9 authoritative server reads including control epochs', async () => {
            const mockUserDoc = {
                _schemaVersion: 1,
                _sync: {
                    protocolVersion: 3,
                    clock: {},
                    fields: {},
                    writer: { slot: 's00', replicaId: 'window-seed', generation: 1, seq: 0 },
                },
                profile: { height: '178' },
                library: [],
                routines: [],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: []
            };

            const now = new Date();
            const m0 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const d1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const m1 = `${d1.getFullYear()}-${String(d1.getMonth() + 1).padStart(2, '0')}`;
            const d2 = new Date(now.getFullYear(), now.getMonth() - 2, 1);
            const m2 = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}`;

            const currentMonth = (business: Record<string, unknown>) => ({
                ...business,
                _schemaVersion: 1,
                _sync: {
                    protocolVersion: 3,
                    clock: {},
                    fields: {},
                    writer: { slot: 's00', replicaId: 'window-seed', generation: 1, seq: 0 },
                },
            });
            const mockHistoryM0 = currentMonth({ h_m0: { id: 'h_m0', date: `${m0}-10`, globalStartTime: 100, exercises: [] } });
            const mockHistoryM1 = currentMonth({ h_m1: { id: 'h_m1', date: `${m1}-15`, globalStartTime: 50, exercises: [] } });
            const mockNutritionM2 = currentMonth({ [`${m2}-05`]: { date: `${m2}-05`, kcal: 2200, carbs: 200, pro: 150, fat: 60, meals: [] } });

            vi.mocked(getDocFromServer).mockImplementation(async (docRef: any) => {
                const pathStr = docRef?.path || '';
                // sync_control/state is public causal metadata, not a sealed
                // business document. Both server reads must see one stable epoch.
                if (pathStr.endsWith('/sync_control/state')) {
                    return { exists: () => true, data: () => ({
                        protocolVersion: 3, replicas: {}, mutation: { batchId: 'stable-fixture' },
                    }) } as any;
                }
                if (pathStr.includes('history_months')) {
                    if (pathStr.includes(m0)) return { exists: () => true, data: () => sealTestCloudFixture(mockHistoryM0, 'history_months/' + m0) } as any;
                    if (pathStr.includes(m1)) return { exists: () => true, data: () => sealTestCloudFixture(mockHistoryM1, 'history_months/' + m1) } as any;
                    return { exists: () => false, data: () => undefined } as any;
                }
                if (pathStr.includes('nutrition_months')) {
                    if (pathStr.includes(m2)) return { exists: () => true, data: () => sealTestCloudFixture(mockNutritionM2, 'nutrition_months/' + m2) } as any;
                    return { exists: () => false, data: () => undefined } as any;
                }
                // Root user doc
                return { exists: () => true, data: () => sealTestCloudFixture(mockUserDoc) } as any;
            });

            const loaded = (await DB.loadCloudPayload({ cloudKey: testCloudKey() }))?.data;

            expect(loaded).not.toBeNull();
            expect(loaded?.profile?.height).toBe('178');
            expect(loaded?.history).toHaveLength(2);
            expect(loaded?.history?.[0]?.id).toBe('h_m0'); // Sorted by globalStartTime descending
            expect(loaded?.history?.[1]?.id).toBe('h_m1');
            expect(loaded?.nutrition?.[`${m2}-05`]).toBeDefined();

            // Catalog manifest still uses getDoc; user root/months require a real server-read boundary.
            expect(getDoc).toHaveBeenCalledTimes(1);
            // Six month reads, one root read and two control-epoch witnesses.
            expect(getDocFromServer).toHaveBeenCalledTimes(9);
        });

        it('2.2: Verifies older months on Firestore are never deleted or affected when saving current data', async () => {
            const state = {
                profile: {},
                library: [],
                routines: [],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: [],
                activeWorkout: null,
                history: [
                    { id: 'h_aug', date: '2026-08-16', exercises: [] },
                    { id: 'h_jul', date: '2026-07-20', exercises: [] }
                ],
                nutrition: {
                    '2026-08-16': { date: '2026-08-16', kcal: 2000, carbs: 200, pro: 150, fat: 50, meals: [] }
                }
            };

            await DB.saveUserData(state);

            // Verify written batches
            const deleteCalls = mockBatch.delete.mock.calls;
            // No delete calls should have been made for older months not in state
            expect(deleteCalls).toHaveLength(0);

            // Mutate August history
            const updatedState = {
                ...state,
                history: [
                    { id: 'h_aug', date: '2026-08-16', sessionNote: 'Updated', exercises: [] },
                    { id: 'h_jul', date: '2026-07-20', exercises: [] }
                ]
            };

            mockBatch.set.mockClear();
            mockBatch.delete.mockClear();

            await DB.saveUserData(updatedState);

            // Only August history is a business-document write; Protocol 3 also advances sync_control atomically.
            const businessWrites = mockBatch.set.mock.calls.filter((call: any[]) => !String(call[0]?.path || '').includes('sync_control'));
            expect(businessWrites).toHaveLength(1);
            expect(businessWrites[0][0]?.path || '').toContain('history_months/2026-08');
            expect(mockBatch.delete).not.toHaveBeenCalled();
        });

        it('2.3: Correctly buckets multi-month history spanning 5 different historical months into distinct Firestore docs', async () => {
            const multiMonthState = {
                profile: { name: 'Multi Month User' },
                library: [],
                routines: [],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: [],
                activeWorkout: null,
                history: [
                    { id: 'h_2025_01', date: '2025-01-15', exercises: [] },
                    { id: 'h_2025_06', date: '2025-06-20', exercises: [] },
                    { id: 'h_2026_06', date: '2026-06-10', exercises: [] },
                    { id: 'h_2026_07', date: '2026-07-05', exercises: [] },
                    { id: 'h_2026_08', date: '2026-08-16', exercises: [] }
                ],
                nutrition: {}
            };

            await DB.saveUserData(multiMonthState);

            expect(mockBatch.set).toHaveBeenCalled();
            const setCalls = mockBatch.set.mock.calls
                .filter((call: any[]) => !String(call[0]?.path || '').includes('sync_control'));

            // 1 user doc + 5 history month docs = 6 business-document writes.
            expect(setCalls).toHaveLength(6);

            const monthDocsWritten: string[] = setCalls
                .map((c: any) => c[0]?.path || '')
                .filter((p: string) => p.includes('history_months'));

            expect(monthDocsWritten.some(p => p.includes('2025-01'))).toBe(true);
            expect(monthDocsWritten.some(p => p.includes('2025-06'))).toBe(true);
            expect(monthDocsWritten.some(p => p.includes('2026-06'))).toBe(true);
            expect(monthDocsWritten.some(p => p.includes('2026-07'))).toBe(true);
            expect(monthDocsWritten.some(p => p.includes('2026-08'))).toBe(true);
        });

        it('2.4: Deleting the last entity in a month persists a causal parent tombstone instead of physically deleting the shard', async () => {
            const stateWithTwoMonths = {
                profile: {},
                library: [],
                routines: [],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: [],
                activeWorkout: null,
                history: [
                    { id: 'h_jul_1', date: '2026-07-10', exercises: [] },
                    { id: 'h_aug_1', date: '2026-08-16', exercises: [] }
                ],
                nutrition: {}
            };

            // Initial save of July and August
            await DB.saveUserData(stateWithTwoMonths);
            mockBatch.set.mockClear();
            mockBatch.delete.mockClear();

            // Delete July entirely from state
            const stateAugustOnly = {
                ...stateWithTwoMonths,
                history: [
                    { id: 'h_aug_1', date: '2026-08-16', exercises: [] }
                ]
            };

            const result = await DB.saveUserData(stateAugustOnly);
            expect(result.ok).toBe(true);

            // Protocol 3 keeps a tombstone-only monthly doc until stable-frontier GC can retire it.
            expect(mockBatch.delete).not.toHaveBeenCalled();
            const businessWrites = mockBatch.set.mock.calls.filter((call: any[]) => !String(call[0]?.path || '').includes('sync_control'));
            expect(businessWrites).toHaveLength(1);
            const [writtenRef, writtenData] = businessWrites[0];
            expect(writtenRef?.path || '').toContain('history_months/2026-07');
            const july = openTestCloudDocument(writtenData, 'history_months/2026-07');
            expect(july.business.h_jul_1).toBeUndefined();
            expect(july.sync.fields['h_jul_1']).toMatchObject({ deleted: true });
            expect(writtenData._sync.fields).toEqual({});

            // August is unchanged so it must not be rewritten.
            expect(writtenRef?.path || '').not.toContain('2026-08');
        });

        it('2.5: Derives monthKey from explicit date or timestamp and rejects missing temporal identity', async () => {
            const stateWithTimestamps = {
                profile: {},
                library: [],
                routines: [],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: [],
                activeWorkout: null,
                history: [
                    { id: 'h_str', date: '2026-08-15', exercises: [] },
                    { id: 'h_ts', date: null, globalStartTime: 1723766400000, exercises: [] }
                ],
                nutrition: {}
            };

            const validResult = await DB.saveUserData(stateWithTimestamps);
            expect(validResult.ok).toBe(true);
            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);

            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();
            await expect(DB.saveUserData({
                ...stateWithTimestamps,
                history: [...stateWithTimestamps.history, { id: 'h_none', date: null, globalStartTime: null, exercises: [] }]
            })).rejects.toThrow(/identità temporale/i);
            expect(mockBatch.commit).not.toHaveBeenCalled();
        });
    });
});
