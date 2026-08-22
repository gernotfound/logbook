import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock firebase/auth and firebase/app-check for test isolation
vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({})),
    GoogleAuthProvider: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn().mockResolvedValue(null),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
    setPersistence: vi.fn().mockResolvedValue(undefined),
    indexedDBLocalPersistence: {},
    browserLocalPersistence: {},
    deleteUser: vi.fn(),
}));

vi.mock('firebase/app-check', () => {
    class MockReCaptchaV3Provider {
        siteKey: string;
        constructor(siteKey: string) {
            this.siteKey = siteKey;
        }
    }
    return {
        initializeAppCheck: vi.fn((app, options) => ({
            app,
            options
        })),
        ReCaptchaV3Provider: MockReCaptchaV3Provider,
        getToken: vi.fn().mockResolvedValue({
            token: 'mock-app-check-token-12345',
            expireTimeMillis: Date.now() + 3600000
        }),
        isSupported: vi.fn().mockResolvedValue(true)
    };
});

import { 
    checkDocSize, 
    calculateDocSizeBytes, 
    isDocSizeWithinLimit, 
    formatBytes,
    DOC_SIZE_LIMIT_BYTES 
} from '../src/security/checkDocSize';
import {
    initAppCheck,
    isAppCheckSupported,
    isAppCheckActive,
    isAppCheckFallbackOffline,
    setAppCheckFallbackOffline,
    getAppCheckStatus,
    resetAppCheckStateForTesting,
    APP_CHECK_STRINGS
} from '../src/security/appCheck';
import {
    CatalogManifestSchema,
    CatalogExerciseSchema,
    CatalogFoodSchema,
    CatalogOverridesSchema,
    CachedGlobalCatalogSchema,
    type CatalogExercise,
    type CatalogFood,
    type CatalogOverrides
} from '../src/catalog/catalogTypes';
import {
    getSeedCatalog,
    getCachedCatalog,
    saveCatalogToCache,
    clearCatalogCache
} from '../src/catalog/catalogService';
import {
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    createExerciseOverride,
    createFoodOverride,
    hideCatalogExercise,
    unhideCatalogExercise,
    hideCatalogFood,
    unhideCatalogFood,
    applyExerciseOverride,
    applyFoodOverride,
    migrateLegacyLibraryToOverrides,
    migrateLegacyFoodsToOverrides
} from '../src/catalog/deltaResolver';

describe('1. Security: checkDocSize & Payload Guard', () => {
    it('calculates document byte size accurately', () => {
        const smallDoc = { name: "Test User", age: 30 };
        const size = calculateDocSizeBytes(smallDoc);
        expect(size).toBeGreaterThan(0);
        expect(size).toBe(new Blob([JSON.stringify(smallDoc)]).size);
    });

    it('validates document within 950KB safety threshold', () => {
        const payload = { items: Array(100).fill({ id: 'item-1', name: 'Item', val: 123 }) };
        const assessment = isDocSizeWithinLimit(payload, DOC_SIZE_LIMIT_BYTES);
        expect(assessment.valid).toBe(true);
        expect(assessment.sizeBytes).toBeLessThan(DOC_SIZE_LIMIT_BYTES);
        expect(() => checkDocSize(payload, 'users/test-uid')).not.toThrow();
    });

    it('throws descriptive Italian Sentence case Error when payload exceeds limit', () => {
        // Generate payload > 950KB
        const largeString = 'A'.repeat(960000);
        const oversizedDoc = { data: largeString };

        expect(() => checkDocSize(oversizedDoc, 'users/test-uid')).toThrowError(
            /Il documento users\/test-uid supera il limite di dimensione di sicurezza di Firestore/
        );
    });

    it('formats bytes correctly into human readable strings', () => {
        expect(formatBytes(500)).toBe('500 B');
        expect(formatBytes(1500)).toBe('1.5 KB');
        expect(formatBytes(1500000)).toBe('1.43 MB');
    });
});

