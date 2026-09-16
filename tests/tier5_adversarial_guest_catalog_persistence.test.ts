import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { doc, writeBatch } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import { getSeedCatalog, saveCatalogToCache, clearCatalogCache } from '../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../src/lib/catalog/deltaResolver';
import { checkDocSize, calculateDocSizeBytes, DOC_SIZE_LIMIT_BYTES } from '../src/lib/checkDocSize';
import { useAppStore } from '../src/store/useAppStore';
import { clearSyncTimers } from '../src/store/slices/createSyncSlice';
import type {
    UserData,
    Exercise,
    Food,
    CatalogOverrides,
    WorkoutSession,
    WorkoutRoutine,
    NutritionDay,
} from '../src/types';
import { idbStore } from './setup';

vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: { uid: 'test-user-id', email: 'test@example.com' },
        signOut: vi.fn().mockResolvedValue(undefined),
    },
    db: { type: 'firestore_mock' },
    getDb: vi.fn().mockReturnValue({}),
    ensureAppCheck: vi.fn().mockResolvedValue(undefined),
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    isAppCheckFallbackOffline: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/lib/sync/session', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/sync/session')>('../src/lib/sync/session');
    return {
        ...actual,
        storageOwner: () => {
            let guest = false;
            try { guest = localStorage.getItem('logbook_is_guest') === 'true'; } catch {}
            return !guest ? 'user:test-user-id' : 'guest';
        }
    };
});

