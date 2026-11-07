import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { doc, writeBatch } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { ConsentedTestDB as DB, openTestCloudBusiness } from './testUtils';
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
        await prepareUnlockedTestArchive('user:test-user-id');
    });

    afterEach(() => {
        clearSyncTimers();
    });

    // =========================================================================
    // 5.3: CONSENTED ACCOUNT SNAPSHOT -> ENCRYPTED FIRESTORE PAYLOAD INSPECTION
    // =========================================================================
    describe('5.3: Consented account stress-save and encrypted Firestore payload inspection', () => {

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
            let capturedSealedUserDoc: unknown = null;
            const capturedHistoryMonthWrites: Record<string, any> = {};
            const capturedNutritionMonthWrites: Record<string, any> = {};

            const mockBatch = {
                set: vi.fn((ref: any, data: any) => {
                    // Inspect ref path to know destination
                    if (String(ref) === 'users/test-user-id' && data?._sealed) {
                        capturedSealedUserDoc = data;
                        capturedUserDocWrite = openTestCloudBusiness(data);
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

            // 4. Generate 200 history sessions across 10 months (2026-01 to 2026-10)
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
                            id: `se_${i}_1`,
                            exId: `stress_custom_ex_${i % 100}`,
                            sessionNote: 'Good session',
                            sets: [{ id: `s_${i}_1`, kg: '80', reps: '10', done: true }]
                        }
                    ]
                };
            });

            // 5. Generate 180 DISTINCT nutrition days across 6 months (2026-03 to 2026-08).
            // The old modulo-based fixture silently overwrote dates, exercising only 84 days.
            const nutrition: Record<string, NutritionDay> = {};
            const nutritionStart = Date.UTC(2026, 2, 1);
            for (let i = 0; i < 180; i++) {
                const dateKey = new Date(nutritionStart + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

            expect(Object.keys(nutrition)).toHaveLength(180);

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
                profile: { height: '185', gender: 'M' },
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

            const result = await DB.saveUserData(massiveState);

            expect(result).toMatchObject({ ok: true, status: 'synced' });
            expect(mockBatch.commit).toHaveBeenCalled();
            expect(capturedUserDocWrite).not.toBeNull();
            expect(capturedSealedUserDoc).not.toBeNull();

            // CRITICAL TEST 1: Library in user doc has length 100 (strictly custom), ZERO seed items!
            expect(capturedUserDocWrite.library).toHaveLength(100);
            expect(capturedUserDocWrite.library.every((e: any) => e.isDefault === false)).toBe(true);
            expect(new Set(capturedUserDocWrite.library.map((e: Exercise) => e.id)))
                .toEqual(new Set(customExercises.map(exercise => exercise.id)));

            // CRITICAL TEST 2: CustomFoods in user doc has length 100 (strictly custom), ZERO seed items!
            expect(capturedUserDocWrite.customFoods).toHaveLength(100);
            expect(capturedUserDocWrite.customFoods.every((f: any) => f.isCustom === true)).toBe(true);
            expect(new Set(capturedUserDocWrite.customFoods.map((food: Food) => food.id)))
                .toEqual(new Set(customFoods.map(food => food.id)));

            // All monthly shards must be delivered. Checking only the root would let
            // the test pass after silently losing the 200 workouts or 180 food days.
            const openCapturedMonths = (writes: Record<string, unknown>) =>
                Object.entries(writes).map(([ref, sealed]) => openTestCloudBusiness(
                    sealed, ref.slice('users/test-user-id/'.length),
                ));
            const historyMonths = openCapturedMonths(capturedHistoryMonthWrites);
            const nutritionMonths = openCapturedMonths(capturedNutritionMonthWrites);
            expect(historyMonths).toHaveLength(10);
            expect(nutritionMonths).toHaveLength(6);
            const historyIds = historyMonths.flatMap(month => Object.values(month).map(workout => workout.id));
            const nutritionDates = nutritionMonths.flatMap(month => Object.keys(month));
            expect(historyIds).toHaveLength(200);
            expect(new Set(historyIds).size).toBe(200);
            expect(nutritionDates.sort()).toEqual(Object.keys(nutrition).sort());

            // Counts and IDs alone miss corruption or omission of nested training sets
            // and meal entries. Inspect the decrypted business values of every sealed month.
            const savedHistory = Object.assign({}, ...historyMonths) as Record<string, WorkoutSession>;
            for (const session of history) {
                const saved = savedHistory[session.id];
                expect(saved).toMatchObject({
                    id: session.id,
                    date: session.date,
                    exercises: [{
                        id: session.exercises[0].id,
                        exId: session.exercises[0].exId,
                        sets: [{ id: session.exercises[0].sets[0].id, kg: '80', reps: '10', done: true }],
                    }],
                });
                expect(saved.exercises).toHaveLength(1);
                expect(saved.exercises[0].sets).toHaveLength(1);
            }
            const savedNutrition = Object.assign({}, ...nutritionMonths) as Record<string, NutritionDay>;
            for (const [date, day] of Object.entries(nutrition)) {
                const saved = savedNutrition[date];
                expect(saved).toMatchObject({
                    date,
                    kcal: day.kcal,
                    pro: day.pro,
                    carbs: day.carbs,
                    fat: day.fat,
                    meals: [{ id: day.meals![0].id, name: 'Meal 1', quantity: 100,
                        kcal: 500, pro: 40, carbs: 50, fat: 15 }],
                });
                expect(saved.meals).toHaveLength(1);
                expect(Number(saved.weight)).toBeCloseTo(Number(day.weight));
            }

            // The Firestore size limit applies to each ciphertext shard, not just the root.
            for (const [path, sealed] of [
                ...Object.entries(capturedHistoryMonthWrites),
                ...Object.entries(capturedNutritionMonthWrites),
            ]) {
                expect(calculateDocSizeBytes(sealed)).toBeLessThanOrEqual(DOC_SIZE_LIMIT_BYTES);
                expect(() => checkDocSize(sealed, path)).not.toThrow();
            }

            // Check the actual encrypted Firestore document including _sync metadata,
            // not its smaller decrypted business projection.
            const userDocPayloadBytes = calculateDocSizeBytes(capturedSealedUserDoc);
            expect(userDocPayloadBytes).toBeLessThan(DOC_SIZE_LIMIT_BYTES * 0.20);
            expect(() => checkDocSize(capturedSealedUserDoc, "User Profile")).not.toThrow();
        });

        it('T5.3.2: Empty bundled seed state serializes empty custom collections into a small sealed root', async () => {
            const seed = getSeedCatalog();
            await saveCatalogToCache(seed);

            let capturedUserDocWrite: any = null;
            let capturedSealedUserDoc: unknown = null;
            const mockBatch = {
                set: vi.fn((_ref: any, data: any) => {
                    if (String(_ref) === 'users/test-user-id' && data?._sealed) {
                        capturedSealedUserDoc = data;
                        capturedUserDocWrite = openTestCloudBusiness(data);
                    }
                }),
                delete: vi.fn(),
                commit: vi.fn().mockResolvedValue(undefined)
            };
            vi.mocked(writeBatch).mockReturnValue(mockBatch as any);

            const cleanState: UserData = {
                profile: { height: '180' },
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

            const result = await DB.saveUserData(cleanState);

            expect(result).toMatchObject({ ok: true, status: 'synced' });
            expect(capturedUserDocWrite).not.toBeNull();
            expect(capturedUserDocWrite.library).toEqual([]);
            expect(capturedUserDocWrite.customFoods).toEqual([]);
            expect(capturedSealedUserDoc).not.toBeNull();
            expect(calculateDocSizeBytes(capturedSealedUserDoc)).toBeLessThan(10000);
            expect(() => checkDocSize(capturedSealedUserDoc, 'User Profile')).not.toThrow();
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
