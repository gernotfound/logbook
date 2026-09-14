import { describe, it, expect, vi, beforeEach } from 'vitest';
import { doc, getDoc, writeBatch } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import { DomainParsers, UserDataSchema } from '../src/lib/schema';
import type {} from '../src/types';

vi.mock('../src/lib/firebase', () => ({
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

vi.mock('../src/lib/sync/session', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/sync/session')>('../src/lib/sync/session');
    const { auth } = await import('../src/lib/firebase');
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

    beforeEach(() => {
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
            nutritionPlanning: { weight: 80, carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
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
            const state1 = createBaseState();
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
                routines: [...state2.routines, { id: 'r_2', name: 'Pull', exercises: [] }]
            };
            await DB.saveUserData(state3);

            // Offline mutation 3 (Workout added)
            mockBatch.commit.mockRejectedValueOnce(timeoutErr);
            const state4 = {
                ...state3,
                history: [
                    ...state3.history,
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
            const userDocCall = setCalls.find((c: any) => c[1]?.profile !== undefined);
            expect(userDocCall[1].profile.height).toBe('182');
            expect(userDocCall[1].routines).toHaveLength(2);

            const historyDocCall = setCalls.find((c: any) => c[0].path?.includes('history_months') || c[1]?.h_2 !== undefined);
            expect(historyDocCall).toBeDefined();
            expect(historyDocCall[1].h_2).toBeDefined();

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
            expect(String(saveRes.error)).toMatch(/supera il limite di dimensione/);
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
            const { auth } = await import('../src/lib/firebase');
            const originalUser = auth.currentUser;
            (auth as any).currentUser = null;

            const state = createBaseState();
            await DB.saveUserData(state);
            expect(mockBatch.set).not.toHaveBeenCalled();
            expect(mockBatch.commit).not.toHaveBeenCalled();

            // Restore auth
            (auth as any).currentUser = originalUser;
        });
    });

    describe('2. 3-Month Windowing & Multi-Month Firestore Isolation', () => {
        it('2.1: DB.loadUserData strictly loads exactly 3 target months (current, M-1, M-2) via 8 getDoc calls', async () => {
            const mockUserDoc = {
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

            const mockHistoryM0 = { h_m0: { id: 'h_m0', date: `${m0}-10`, globalStartTime: 100, exercises: [] } };
            const mockHistoryM1 = { h_m1: { id: 'h_m1', date: `${m1}-15`, globalStartTime: 50, exercises: [] } };
            const mockNutritionM2 = { [`${m2}-05`]: { date: `${m2}-05`, kcal: 2200, carbs: 200, pro: 150, fat: 60, meals: [] } };

            vi.mocked(getDoc).mockImplementation(async (docRef: any) => {
                const pathStr = docRef?.path || '';
                if (pathStr.includes('history_months')) {
                    if (pathStr.includes(m0)) return { exists: () => true, data: () => mockHistoryM0 } as any;
                    if (pathStr.includes(m1)) return { exists: () => true, data: () => mockHistoryM1 } as any;
                    return { exists: () => true, data: () => ({}) } as any;
                }
                if (pathStr.includes('nutrition_months')) {
                    if (pathStr.includes(m2)) return { exists: () => true, data: () => mockNutritionM2 } as any;
                    return { exists: () => true, data: () => ({}) } as any;
                }
                // Root user doc
                return { exists: () => true, data: () => mockUserDoc } as any;
            });

            const loaded = await DB.loadUserData();

            expect(loaded).not.toBeNull();
            expect(loaded?.profile.height).toBe('178');
            expect(loaded?.history).toHaveLength(2);
            expect(loaded?.history[0].id).toBe('h_m0'); // Sorted by globalStartTime descending
            expect(loaded?.history[1].id).toBe('h_m1');
            expect(loaded?.nutrition[`${m2}-05`]).toBeDefined();

            // Total getDoc calls must be exactly 1 (manifest) + 1 (user) + 3 (history) + 3 (nutrition) = 8
            expect(getDoc).toHaveBeenCalledTimes(8);
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

            // Only August history doc should be written
            expect(mockBatch.set).toHaveBeenCalledTimes(1);
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
            const setCalls = mockBatch.set.mock.calls;

            // 1 user doc + 5 history month docs = 6 set calls
            expect(setCalls).toHaveLength(6);

            const monthDocsWritten = setCalls
                .map((c: any) => c[0]?.path || '')
                .filter((p: string) => p.includes('history_months'));

            expect(monthDocsWritten.some(p => p.includes('2025-01'))).toBe(true);
            expect(monthDocsWritten.some(p => p.includes('2025-06'))).toBe(true);
            expect(monthDocsWritten.some(p => p.includes('2026-06'))).toBe(true);
            expect(monthDocsWritten.some(p => p.includes('2026-07'))).toBe(true);
            expect(monthDocsWritten.some(p => p.includes('2026-08'))).toBe(true);
        });

        it('2.4: Deleting the last entity in a month persists a V3 parent tombstone instead of physically deleting the shard', async () => {
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

            // V3 keeps a tombstone-only monthly doc until causal GC can prove physical deletion safe.
            expect(mockBatch.delete).not.toHaveBeenCalled();
            expect(mockBatch.set).toHaveBeenCalledTimes(1);
            const [writtenRef, writtenData] = mockBatch.set.mock.calls[0];
            expect(writtenRef?.path || '').toContain('history_months/2026-07');
            expect(writtenData.h_jul_1).toBeUndefined();
            expect(writtenData._sync?.fields?.['h_jul_1']).toMatchObject({ deleted: true });

            // August is unchanged so it must not be rewritten.
            expect(writtenRef?.path || '').not.toContain('2026-08');
        });

        it('2.5: Derives timezone-safe monthKey from date string or fallback timestamp seamlessly', async () => {
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
                    { id: 'h_str', date: '2026-08-15', exercises: [] }, // String date
                    { id: 'h_ts', date: null, globalStartTime: 1723766400000, exercises: [] }, // Timestamp
                    { id: 'h_none', date: null, globalStartTime: null, exercises: [] } // Fallback to current date
                ],
                nutrition: {}
            };

            await DB.saveUserData(stateWithTimestamps);
            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });
    });

    describe('3. DomainParsers Adversarial & Malformed Input Stress Suite', () => {
        it('3.1: parseProfile handles adversarial types (NaN, boolean, array, symbols, nested garbage, prototype keys)', () => {
            const attackVectors = [
                NaN,
                null,
                undefined,
                true,
                false,
                12345,
                ['an', 'array'],
                { height: NaN, waist: null, neck: undefined, dob: 19900101, hips: { deep: 'corrupt' }, __proto__: { evil: 'true' } },
                { gender: 'other', height: '185.5', unknownKey: 'preservedViaPassthrough' }
            ];

            attackVectors.forEach(vector => {
                const parsed = DomainParsers.parseProfile(vector);
                expect(parsed).toBeDefined();
                expect(typeof parsed).toBe('object');
                expect(parsed).not.toBeNull();
            });

            // Specific conversion assertions
            const transformed = DomainParsers.parseProfile({ height: 180, waist: '85', dob: 20000101 });
            expect(transformed.height).toBe('180');
            expect(transformed.waist).toBe('85');
            expect(transformed.dob).toBe('20000101');
        });

        it('3.2: parseWorkoutSession recovers gracefully from corrupted exercises, nested sets, dropsets, and ratings', () => {
            const corruptedSession = {
                id: 12345, // string union transforms to '12345'
                routineName: null,
                date: undefined,
                moodRating: 'NaN', // string NaN transformed to null
                pumpRating: 5,
                fatigueRating: '  ', // empty trimmed string converted to null
                waterLiters: '2.5', // string float parsed to 2.5
                exercises: [
                    {
                        exId: 999, // transformed to '999'
                        sessionNote: null, // safeString falls back to ''
                        sets: [
                            {
                                id: 'set_1',
                                kg: 100, // converted to '100'
                                reps: 10, // converted to '10'
                                done: 'true', // string boolean converted to true
                                dropsets: [
                                    { id: 'ds_1', kg: 80, reps: '6' },
                                    'corrupted_dropset_string', // falls back to default
                                    null
                                ],
                                isometrics: [
                                    { id: 'iso_1', kg: 50, time: 20 },
                                    12345 // falls back to default
                                ]
                            },
                            null, // corrupted set element falls back to default
                            { kg: 'NaN', reps: null }
                        ]
                    },
                    'corrupted_exercise_item' // falls back to default
                ]
            };

            const parsed = DomainParsers.parseWorkoutSession(corruptedSession);
            expect(parsed.id).toBe('12345');
            expect(parsed.pumpRating).toBe(5);
            expect(parsed.fatigueRating).toBeNull();
            expect(parsed.waterLiters).toBe(2.5);
            expect(parsed.exercises).toHaveLength(2);
            expect(parsed.exercises[0].exId).toBe('999');
            expect(parsed.exercises[0].sets[0].kg).toBe('100');
            expect(parsed.exercises[0].sets[0].reps).toBe('10');
            expect(parsed.exercises[0].sets[0].done).toBe(true);
            expect(parsed.exercises[0].sets[0].dropsets).toHaveLength(3);
            expect(parsed.exercises[0].sets[0].isometrics).toHaveLength(2);
        });

        it('3.3: parseHistory sanitizes arrays containing corrupted items without crashing or dropping valid entries', () => {
            const rawHistory = [
                { id: 'h_valid', date: '2026-08-16', exercises: [] },
                null,
                undefined,
                { id: 999, corrupted: true },
                'raw string item',
                12345
            ];

            const parsed = DomainParsers.parseHistory(rawHistory);
            expect(parsed).toHaveLength(6);
            expect(parsed[0].id).toBe('h_valid');
            expect(parsed[3].id).toBe('999');
            expect(Array.isArray(parsed[1].exercises)).toBe(true);
        });

        it('3.4: parseNutrition handles invalid date keys, corrupted meals, and biometric values with defensive defaults', () => {
            const rawNutrition = {
                '2026-08-16': {
                    date: '2026-08-16',
                    kcal: '2400',
                    carbs: 'NaN', // falls back to 0
                    pro: '180.5',
                    fat: null, // falls back to 0
                    weight: '82.3',
                    bf: '14.5',
                    neck: ' ',
                    meals: [
                        { id: 'm1', name: 'Shake', meal: 'Spuntino', quantity: '300', kcal: '250', carbs: 10, pro: 40, fat: 3 },
                        null,
                        'corrupted meal'
                    ],
                    supplementsIntake: [
                        { id: 'si1', supplementId: 'creatine', amount: '5', time: '1723800000000' }
                    ]
                }
            };

            const parsed = DomainParsers.parseNutrition(rawNutrition);
            expect(parsed['2026-08-16'].kcal).toBe(2400);
            expect(parsed['2026-08-16'].carbs).toBe(0);
            expect(parsed['2026-08-16'].pro).toBe(180.5);
            expect(parsed['2026-08-16'].fat).toBe(0);
            expect(parsed['2026-08-16'].weight).toBe(82.3);
            expect(parsed['2026-08-16'].bf).toBe(14.5);
            expect(parsed['2026-08-16'].neck).toBeUndefined();
            expect(parsed['2026-08-16'].meals).toHaveLength(3);
            expect(parsed['2026-08-16'].meals[0].name).toBe('Shake');
            expect(parsed['2026-08-16'].supplementsIntake[0].amount).toBe(5);
        });

        it('3.5: parseLibrary handles exercise trackingType enums and sanitized sets', () => {
            const rawLibrary = [
                { id: 'ex_1', name: 'Panca', setsCount: '4', trackingType: 'weight_reps' },
                { id: 'ex_2', name: 'Plank', setsCount: 3, trackingType: 'time' },
                { id: 'ex_3', name: 'Cyclette', setsCount: 1, trackingType: 'cardio' },
                { id: 'ex_4', name: 'Invalid Type', setsCount: 2, trackingType: 'unsupported_mode' }
            ];

            const parsed = DomainParsers.parseLibrary(rawLibrary);
            expect(parsed).toHaveLength(4);
            expect(parsed[0].setsCount).toBe(4);
            expect(parsed[0].trackingType).toBe('weight_reps');
            expect(parsed[1].trackingType).toBe('time');
            expect(parsed[2].trackingType).toBe('cardio');
            expect(parsed[3].trackingType).toBeUndefined(); // invalid enum falls back to undefined
        });

        it('3.6: parseCustomFoods handles full micronutrient schema and stringified floats', () => {
            const rawFoods = [
                {
                    id: 'f1',
                    name: 'Salmone Selvaggio',
                    kcal: '208',
                    pro: '20.4',
                    carbs: '0',
                    fat: '13.2',
                    satFat: '3.1',
                    sodium: '55',
                    fiber: null,
                    iron: '0.5'
                }
            ];

            const parsed = DomainParsers.parseCustomFoods(rawFoods);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].kcal).toBe(208);
            expect(parsed[0].pro).toBe(20.4);
            expect(parsed[0].fat).toBe(13.2);
            expect(parsed[0].satFat).toBe(3.1);
            expect(parsed[0].sodium).toBe(55);
            expect(parsed[0].fiber).toBeNull();
            expect(parsed[0].iron).toBe(0.5);
        });

        it('3.7: parseRoutines & parseTrainingCycles handle sequence arrays and enum validation', () => {
            const rawCycles = [
                {
                    id: 'c1',
                    name: 'Forza 1',
                    durationWeeks: '6',
                    progressionMode: 'fixed',
                    routines: [{ routineId: 'r1', frequencyPerWeek: '2' }]
                },
                {
                    id: 'c2',
                    name: 'Forza 2',
                    durationWeeks: 4,
                    progressionMode: 'invalid_progression',
                    routines: []
                }
            ];

            const parsed = DomainParsers.parseTrainingCycles(rawCycles);
            expect(parsed).toHaveLength(2);
            expect(parsed[0].durationWeeks).toBe(6);
            expect(parsed[0].progressionMode).toBe('fixed');
            expect(parsed[0].routines[0].frequencyPerWeek).toBe(2);
            expect(parsed[1].progressionMode).toBeUndefined();
        });

        it('3.8: parseSupplements & parseNutritionPlanning handle nested ratios, boosts and lockedMacro', () => {
            const rawSupplements = [
                { id: 's1', name: 'Vitamina D3', unit: 'UI', target: '2000', portion: '1000' }
            ];
            const parsedSups = DomainParsers.parseSupplements(rawSupplements);
            expect(parsedSups[0].target).toBe(2000);
            expect(parsedSups[0].portion).toBe(1000);

            const rawPlanning = {
                weight: '82.5',
                onDaysCount: '4',
                avgMacros: { carbsPerKg: '4.0', proPerKg: '2.2', fatPerKg: '1.0' },
                onBoost: { carbsPercent: '20', proPercent: '0', fatPercent: '-10' },
                lockedMacro: 'carbs',
                normocalorica: { kcal: '2500', carbs: '300', pro: '160', fat: '70' }
            };

            const parsedPlanning = DomainParsers.parseNutritionPlanning(rawPlanning);
            expect(parsedPlanning.weight).toBe(82.5);
            expect(parsedPlanning.onDaysCount).toBe(4);
            expect(parsedPlanning.avgMacros?.carbsPerKg).toBe(4);
            expect(parsedPlanning.onBoost?.carbsPercent).toBe(20);
            expect(parsedPlanning.onBoost?.fatPercent).toBe(-10);
            expect(parsedPlanning.lockedMacro).toBe('carbs');
            expect(parsedPlanning.normocalorica?.kcal).toBe(2500);
        });

        it('3.9: Stress-tests legacy data compatibility without data loss', () => {
            // Simulate legacy export format from early app version
            const legacyUserData = {
                profile: { height: 175, weight: 75 }, // Legacy numeric fields
                library: [
                    { id: 'ex_legacy_1', name: 'Panca Piana Manubri', setsCount: 3, sets: [] } // Missing trackingType
                ],
                routines: [
                    { id: 'r_legacy_1', name: 'Full Body', exercises: [{ exId: 'ex_legacy_1', setsCount: 3 }] } // Missing defaultTechnique
                ],
                history: [
                    {
                        id: 'h_legacy_1',
                        date: '2025-03-10',
                        globalStartTime: 1710064800000,
                        exercises: [
                            {
                                exId: 'ex_legacy_1',
                                sessionNote: 'Legacy workout',
                                sets: [{ id: 's1', kg: '30', reps: '10', done: true }]
                            }
                        ]
                    }
                ],
                nutrition: {
                    '2025-03-10': {
                        date: '2025-03-10',
                        kcal: 2200,
                        carbs: 250,
                        pro: 150,
                        fat: 60,
                        meals: [{ id: 'm_legacy', name: 'Pasta al pomodoro', meal: 'Pranzo', quantity: 120, kcal: 400, carbs: 80, pro: 12, fat: 4 }]
                    }
                },
                customFoods: [{ id: 'cf_legacy', name: 'Tonno Naturale', kcal: 100, pro: 24, carbs: 0, fat: 0.5 }]
                // Missing trainingCycles, supplements, nutritionPlanning, activeCycleId
            };

            const parsed = UserDataSchema.parse(legacyUserData);

            expect(parsed.profile.height).toBe('175');
            expect(parsed.library).toHaveLength(1);
            expect(parsed.routines).toHaveLength(1);
            expect(parsed.history).toHaveLength(1);
            expect(parsed.history[0].id).toBe('h_legacy_1');
            expect(parsed.nutrition['2025-03-10']).toBeDefined();
            expect(parsed.customFoods).toHaveLength(1);
            // Missing top-level collections must default cleanly
            expect(parsed.trainingCycles).toEqual([]);
            expect(parsed.supplements).toEqual([]);
            expect(parsed.activeCycleId).toBeNull();
            expect(parsed.activeWorkout).toBeNull();
            expect(parsed.nutritionPlanning).toBeDefined();
        });
    });
});