describe('Tier 5: Adversarial Coverage Hardening Suite', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        clearSyncTimers();
        localStorage.clear();
        for (const k in idbStore) delete idbStore[k];
        if (typeof window !== 'undefined') {
            window.__INITIAL_USER_DATA__ = null;
        }
        vi.mocked(doc).mockImplementation((_db: any, ...parts: string[]) => ({
            path: parts.join('/'),
            toString: () => parts.join('/')
        } as any));
        await clearCatalogCache();
        DB.resetCache();
        useAppStore.getState().resetStore();
    });

    afterEach(() => {
        clearSyncTimers();
    });

    // =========================================================================
    // 5.3: OFFLINE GUEST PERSISTENCE -> FIRESTORE PAYLOAD INSPECTION
    // =========================================================================
    describe('5.3: Offline Guest Persistence -> Firestore Payload Inspection (Zero Seed Duplication & Strict Doc Size Bounds)', () => {

        it('T5.3.1: Massive user data stress (100 custom exercises, 100 custom foods, 50 routines, 200 history sessions, 180 nutrition days, 50 overrides) strictly excludes seed items and satisfies Firestore size limits', async () => {
            // Generate standard seed catalog fixture explicitly
            const fixtureExercises: import('../src/types').CatalogExercise[] = Array.from({ length: 176 }, (_, i) => ({
                id: `std_exercise_${i}`,
                name: `Standard Exercise ${i}`,
                muscles: ['chest'],
                trackingType: 'weight_reps',
                isDefault: true,
                setsCount: 3
            }));
            const fixtureFoods: import('../src/types').CatalogFood[] = Array.from({ length: 130 }, (_, i) => ({
                id: `std_food_${i}`,
                name: `Standard Food ${i}`,
                kcal: 100 + i,
                pro: 10,
                carbs: 10,
                fat: 5,
                isCustom: false,
                baseQty: 100,
                unit: 'g'
            }));
            const seed = { manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' } }, exercises: fixtureExercises, foods: fixtureFoods };
            await saveCatalogToCache(seed as any);

            let capturedUserDocWrite: any = null;
            const capturedHistoryMonthWrites: Record<string, any> = {};
            const capturedNutritionMonthWrites: Record<string, any> = {};

            const mockBatch = {
                set: vi.fn((ref: any, data: any) => {
                    // Inspect ref path to know destination
                    if (data.profile !== undefined) {
                        capturedUserDocWrite = data;
                    } else if (ref && String(ref).includes('history_months')) {
                        capturedHistoryMonthWrites[String(ref)] = data;
                    } else if (ref && String(ref).includes('nutrition_months')) {
                        capturedNutritionMonthWrites[String(ref)] = data;
                    }
                }),
                delete: vi.fn(),
                commit: vi.fn().mockResolvedValue(undefined)
            };
            vi.mocked(writeBatch).mockReturnValue(mockBatch as any);

            // 1. Generate 100 custom exercises
            const customExercises: Exercise[] = Array.from({ length: 100 }, (_, i) => ({
                id: `stress_custom_ex_${i}`,
                name: `Custom Exercise ${i}`,
                setsCount: 4,
                sets: [],
                muscles: ['chest', 'triceps'],
                isDefault: false
            }));

            // 2. Generate 100 custom foods
            const customFoods: Food[] = Array.from({ length: 100 }, (_, i) => ({
                id: `stress_custom_food_${i}`,
                name: `Custom Food ${i}`,
                kcal: 200 + i,
                pro: 20,
                carbs: 20,
                fat: 5,
                isCustom: true
            }));

            // 3. Generate 50 routines
            const routines: WorkoutRoutine[] = Array.from({ length: 50 }, (_, i) => ({
                id: `stress_routine_${i}`,
                name: `Routine ${i}`,
                exercises: [{ exId: `stress_custom_ex_${i % 100}`, setsCount: 3 }]
            }));

            // 4. Generate 200 history sessions across 10 months (2025-11 to 2026-08)
            const history: WorkoutSession[] = Array.from({ length: 200 }, (_, i) => {
                const monthNum = (i % 10) + 1;
                const monthStr = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
                const dayNum = (i % 28) + 1;
                const dayStr = dayNum < 10 ? `0${dayNum}` : `${dayNum}`;
                return {
                    id: `stress_session_${i}`,
                    date: `2026-${monthStr}-${dayStr}`,
                    routineName: `Routine ${i % 50}`,
                    exercises: [
                        {
                            exId: `stress_custom_ex_${i % 100}`,
                            sessionNote: 'Good session',
                            sets: [{ id: `s_${i}_1`, kg: '80', reps: '10', done: true }]
                        }
                    ]
                };
            });

            // 5. Generate 180 nutrition days across 6 months (2026-03 to 2026-08)
            const nutrition: Record<string, NutritionDay> = {};
            for (let i = 0; i < 180; i++) {
                const monthNum = (i % 6) + 3; // 3 to 8
                const monthStr = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
                const dayNum = (i % 28) + 1;
                const dayStr = dayNum < 10 ? `0${dayNum}` : `${dayNum}`;
                const dateKey = `2026-${monthStr}-${dayStr}`;
                nutrition[dateKey] = {
                    date: dateKey,
                    kcal: 2200 + (i % 300),
                    pro: 150 + (i % 30),
                    carbs: 250 + (i % 50),
                    fat: 60 + (i % 15),
                    weight: String(75 + (i % 5) * 0.2),
                    meals: [
                        { id: `m_${i}_1`, name: 'Meal 1', meal: 'pranzo', quantity: 100, kcal: 500, pro: 40, carbs: 50, fat: 15 }
                    ]
                };
            }

            // 6. Generate 50 overrides
            const exerciseOverrides: Record<string, any> = {};
            for (let i = 0; i < 50; i++) {
                const baseEx = seed.exercises[i % seed.exercises.length];
                exerciseOverrides[baseEx.id] = { notes: `Override note for ${baseEx.name}` };
            }
            const hiddenExerciseIds = seed.exercises.slice(50, 75).map(e => e.id);

            const catalogOverrides: CatalogOverrides = {
                exercises: exerciseOverrides,
                hiddenExerciseIds
            };

            // Full resolved lists passed to save (containing all 176+ seed items + 100 custom items)
            const fullLibrary = resolveEffectiveExercises(seed.exercises, customExercises, catalogOverrides);
            const fullFoods = resolveEffectiveFoods(seed.foods, customFoods, catalogOverrides);

            expect(fullLibrary.length).toBeGreaterThanOrEqual(200);
            expect(fullFoods.length).toBeGreaterThanOrEqual(200);

            const massiveState: UserData = {
                profile: { name: 'Stress Beast Athlete', height: '185', gender: 'M' },
                library: fullLibrary,
                customFoods: fullFoods,
                catalogOverrides,
                routines,
                history,
                nutrition,
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            await DB.saveUserData(massiveState);

            expect(mockBatch.commit).toHaveBeenCalled();
            expect(capturedUserDocWrite).not.toBeNull();

            // CRITICAL TEST 1: Library in user doc has length 100 (strictly custom), ZERO seed items!
            expect(capturedUserDocWrite.library).toHaveLength(100);
            expect(capturedUserDocWrite.library.every((e: any) => e.isDefault === false)).toBe(true);

            // CRITICAL TEST 2: CustomFoods in user doc has length 100 (strictly custom), ZERO seed items!
            expect(capturedUserDocWrite.customFoods).toHaveLength(100);
            expect(capturedUserDocWrite.customFoods.every((f: any) => f.isCustom === true)).toBe(true);

            // CRITICAL TEST 3: V3 includes causal _sync metadata; keep this stress payload below 20% of the production safety ceiling.
            const userDocPayloadBytes = calculateDocSizeBytes(capturedUserDocWrite);
            expect(userDocPayloadBytes).toBeLessThan(DOC_SIZE_LIMIT_BYTES * 0.20);
            expect(() => checkDocSize(capturedUserDocWrite, "User Profile")).not.toThrow();
        });

        it('T5.3.2: Clean seed state (176 exercises and 130 foods resolved with 0 custom items) serializes empty arrays and tiny doc payload', async () => {
            const seed = getSeedCatalog();
            await saveCatalogToCache(seed);

            let capturedUserDocWrite: any = null;
            const mockBatch = {
                set: vi.fn((_ref: any, data: any) => {
                    if (data.profile !== undefined) capturedUserDocWrite = data;
                }),
                delete: vi.fn(),
                commit: vi.fn().mockResolvedValue(undefined)
            };
            vi.mocked(writeBatch).mockReturnValue(mockBatch as any);

            const cleanState: UserData = {
                profile: { name: 'Zero Custom User' },
                library: resolveEffectiveExercises(seed.exercises),
                customFoods: resolveEffectiveFoods(seed.foods),
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            await DB.saveUserData(cleanState);

            expect(capturedUserDocWrite).not.toBeNull();
            expect(capturedUserDocWrite.library).toEqual([]);
            expect(capturedUserDocWrite.customFoods).toEqual([]);
            expect(JSON.stringify(capturedUserDocWrite).length).toBeLessThan(10000); // Less than 10KB!
        });

        it('T5.3.3: checkDocSize throws Error if serialized document size exceeds 950KB and passes for normal payloads', () => {
            const smallDoc = { name: 'Mario', count: 42 };
            expect(() => checkDocSize(smallDoc, "Test Small")).not.toThrow();

            // Construct payload larger than 950KB (950 * 1024 = 972,800 bytes)
            const largeString = 'a'.repeat(975000);
            const hugeDoc = { data: largeString };

            expect(() => checkDocSize(hugeDoc, "Test Huge")).toThrow(/supera il limite.*di sicurezza/);
        });
    });
});