describe('2. Security: Firebase App Check & Offline Degradation', () => {
    beforeEach(() => {
        resetAppCheckStateForTesting();
        vi.clearAllMocks();
    });

    it('initializes successfully when siteKey is provided and supported', async () => {
        const dummyApp = { name: 'test-app' } as any;
        const result = await initAppCheck(dummyApp, { siteKey: '6Le-test-site-key-1234567890' });

        expect(result.success).toBe(true);
        expect(result.isFallbackOffline).toBe(false);
        expect(isAppCheckActive()).toBe(true);
        expect(isAppCheckFallbackOffline()).toBe(false);
    });

    it('reports offline fallback mode when site key is missing', async () => {
        const dummyApp = {} as any;
        const result = await initAppCheck(dummyApp, { siteKey: '' });

        expect(result.success).toBe(false);
        expect(result.isFallbackOffline).toBe(true);
        expect(isAppCheckFallbackOffline()).toBe(true);
        expect(isAppCheckActive()).toBe(false);
    });

    it('provides localized Italian notification strings in Sentence case', () => {
        expect(APP_CHECK_STRINGS.unsupportedTitle).toBe('Verifica di sicurezza non supportata');
        expect(APP_CHECK_STRINGS.unsupportedMessage).toContain('LogBook continuerà a funzionare regolarmente in modalità locale offline');
    });

    it('allows toggling fallback offline mode for testing', () => {
        expect(isAppCheckFallbackOffline()).toBe(false);
        setAppCheckFallbackOffline(true);
        expect(isAppCheckFallbackOffline()).toBe(true);
        setAppCheckFallbackOffline(false);
        expect(isAppCheckFallbackOffline()).toBe(false);
    });

    it('exposes detailed status telemetry', () => {
        const status = getAppCheckStatus();
        expect(status).toHaveProperty('initialized');
        expect(status).toHaveProperty('fallbackOffline');
        expect(status).toHaveProperty('hasToken');
        expect(status).toHaveProperty('provider');
    });
});

describe('3. Catalog: Types, Schemas & Validation', () => {
    it('validates a valid CatalogManifest', () => {
        const rawManifest = {
            version: '1.2.0',
            updatedAt: '2026-08-22T20:00:00.000Z',
            schemaVersion: 1,
            docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' },
            itemCounts: { exercises: 176, foods: 221 }
        };
        const parsed = CatalogManifestSchema.safeParse(rawManifest);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.version).toBe('1.2.0');
            expect(parsed.data.itemCounts.exercises).toBe(176);
        }
    });

    it('defensively sanitizes corrupt CatalogManifest', () => {
        const corruptManifest = {
            version: null,
            updatedAt: undefined,
            schemaVersion: "invalid",
            docRefs: null
        };
        const parsed = CatalogManifestSchema.safeParse(corruptManifest);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.version).toBe('1.0.0');
            expect(parsed.data.schemaVersion).toBe(1);
            expect(parsed.data.docRefs.exercises).toBe('exercises_v1');
        }
    });

    it('validates CatalogExerciseSchema and CatalogFoodSchema', () => {
        const ex: CatalogExercise = {
            id: 'panca-piana',
            name: 'Panca Piana',
            muscles: ['chest'],
            secondaryMuscles: ['triceps', 'shoulders'],
            trackingType: 'weight_reps',
            isDefault: true
        };
        expect(CatalogExerciseSchema.safeParse(ex).success).toBe(true);

        const food: CatalogFood = {
            id: 'petto-pollo',
            name: 'Petto di Pollo',
            brand: 'Generico',
            kcal: 103,
            pro: 23,
            carbs: 0,
            fat: 1.2
        };
        expect(CatalogFoodSchema.safeParse(food).success).toBe(true);
    });

    it('validates CatalogOverridesSchema with defensive fallback', () => {
        const overrides: CatalogOverrides = {
            exercises: {
                'panca-piana': { notes: 'Focus su arco lombare', equipmentWeight: 20 }
            },
            foods: {
                'petto-pollo': { brand: 'Fileni' }
            },
            hiddenExerciseIds: ['stacco-sumo'],
            hiddenFoodIds: ['12345']
        };
        const parsed = CatalogOverridesSchema.safeParse(overrides);
        expect(parsed.success).toBe(true);
    });
});

describe('4. Catalog: Service & Seed Fallback', () => {
    it('loads the bundled seed catalog with realistic default items', () => {
        const seed = getSeedCatalog();
        expect(seed).toBeDefined();
        expect(seed.manifest.version).toBe('1.0.0');
        expect(seed.exercises.length).toBeGreaterThan(100);
        expect(seed.foods.length).toBeGreaterThan(150);

        const panca = seed.exercises.find(e => e.id === 'panca-piana-bilanciere');
        expect(panca).toBeDefined();
        expect(panca?.name).toBe('Panca Piana Bilanciere');
    });

    it('persists and retrieves catalog from cache', async () => {
        const seed = getSeedCatalog();
        await saveCatalogToCache(seed);
        const cached = await getCachedCatalog();
        expect(cached.manifest.version).toBe(seed.manifest.version);
        expect(cached.exercises.length).toBe(seed.exercises.length);
    });
});

