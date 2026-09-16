import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { doc } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import { getSeedCatalog, clearCatalogCache } from '../src/lib/catalog/catalogService';
import {
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    mergeCatalogOverrides,
    extractCustomExercisesAndOverrides,
    extractCustomFoodsAndOverrides
} from '../src/lib/catalog/deltaResolver';
import { mergeUserData } from '../src/lib/merge';
import { useAppStore } from '../src/store/useAppStore';
import { clearSyncTimers } from '../src/store/slices/createSyncSlice';
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
    // 5.4: EXTREME OVERRIDE STRUCTURES & CORRUPTED USER PAYLOADS (FUZZING)
    // =========================================================================
    describe('5.4: Extreme Override Structures & Corrupted User Payloads (Fuzzing & Defensive Boundaries)', () => {

        it('T5.4.1: Adversarial override map injection (__proto__, constructor, NaN, Infinity, negative values) is sanitized defensively', () => {
            // Local fixture (seed is empty — commit e61a133)
            const globalExFixture: import('../src/types').CatalogExercise[] = [
                { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 4 },
                { id: 'squat-bilanciere', name: 'Squat Bilanciere', muscles: ['quads'], trackingType: 'weight_reps', isDefault: true, setsCount: 4 }
            ];
            const globalFoodFixture: import('../src/types').CatalogFood[] = [
                { id: 'petto-di-pollo-crudo', name: 'Petto di pollo crudo', kcal: 106, pro: 22.5, carbs: 0, fat: 1.9, isCustom: false },
                { id: 'petto-di-tacchino-crudo', name: 'Petto di tacchino crudo', kcal: 104, pro: 22.0, carbs: 0, fat: 1.5, isCustom: false }
            ];

            const hostileOverrides: any = {
                exercises: {
                    '__proto__': { admin: true },
                    'constructor': { name: 'Constructor Hijack' },
                    'panca-piana-bilanciere': {
                        name: 'Overridden Bench',
                        equipmentWeight: NaN,
                        notes: 'Valid note',
                        muscles: ['chest', null, undefined, 12345]
                    }
                },
                foods: {
                    'petto-di-pollo-crudo': {
                        kcal: -50, // negative kcal
                        pro: Infinity, // Infinity
                        carbs: 'invalid_string' as any,
                        fat: null as any
                    }
                },
                hiddenExerciseIds: ['squat-bilanciere', null, undefined, '', 'squat-bilanciere', '__proto__'],
                hiddenFoodIds: ['petto-di-tacchino-crudo', 123, null, 'petto-di-tacchino-crudo']
            };

            // Resolution must not throw
            expect(() => resolveEffectiveExercises(globalExFixture, [], hostileOverrides)).not.toThrow();
            expect(() => resolveEffectiveFoods(globalFoodFixture, [], hostileOverrides)).not.toThrow();

            const resolvedEx = resolveEffectiveExercises(globalExFixture, [], hostileOverrides);
            const bench = resolvedEx.find(e => e.id === 'panca-piana-bilanciere')!;
            expect(bench.notes).toBe('Valid note');
            expect(bench.name).toBe('Overridden Bench');

            // Hidden items deduplicated and filtered
            expect(resolvedEx.find(e => e.id === 'squat-bilanciere')).toBeUndefined();

            const resolvedFoods = resolveEffectiveFoods(globalFoodFixture, [], hostileOverrides);
            expect(resolvedFoods.find(f => f.id === 'petto-di-tacchino-crudo')).toBeUndefined();

            // Symmetrical merge of hostile overrides
            expect(() => mergeCatalogOverrides(hostileOverrides, {})).not.toThrow();
            const merged = mergeCatalogOverrides(hostileOverrides, {});
            expect((merged as any).admin).toBeUndefined();
            expect(({} as any).admin).toBeUndefined();
        });

        it('T5.4.2: Hostile/corrupted UserData objects in mergeUserData run cleanly through UserDataSchema', () => {
            const corruptedCloud: any = {
                profile: 'not an object',
                library: 'invalid_array',
                routines: 99999,
                history: [null, undefined, { id: 'h1', date: '2026-08-23' }],
                nutrition: 'not a record',
                customFoods: false,
                catalogOverrides: 'corrupted'
            };

            const corruptedGuest: any = {
                profile: { name: 12345, weight: 'invalid_weight' },
                library: [{ id: 'valid_guest_ex', name: 'Guest Ex', setsCount: 3, sets: [] }, null],
                customFoods: [{ id: 'valid_guest_food', name: 'Guest Food', kcal: 100, pro: 10, carbs: 10, fat: 2, isCustom: true }, undefined],
                routines: null,
                activeWorkout: 'invalid_workout',
                trainingCycles: 'corrupted_cycles'
            };

            expect(() => mergeUserData(corruptedCloud, corruptedGuest)).not.toThrow();
            const merged = mergeUserData(corruptedCloud, corruptedGuest);

            expect(Array.isArray(merged.library)).toBe(true);
            expect(Array.isArray(merged.customFoods)).toBe(true);
            expect(Array.isArray(merged.routines)).toBe(true);
            expect(Array.isArray(merged.history)).toBe(true);
            expect(typeof merged.nutrition).toBe('object');
            expect(merged.library?.find(e => e.id === 'valid_guest_ex')).toBeDefined();
            expect(merged.customFoods?.find(f => f.id === 'valid_guest_food')).toBeDefined();
        });

        it('T5.4.3: Legacy migration fuzzing handles null items, missing IDs, duplicate IDs and invalid flags', () => {
            const seed = getSeedCatalog();

            const hostileLegacyEx: any[] = [
                null,
                undefined,
                {},
                { id: '' },
                { id: 'panca-piana-bilanciere', name: 'Panca Modificata', isDefault: true },
                { id: 'custom_1', name: 'Custom One', isDefault: undefined },
                { id: 'custom_2', name: 'Custom Two', isDefault: false },
                { id: 'panca-piana-bilanciere', name: 'Duplicate Bench Override' }
            ];

            expect(() => extractCustomExercisesAndOverrides(hostileLegacyEx, seed.exercises)).not.toThrow();
            const { customExercises, overrides } = extractCustomExercisesAndOverrides(hostileLegacyEx, seed.exercises);

            expect(Array.isArray(customExercises)).toBe(true);
            expect(overrides.exercises).toBeDefined();
            expect(Array.isArray(overrides.hiddenExerciseIds)).toBe(true);

            const hostileLegacyFoods: any[] = [
                null,
                undefined,
                { id: null },
                { id: 'petto-di-pollo-crudo', pro: 26, isCustom: false },
                { id: 'custom_food_1', name: 'Custom Food 1', isCustom: true },
                { id: 99999, name: 'Numeric Custom Food' }
            ];

            expect(() => extractCustomFoodsAndOverrides(hostileLegacyFoods, seed.foods)).not.toThrow();
            const foodResult = extractCustomFoodsAndOverrides(hostileLegacyFoods, seed.foods);
            expect(Array.isArray(foodResult.customFoods)).toBe(true);
            expect(foodResult.overrides.foods).toBeDefined();
        });
    });
});
