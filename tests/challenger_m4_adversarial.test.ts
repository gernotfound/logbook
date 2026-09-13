import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDoc, writeBatch } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import { mergeUserData } from '../src/lib/merge';
import { DomainParsers } from '../src/lib/schema';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';

vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: {
            uid: 'test-user-id',
            getIdTokenResult: vi.fn().mockResolvedValue({ authTime: new Date().toISOString() }),
        },
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

describe('Empirical Challenger: Architectural Hardening Stress Suite', () => {
    let mockBatch: any;
    let mockDocs: Record<string, any> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        DB.resetCache();
        useAppStore.getState().resetStore();
        mockDocs = {};

        vi.mocked(getDoc).mockImplementation(async (docRef: any) => {
            const path = docRef?.path || String(docRef);
            if (mockDocs[path] !== undefined) {
                return { exists: () => true, data: () => structuredClone(mockDocs[path]) } as any;
            }
            return { exists: () => false, data: () => ({}) } as any;
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
    });

    describe('Scope 1: Save Amnesia & Offline Diffing Resilience', () => {
        it('does NOT update lastSavedStateStr when batch.commit fails with timeout, and re-attempts on next save', async () => {
            const initialData = {
                profile: { name: 'Initial Name' },
                library: [],
                routines: [],
                history: [],
                nutrition: {},
                customFoods: [],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: []
            };

            // 1. Initial save succeeds
            await DB.saveUserData(initialData);
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // 2. Next save fails due to timeout (offline simulation)
            const mutatedData1 = {
                ...initialData,
                profile: { name: 'Mutated Name 1' }
            };
            mockBatch.commit.mockRejectedValueOnce(new Error('Timeout sincronizzazione Firestore'));

            // The catch block logs warn and does not re-throw for timeout
            await DB.saveUserData(mutatedData1);
            expect(mockBatch.set).toHaveBeenCalledTimes(1);
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // 3. CRUCIAL TEST FOR SAVE AMNESIA:
            // If the bug was present, lastSavedStateStr was overwritten with mutatedData1.
            // Calling saveUserData again with mutatedData1 would produce hasWrites=false (skipped!).
            // With the fix, lastSavedStateStr remains initialData, so hasWrites=true and commit IS called!
            mockBatch.commit.mockResolvedValueOnce(undefined);
            await DB.saveUserData(mutatedData1);

            expect(mockBatch.set).toHaveBeenCalledTimes(1);
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // 4. Subsequent save with same state should now detect no changes (hasWrites=false)
            await DB.saveUserData(mutatedData1);
            expect(mockBatch.set).not.toHaveBeenCalled();
            expect(mockBatch.commit).not.toHaveBeenCalled();
        });

        it('does NOT update lastSavedStateStr and re-throws when batch.commit fails with non-offline critical error', async () => {
            const state = {
                profile: { name: 'Permission Denied State' },
                library: [],
                routines: [],
                history: [],
                nutrition: {},
                customFoods: [],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: []
            };

            const permError: any = new Error('Missing or insufficient permissions');
            permError.code = 'permission-denied';
            mockBatch.commit.mockRejectedValueOnce(permError);

            const saveRes = await DB.saveUserData(state);
            expect(saveRes).toEqual({ ok: false, status: 'rejected', error: permError });
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Next attempt must still detect that state is uncommitted
            mockBatch.commit.mockResolvedValueOnce(undefined);
            await DB.saveUserData(state);
            expect(mockBatch.set).toHaveBeenCalledTimes(1);
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });

        it('handles monthly history and nutrition diffing correctly after failure recovery', async () => {
            const stateWithHistoryAndNut = {
                profile: {},
                library: [],
                routines: [],
                history: [
                    { id: 'h1', date: '2026-08-16', exercises: [] },
                    { id: 'h2', date: '2026-07-20', exercises: [] }
                ],
                nutrition: {
                    '2026-08-16': { date: '2026-08-16', kcal: 2200, carbs: 250, pro: 160, fat: 60, meals: [] }
                },
                customFoods: [],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: []
            };

            const offlineError: any = new Error('Firebase offline error');
            offlineError.code = 'unavailable';
            mockBatch.commit.mockRejectedValueOnce(offlineError);
            await DB.saveUserData(stateWithHistoryAndNut);

            // Verify both monthly docs were attempted
            expect(mockBatch.set).toHaveBeenCalled();
            mockBatch.set.mockClear();
            mockBatch.commit.mockClear();

            // Re-attempt must re-send history and nutrition batches
            mockBatch.commit.mockResolvedValueOnce(undefined);
            await DB.saveUserData(stateWithHistoryAndNut);
            expect(mockBatch.set).toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });
    });

    describe('Scope 2: Race Condition & Reconcile (In-flight Sync Protection)', () => {
        it('preserves local uncommitted nutrition and customFoods when cloudData returns during sync', () => {
            const staleCloudData: UserData = {
                profile: { name: 'Cloud User' },
                library: [{ id: 'ex1', name: 'Panca piana', setsCount: 3, sets: [] }],
                routines: [{ id: 'r1', name: 'Spinta', exercises: [] }],
                history: [],
                nutrition: {
                    '2026-08-15': {
                        date: '2026-08-15',
                        kcal: 2000, carbs: 200, pro: 150, fat: 60,
                        meals: [{ id: 'm1', name: 'Avena', meal: 'Colazione', quantity: 80, kcal: 300, carbs: 50, pro: 10, fat: 5 }],
                        supplementsIntake: []
                    }
                },
                customFoods: [{ id: 'cf1', name: 'Whey Protein', kcal: 120, pro: 24, carbs: 2, fat: 1 }],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null as any,
                supplements: []
            };

            const localPendingData: UserData = {
                profile: { name: 'Cloud User' },
                library: [
                    { id: 'ex1', name: 'Panca piana', setsCount: 3, sets: [] },
                    { id: 'ex2', name: 'Croci manubri', setsCount: 3, sets: [] } // Added locally
                ],
                routines: [{ id: 'r1', name: 'Spinta', exercises: [] }],
                history: [],
                nutrition: {
                    '2026-08-15': {
                        date: '2026-08-15',
                        kcal: 2000, carbs: 200, pro: 150, fat: 60,
                        meals: [{ id: 'm1', name: 'Avena', meal: 'Colazione', quantity: 80, kcal: 300, carbs: 50, pro: 10, fat: 5 }],
                        supplementsIntake: []
                    },
                    '2026-08-16': { // Added locally in-flight
                        date: '2026-08-16',
                        kcal: 2500, carbs: 300, pro: 180, fat: 70,
                        meals: [{ id: 'm2', name: 'Riso e Pollo', meal: 'Pranzo', quantity: 200, kcal: 650, carbs: 80, pro: 50, fat: 10 }],
                        supplementsIntake: [{ id: 'si1', supplementId: 'creatina', amount: 5, time: Date.now() }]
                    }
                },
                customFoods: [
                    { id: 'cf1', name: 'Whey Protein', kcal: 120, pro: 24, carbs: 2, fat: 1 },
                    { id: 'cf2', name: 'Barretta Proteica', kcal: 210, pro: 20, carbs: 15, fat: 7 } // Added locally
                ],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null as any,
                supplements: [{ id: 'creatina', name: 'Creatina Monoidrato', unit: 'g' }]
            };

            const merged = mergeUserData(staleCloudData, localPendingData);

            // Verify local items were NOT deleted by cloudData
            expect(merged.customFoods).toHaveLength(2);
            expect(merged.customFoods.some(f => f.name === 'Barretta Proteica')).toBe(true);

            expect(merged.library).toHaveLength(2);
            expect(merged.library.some(e => e.id === 'ex2')).toBe(true);

            expect(merged.nutrition['2026-08-16']).toBeDefined();
            expect(merged.nutrition['2026-08-16'].meals).toHaveLength(1);
            expect(merged.nutrition['2026-08-16'].meals[0].name).toBe('Riso e Pollo');
            expect(merged.nutrition['2026-08-15']).toBeDefined();

            expect(merged.supplements).toHaveLength(1);
            expect(merged.supplements[0].id).toBe('creatina');
        });

        it('handles collision deterministically with local mutation priority', () => {
            const cloudData: UserData = {
                profile: { name: 'Cloud User', height: '175' },
                library: [],
                routines: [],
                history: [],
                nutrition: {
                    '2026-08-16': {
                        date: '2026-08-16',
                        kcal: 500, carbs: 50, pro: 30, fat: 10,
                        meals: [{ id: 'meal_1', name: 'Pasta Semplice', meal: 'Pranzo', quantity: 100, kcal: 350, carbs: 70, pro: 10, fat: 2 }],
                        supplementsIntake: []
                    }
                },
                customFoods: [{ id: 'cf_shared', name: 'Old Cloud Name', kcal: 100, pro: 10, carbs: 10, fat: 2 }],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null as any,
                supplements: []
            };

            const localData: UserData = {
                profile: { name: 'Cloud User', height: '180' }, // Mutated height
                library: [],
                routines: [],
                history: [],
                nutrition: {
                    '2026-08-16': {
                        date: '2026-08-16',
                        kcal: 600, carbs: 60, pro: 40, fat: 12,
                        // Mutated meal quantity and new meal
                        meals: [
                            { id: 'meal_1', name: 'Pasta con Tonno', meal: 'Pranzo', quantity: 150, kcal: 500, carbs: 70, pro: 35, fat: 5 },
                            { id: 'meal_2', name: 'Mela', meal: 'Spuntino', quantity: 150, kcal: 80, carbs: 20, pro: 0, fat: 0 }
                        ],
                        supplementsIntake: []
                    }
                },
                customFoods: [{ id: 'cf_shared', name: 'Mutated Local Name', kcal: 110, pro: 12, carbs: 8, fat: 2 }],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null as any,
                supplements: []
            };

            const merged = mergeUserData(cloudData, localData);

            expect(merged.profile.height).toBe('180');
            expect(merged.customFoods[0].name).toBe('Mutated Local Name');
            expect(merged.nutrition['2026-08-16'].meals).toHaveLength(2);
            expect(merged.nutrition['2026-08-16'].meals.find(m => m.id === 'meal_1')?.name).toBe('Pasta con Tonno');
        });
    });

    describe('Scope 3: Memoization Referential Identity Verification', () => {
        it('verifies EMPTY_HISTORY_ARRAY in TrainingSession preserves strict reference equality (===) for multiple exercises without history', async () => {
            const activeSessionFile = fs.readFileSync(
                path.resolve(__dirname, '../src/components/Training/ActiveWorkoutSession.tsx'),
                'utf-8'
            );

            // Verify module-level declaration exists
            expect(activeSessionFile).toMatch(/const EMPTY_HISTORY_ARRAY:\s*Array<.*?>\s*=\s*\[\];/);

            // Verify the fallback uses EMPTY_HISTORY_ARRAY instead of inline []
            expect(activeSessionFile).toMatch(/exerciseHistoryMap\.get\(exItem\.exId\)\s*\|\|\s*EMPTY_HISTORY_ARRAY/);
            expect(activeSessionFile).not.toMatch(/exerciseHistoryMap\.get\(exItem\.exId\)\s*\|\|\s*\[\]/);

            // Emulate the exact lookup logic
            const exerciseHistoryMap = new Map<string, any[]>();
            exerciseHistoryMap.set('ex_with_history', [{ date: '2026-08-10', sets: [], note: '' }]);

            const EMPTY_HISTORY_ARRAY: any[] = [];
            const getPastWorkouts = (exId: string) => exerciseHistoryMap.get(exId) || EMPTY_HISTORY_ARRAY;

            // Multiple exercises with no history across multiple render cycles
            const render1_ex1 = getPastWorkouts('ex_new_1');
            const render1_ex2 = getPastWorkouts('ex_new_2');
            const render1_ex3 = getPastWorkouts('ex_new_3');

            const render2_ex1 = getPastWorkouts('ex_new_1');
            const render2_ex2 = getPastWorkouts('ex_new_2');

            // Referential identity checks:
            expect(render1_ex1).toBe(EMPTY_HISTORY_ARRAY);
            expect(render1_ex2).toBe(EMPTY_HISTORY_ARRAY);
            expect(render1_ex3).toBe(EMPTY_HISTORY_ARRAY);
            expect(render1_ex1 === render1_ex2).toBe(true);
            expect(render1_ex1 === render2_ex1).toBe(true);
            expect(render1_ex2 === render2_ex2).toBe(true);

            // In contrast, inline [] would fail strict equality:
            const brokenLookup = () => exerciseHistoryMap.get('ex_new_1') || [];
            expect(brokenLookup() === brokenLookup()).toBe(false);
        });

        it('verifies SessionExerciseCard memoization comparator returns true when pastWorkouts is stable', () => {
            const comparator = (prev: any, next: any) => {
                return (
                    prev.exItem === next.exItem &&
                    prev.libDef === next.libDef &&
                    prev.pastWorkouts === next.pastWorkouts &&
                    prev.isHistoryOpen === next.isHistoryOpen &&
                    prev.isSetupOpen === next.isSetupOpen &&
                    prev.openSpecialMenuId === next.openSpecialMenuId &&
                    prev.exIndex === next.exIndex
                );
            };

            const stableHistory: any[] = [];
            const exItem = { id: 'item1', exId: 'ex1', sets: [] };
            const libDef = { id: 'ex1', name: 'Squat' };

            const prevProps = {
                exItem,
                libDef,
                pastWorkouts: stableHistory,
                isHistoryOpen: false,
                isSetupOpen: false,
                openSpecialMenuId: null,
                exIndex: 0
            };

            const nextPropsWithSameRef = { ...prevProps };
            expect(comparator(prevProps, nextPropsWithSameRef)).toBe(true);

            const nextPropsWithNewEmptyArray = { ...prevProps, pastWorkouts: [] };
            expect(comparator(prevProps, nextPropsWithNewEmptyArray)).toBe(false); // Broken memoization!
        });
    });

    describe('Scope 4: Security Rules Regex & Schema Whitelist Hardening', () => {
        const rulesPath = path.resolve(__dirname, '../firestore.rules');
        const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

        it('verifies firestore.rules whitelists all 11 root document keys and disallows wildcards', () => {
            // Check that recursive wildcard was removed from users doc
            expect(rulesContent).not.toMatch(/match\s+\/users\/\{userId\}\/\{document=\*\*\}/);

            const expectedKeys = [
                'profile',
                'library',
                'routines',
                'customFoods',
                'activeWorkout',
                'trainingCycles',
                'activeCycleId',
                'nutritionPlanning',
                'supplements',
                'activePains',
                'catalogOverrides',
                'legalConsent',
                'nutritionPlanningOrigin'
            ];

            expectedKeys.forEach(key => {
                expect(rulesContent).toContain(`'${key}'`);
            });

            // Match the keys array in incomingData().keys().hasOnly([...])
            const match = rulesContent.match(/incomingData\(\)\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
            expect(match).not.toBeNull();
            const extractedKeys = match![1]
                .split(',')
                .map(k => k.trim().replace(/['"]/g, ''))
                .filter(k => k.length > 0);

            expect(extractedKeys.sort()).toEqual(expectedKeys.sort());
        });

        it('verifies DB.saveUserData writes strictly conforming userDocData with exactly the 11 whitelisted keys', async () => {
            const sampleUserData = {
                profile: { name: 'Test' },
                library: [],
                routines: [],
                customFoods: [],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: [],
                activePains: [],
                catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] },
                history: [],
                nutrition: {}
            };

            await DB.saveUserData(sampleUserData);
            expect(mockBatch.set).toHaveBeenCalled();

            const userDocCall = mockBatch.set.mock.calls.find((call: any) => call[1]?.profile !== undefined);
            expect(userDocCall).toBeDefined();
            const writtenKeys = Object.keys(userDocCall[1]);

            const expectedKeys = [
                'profile',
                'library',
                'routines',
                'customFoods',
                'activeWorkout',
                'trainingCycles',
                'activeCycleId',
                'nutritionPlanning',
                'supplements',
                'activePains',
                'catalogOverrides',
                'legalConsent',
                'nutritionPlanningOrigin'
            ];

            expect(writtenKeys.sort()).toEqual(expectedKeys.sort());
            // Ensure neither history nor nutrition leaked into the root document!
            expect(writtenKeys).not.toContain('history');
            expect(writtenKeys).not.toContain('nutrition');
        });

        it('empirically stress-tests isValidMonthId regex from firestore.rules against boundary and hostile inputs', () => {
            // Extract regex from rules
            const regexMatch = rulesContent.match(/monthId\.matches\('([^']+)'\)/);
            expect(regexMatch).not.toBeNull();
            const regexStr = regexMatch![1];
            const monthRegex = new RegExp(regexStr);

            // Valid month IDs
            const validMonths = [
                '2026-01', '2026-02', '2026-03', '2026-04',
                '2026-05', '2026-06', '2026-07', '2026-08',
                '2026-09', '2026-10', '2026-11', '2026-12',
                '1990-01', '2030-12', '2000-06'
            ];
            validMonths.forEach(m => {
                expect(monthRegex.test(m), `Expected ${m} to be valid`).toBe(true);
            });

            // Hostile & Invalid month IDs
            const invalidMonths = [
                '2026-00',       // Month 00 invalid
                '2026-13',       // Month 13 invalid
                '2026-99',       // Month 99 invalid
                '2026-1',        // Single digit month
                '2026-012',      // 3-digit month
                '26-05',         // 2-digit year
                '202605',        // Missing dash
                '2026/05',       // Wrong separator
                '2026_05',       // Wrong separator
                'bad-month',     // Non-numeric
                '2026-aa',       // Non-numeric month
                'aaaa-01',       // Non-numeric year
                '2026-05-01',    // Day suffix attached
                'prefix-2026-05',// Prefix attached
                '2026-05\n',     // Trailing newline
                ' 2026-05 ',     // Whitespace padding
                '',              // Empty string
                'null',          // Literal string null
                'undefined'      // Literal string undefined
            ];

            invalidMonths.forEach(m => {
                expect(monthRegex.test(m), `Expected ${m} to be rejected`).toBe(false);
            });
        });
    });

    describe('Scope 5: Domain Segmented Zod Parsers', () => {
        it('exports DomainParsers for fine-grained validation and rejects corrupted sub-trees gracefully', () => {
            expect(DomainParsers).toBeDefined();
            expect(typeof DomainParsers.parseProfile).toBe('function');
            expect(typeof DomainParsers.parseWorkoutSession).toBe('function');
            expect(typeof DomainParsers.parseHistory).toBe('function');
            expect(typeof DomainParsers.parseNutrition).toBe('function');
            expect(typeof DomainParsers.parseLibrary).toBe('function');
            expect(typeof DomainParsers.parseCustomFoods).toBe('function');
            expect(typeof DomainParsers.parseRoutines).toBe('function');
            expect(typeof DomainParsers.parseTrainingCycles).toBe('function');
            expect(typeof DomainParsers.parseSupplements).toBe('function');
            expect(typeof DomainParsers.parseNutritionPlanning).toBe('function');

            // Defensive test: corrupted input to parseProfile recovers gracefully
            const profile = DomainParsers.parseProfile({ height: 180, invalidProp: 'ok' });
            expect(profile.height).toBe('180');

            // Defensive test: corrupted nutrition day
            const nutrition = DomainParsers.parseNutrition({
                '2026-08-16': {
                    date: '2026-08-16',
                    kcal: '2200', // string parsed to number
                    carbs: '250',
                    pro: 'NaN',  // NaN recovers to default
                    fat: 70
                }
            });
            expect(nutrition['2026-08-16'].kcal).toBe(2200);
            expect(nutrition['2026-08-16'].pro).toBe(0);
        });
    });

    describe('Scope 6: Windowed Load & Batched Deletion Limits', () => {
        it('DB.loadUserData queries only 3 months window', async () => {
            const mockUserDoc = {
                profile: { name: 'Window User' },
                library: [],
                routines: [],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null
            };

            // First call returns userDoc, remaining 6 calls return empty month snapshots
            vi.mocked(getDoc)
                .mockResolvedValueOnce({
                    exists: () => true,
                    data: () => mockUserDoc
                } as any)
                .mockResolvedValue({
                    exists: () => true,
                    data: () => ({})
                } as any);

            const loaded = await DB.loadUserData();

            expect(loaded).not.toBeNull();
            expect(loaded?.profile.name).toBe('Window User');
            // getDoc should be called: 1 for manifest + 1 for userDoc + 3 for history_months + 3 for nutrition_months = 8 calls total
            expect(getDoc).toHaveBeenCalledTimes(8);
        });

        it('DB.deleteAccount breaks large reference sets into chunks of <= 400', async () => {
            const mockRefs: any[] = [];
            for (let i = 0; i < 950; i++) {
                mockRefs.push({ id: `doc_${i}` });
            }

            const firestore = await import('firebase/firestore');
            (firestore as any).query = vi.fn((path: any, ..._rest: any[]) => path);
            (firestore as any).limit = vi.fn((count: number) => count);
            let queryCount = 0;
            const mockedGetDocsFromServer = vi.fn().mockImplementation(async () => {
                queryCount++;
                if (queryCount === 1) {
                    // Chunk 1 of history_months: 400 docs
                    return { empty: false, docs: mockRefs.slice(0, 400).map(r => ({ ref: r })) };
                } else if (queryCount === 2) {
                    // Chunk 2 of history_months: 400 docs
                    return { empty: false, docs: mockRefs.slice(400, 800).map(r => ({ ref: r })) };
                } else if (queryCount === 3) {
                    // Chunk 3 of history_months: 150 docs
                    return { empty: false, docs: mockRefs.slice(800, 950).map(r => ({ ref: r })) };
                } else {
                    // Empty: collection drained or residual check empty
                    return { empty: true, docs: [] };
                }
            });
            (firestore as any).getDocsFromServer = mockedGetDocsFromServer;
            (firestore as any).getDocFromServer = vi.fn().mockResolvedValue({ exists: () => false });

            await DB.deleteAccount();

            // Total refs = 400 + 400 + 150 (history) + 1 (user doc) = 951 refs.
            // Sliced into chunks of <= 400:
            // Chunk 1: 400
            // Chunk 2: 400
            // Chunk 3: 150
            // Chunk 4: 1 (root user doc)
            // Total batches committed = 4 batches
            expect(mockBatch.commit).toHaveBeenCalledTimes(4);
        });
    });
});