describe('5. Catalog: Delta Resolver (AGENTS.md 5-Step Compliance)', () => {
    const globalExercises: CatalogExercise[] = [
        { id: 'ex-1', name: 'Squat', muscles: ['quads'], trackingType: 'weight_reps', isDefault: true },
        { id: 'ex-2', name: 'Panca Piana', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true },
        { id: 'ex-3', name: 'Stacco da Terra', muscles: ['back', 'hamstrings'], trackingType: 'weight_reps', isDefault: true }
    ];

    const globalFoods: CatalogFood[] = [
        { id: 'f-1', name: 'Riso Basmati', kcal: 350, pro: 7, carbs: 78, fat: 1, brand: 'Generico' },
        { id: 'f-2', name: 'Pollo Petto', kcal: 103, pro: 23, carbs: 0, fat: 1.2, brand: 'Generico' }
    ];

    it('resolves effective exercises with global defaults, custom items, overrides and hidden items', () => {
        const customExercises = [
            { id: 'custom-1', name: 'Squat Bulgaro Personalizzato', setsCount: 4, muscles: ['quads', 'glutes'] }
        ];

        let overrides: CatalogOverrides = {
            exercises: {
                'ex-2': { name: 'Panca Piana Bilanciere Olimpico', equipmentWeight: 20 }
            },
            hiddenExerciseIds: ['ex-3']
        };

        const resolved = resolveEffectiveExercises(globalExercises, customExercises, overrides);

        // Custom items should be first
        expect(resolved[0].id).toBe('custom-1');
        expect(resolved[0].isDefault).toBe(false);

        // Overridden global item
        const panca = resolved.find(e => e.id === 'ex-2');
        expect(panca).toBeDefined();
        expect(panca?.name).toBe('Panca Piana Bilanciere Olimpico');
        expect(panca?.equipmentWeight).toBe(20);
        expect(panca?.isDefault).toBe(true);

        // Hidden item should NOT be present
        const stacco = resolved.find(e => e.id === 'ex-3');
        expect(stacco).toBeUndefined();

        // Normal unmodified global item
        const squat = resolved.find(e => e.id === 'ex-1');
        expect(squat).toBeDefined();
        expect(squat?.name).toBe('Squat');
    });

    it('resolves effective foods correctly', () => {
        const customFoods = [
            { id: 'custom-f1', name: 'Farina d Avena Aromatizzata', kcal: 370, pro: 13, carbs: 65, fat: 7 }
        ];

        let overrides: CatalogOverrides = {
            foods: {
                'f-1': { brand: 'Scotti' }
            },
            hiddenFoodIds: ['f-2']
        };

        const resolved = resolveEffectiveFoods(globalFoods, customFoods, overrides);

        expect(resolved[0].id).toBe('custom-f1');
        expect(resolved[0].isCustom).toBe(true);

        const riso = resolved.find(f => f.id === 'f-1');
        expect(riso?.brand).toBe('Scotti');

        const pollo = resolved.find(f => f.id === 'f-2');
        expect(pollo).toBeUndefined();
    });

    it('creates accurate delta overrides for modified exercises and foods', () => {
        const baseEx: CatalogExercise = { id: 'ex-1', name: 'Squat', muscles: ['quads'], trackingType: 'weight_reps' };
        const overrideEx = createExerciseOverride(baseEx, { name: 'Squat Profondo', equipmentWeight: 20 });
        expect(overrideEx.name).toBe('Squat Profondo');
        expect(overrideEx.equipmentWeight).toBe(20);
        expect(overrideEx.muscles).toBeUndefined(); // Unchanged field is not in override

        const baseFood: CatalogFood = { id: 'f-1', name: 'Riso', kcal: 350, pro: 7, carbs: 78, fat: 1, brand: 'Generico' };
        const overrideFood = createFoodOverride(baseFood, { brand: 'Gallo', kcal: 360 });
        expect(overrideFood.brand).toBe('Gallo');
        expect(overrideFood.kcal).toBe(360);
        expect(overrideFood.pro).toBeUndefined();
    });

    it('handles hiding and unhiding catalog items', () => {
        let overrides: CatalogOverrides = {};
        overrides = hideCatalogExercise('ex-1', overrides);
        expect(overrides.hiddenExerciseIds).toContain('ex-1');

        overrides = unhideCatalogExercise('ex-1', overrides);
        expect(overrides.hiddenExerciseIds).not.toContain('ex-1');

        overrides = hideCatalogFood('f-1', overrides);
        expect(overrides.hiddenFoodIds).toContain('f-1');

        overrides = unhideCatalogFood('f-1', overrides);
        expect(overrides.hiddenFoodIds).not.toContain('f-1');
    });

    it('migrates legacy monolithic library into custom exercises and overrides', () => {
        const legacyLibrary = [
            { id: 'ex-1', name: 'Squat Modificato', setsCount: 3, isDefault: true, muscles: ['quads'] },
            { id: 'custom-only', name: 'Mio Esercizio', setsCount: 3, isDefault: false, muscles: ['biceps'] }
            // 'ex-2' and 'ex-3' are missing from legacy library -> should become hidden
        ];

        const migrated = migrateLegacyLibraryToOverrides(legacyLibrary, globalExercises);
        expect(migrated.customExercises.length).toBe(1);
        expect(migrated.customExercises[0].id).toBe('custom-only');

        expect(migrated.overrides.exercises?.['ex-1']?.name).toBe('Squat Modificato');
        expect(migrated.overrides.hiddenExerciseIds).toContain('ex-2');
        expect(migrated.overrides.hiddenExerciseIds).toContain('ex-3');
    });
});
