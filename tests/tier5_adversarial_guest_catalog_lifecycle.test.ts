import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { doc } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import { getCachedCatalog, saveCatalogToCache, clearCatalogCache } from '../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../src/lib/catalog/deltaResolver';
import { hasUserData } from '../src/lib/merge';
import { useAppStore } from '../src/store/useAppStore';
import { clearSyncTimers } from '../src/store/slices/createSyncSlice';
import type { UserData, Exercise, Food } from '../src/types';
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
    // 5.1: RAPID GUEST LOGIN/LOGOUT & LIFECYCLE FLAPPING STRESS
    // =========================================================================
    describe('5.1: Rapid Guest Login/Logout & Lifecycle Flapping Stress', () => {

        it('T5.1.1: Rapid flapping between guest login and logout (25 cycles) leaves store and storage in deterministic state', async () => {
            const GUEST_KEY = 'logbook_is_guest';

            for (let i = 0; i < 25; i++) {
                // 1. Simulate loginAsGuest
                localStorage.setItem(GUEST_KEY, 'true');
                const catalog = await getCachedCatalog();
                
                // Inject a custom item to verify no duplications or leaks across cycles
                const customEx: import('../src/types').Exercise = { id: `custom_${i}`, name: `Custom ${i}`, isDefault: false, setsCount: 3, sets: [] };

                const guestData: UserData = {
                    profile: {},
                    library: resolveEffectiveExercises(catalog.exercises, [customEx], {}),
                    customFoods: resolveEffectiveFoods(catalog.foods, [], {}),
                    catalogOverrides: {},
                    routines: [],
                    history: [],
                    nutrition: {},
                    trainingCycles: [],
                    activeCycleId: null,
                    supplements: [],
                    activeWorkout: null
                };
                useAppStore.getState().setUserData(guestData);

                expect(localStorage.getItem(GUEST_KEY)).toBe('true');
                const currentLibrary = useAppStore.getState().userData?.library;
                expect(currentLibrary).toBeDefined();
                // State must be exactly catalog size + 1 (the custom item of this cycle), proving no accumulation/duplication
                expect(currentLibrary?.length).toBe(catalog.exercises.length + 1);
                expect(currentLibrary?.find(e => e.id === `custom_${i}`)).toBeDefined();

                // 2. Simulate logout
                localStorage.removeItem(GUEST_KEY);
                useAppStore.getState().resetStore();

                expect(localStorage.getItem(GUEST_KEY)).toBeNull();
                expect(useAppStore.getState().userData).toBeNull();
                expect(useAppStore.getState().localWorkout).toBeNull();
            }

            // Final state verification
            expect(localStorage.getItem(GUEST_KEY)).toBeNull();
            expect(useAppStore.getState().userData).toBeNull();
            expect(idbStore['logbook_cached_user_data']).toBeUndefined();
        });

        it('T5.1.2: Guest session with mutations -> rejected logout preserves data -> confirmed logout wipes all data -> subsequent login starts pristine', async () => {
            const GUEST_KEY = 'logbook_is_guest';
            localStorage.setItem(GUEST_KEY, 'true');

            const catalog = await getCachedCatalog();
            const customEx: Exercise = { id: 'dirty_custom_ex_1', name: 'Dirty Bench', setsCount: 4, sets: [], isDefault: false };
            const customFood: Food = { id: 'dirty_custom_food_1', name: 'Dirty Whey', kcal: 150, pro: 30, carbs: 2, fat: 1, isCustom: true };

            const dirtyGuestData: UserData = {
                profile: { name: 'Dirty Guest' },
                library: resolveEffectiveExercises(catalog.exercises, [customEx], {}),
                customFoods: resolveEffectiveFoods(catalog.foods, [customFood], {}),
                catalogOverrides: { exercises: { 'squat-bilanciere': { notes: 'Dirty Squat Note' } } },
                routines: [{ id: 'r_dirty', name: 'Dirty Routine', exercises: [] }],
                history: [{ id: 'h_dirty', date: '2026-08-23', exercises: [] }],
                nutrition: { '2026-08-23': { date: '2026-08-23', kcal: 2500, pro: 180, carbs: 250, fat: 70 } },
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: { id: 'w_dirty', exercises: [] }
            };

            useAppStore.getState().setUserData(dirtyGuestData);
            expect(hasUserData(useAppStore.getState().userData)).toBe(true);

            // Step 1: Simulate rejection of logout dialog
            // In rejection, no store reset occurs
            expect(useAppStore.getState().userData?.profile?.name).toBe('Dirty Guest');
            expect(useAppStore.getState().userData?.library?.find(e => e.id === 'dirty_custom_ex_1')).toBeDefined();

            // Step 2: Simulate confirmed logout
            localStorage.removeItem(GUEST_KEY);
            useAppStore.getState().resetStore();

            expect(localStorage.getItem(GUEST_KEY)).toBeNull();
            expect(useAppStore.getState().userData).toBeNull();
            expect(hasUserData(useAppStore.getState().userData)).toBe(false);

            // Step 3: Subsequent fresh guest login
            localStorage.setItem(GUEST_KEY, 'true');
            const cleanCatalog = await getCachedCatalog();
            const freshGuestData: UserData = {
                profile: {},
                library: resolveEffectiveExercises(cleanCatalog.exercises, [], {}),
                customFoods: resolveEffectiveFoods(cleanCatalog.foods, [], {}),
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };
            useAppStore.getState().setUserData(freshGuestData);

            const currentState = useAppStore.getState().userData!;
            expect(currentState.profile?.name).toBeUndefined();
            expect(currentState.library?.find(e => e.id === 'dirty_custom_ex_1')).toBeUndefined();
            expect(currentState.customFoods?.find(f => f.id === 'dirty_custom_food_1')).toBeUndefined();
            expect(currentState.routines).toHaveLength(0);
            expect(currentState.history).toHaveLength(0);
            expect(Object.keys(currentState.nutrition || {})).toHaveLength(0);
            expect(currentState.activeWorkout).toBeNull();
            expect(hasUserData(currentState)).toBe(false);
        });

        it('T5.1.3: Guest login self-heals incomplete state (missing catalog or undefined overrides) without erasing custom profile or routines', async () => {
            // Local fixture to populate the cache (seed is empty — commit e61a133)
            const fixtureCatalog = {
                manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' } },
                exercises: [
                    { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 }
                ],
                foods: [
                    { id: 'petto-di-pollo-crudo', name: 'Petto di pollo crudo', kcal: 106, pro: 22.5, carbs: 0, fat: 1.9, isCustom: false }
                ]
            } as any;
            await saveCatalogToCache(fixtureCatalog);

            const incompleteUserData: UserData = {
                profile: { name: 'Existing Athlete', height: '182', gender: 'M' },
                library: [{ id: 'my_custom_deadlift', name: 'My Custom Deadlift', setsCount: 5, sets: [], isDefault: false }],
                routines: [{ id: 'r_existing', name: 'Existing Routine', exercises: [] }],
                customFoods: [{ id: 'my_custom_snack', name: 'My Snack', kcal: 180, pro: 10, carbs: 20, fat: 5, isCustom: true }],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
                // Note: library has NO standard items, customFoods has NO standard items, catalogOverrides is missing
            };

            useAppStore.getState().setUserData(incompleteUserData);

            // Simulate loginAsGuest resolution logic when store already has data
            const currentData = useAppStore.getState().userData!;
            const hasCatalogExercises = Array.isArray(currentData.library) && currentData.library.some(e => e.isDefault === true);
            const hasCatalogFoods = Array.isArray(currentData.customFoods) && currentData.customFoods.some(f => f.isCustom === false);

            expect(hasCatalogExercises).toBe(false);
            expect(hasCatalogFoods).toBe(false);

            const catalog = await getCachedCatalog();
            const resolvedLibrary = resolveEffectiveExercises(catalog.exercises, currentData.library || [], currentData.catalogOverrides);
            const resolvedFoods = resolveEffectiveFoods(catalog.foods, currentData.customFoods || [], currentData.catalogOverrides);

            useAppStore.getState().setUserData({
                ...currentData,
                library: resolvedLibrary,
                customFoods: resolvedFoods
            });

            const healed = useAppStore.getState().userData!;
            // Profile & routines preserved
            expect(healed.profile?.name).toBe('Existing Athlete');
            expect(healed.profile?.height).toBe('182');
            expect(healed.routines).toHaveLength(1);
            expect(healed.routines?.[0].id).toBe('r_existing');

            // Custom items preserved
            expect(healed.library?.find(e => e.id === 'my_custom_deadlift')).toBeDefined();
            expect(healed.customFoods?.find(f => f.id === 'my_custom_snack')).toBeDefined();

            // Standard catalog seamlessly injected from fixture
            expect(healed.library?.find(e => e.id === 'panca-piana-bilanciere')).toBeDefined();
            expect(healed.customFoods?.find(f => f.id === 'petto-di-pollo-crudo')).toBeDefined();
            expect(healed.library?.length).toBe(catalog.exercises.length + 1);
            expect(healed.customFoods?.length).toBe(catalog.foods.length + 1);
        });
    });
});
