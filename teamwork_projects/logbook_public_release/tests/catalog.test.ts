import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSeedCatalog,
  getCachedCatalog,
  saveCatalogToCache,
  syncGlobalCatalog,
  clearCatalogCache,
} from '../src/catalog/catalogService.js';
import {
  CatalogManifestSchema,
  CachedGlobalCatalogSchema,
  CATALOG_CACHE_KEY,
  CachedGlobalCatalog,
  CatalogManifest,
} from '../src/catalog/catalogTypes.js';
import {
  resolveEffectiveExercises,
  resolveEffectiveFoods,
  Exercise,
  Food,
} from '../src/catalog/deltaResolver.js';

// Mock idb-keyval
const mockIdbStore = new Map<string, any>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => mockIdbStore.get(key) || null),
  set: vi.fn(async (key: string, val: any) => {
    mockIdbStore.set(key, val);
  }),
  del: vi.fn(async (key: string) => {
    mockIdbStore.delete(key);
  }),
}));

// Mock firebase/firestore
const mockFirestoreData: Record<string, any> = {};
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, collection, docId) => `${collection}/${docId}`),
  getDoc: vi.fn(async (docPath: string) => {
    const data = mockFirestoreData[docPath];
    return {
      exists: () => Boolean(data),
      data: () => data,
    };
  }),
}));

describe('Global Catalog Decoupling & Delta Resolution Suite', () => {
  const mockDb = {} as any;

  beforeEach(() => {
    mockIdbStore.clear();
    Object.keys(mockFirestoreData).forEach((k) => delete mockFirestoreData[k]);
    vi.clearAllMocks();
  });

  describe('Manifest & Schema Validation', () => {
    it('validates a compliant catalog manifest', () => {
      const rawManifest = {
        version: '1.2.0',
        updatedAt: '2026-08-22T12:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' },
        itemCounts: { exercises: 120, foods: 350 },
      };

      const parsed = CatalogManifestSchema.safeParse(rawManifest);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.version).toBe('1.2.0');
        expect(parsed.data.docRefs.exercises).toBe('exercises_v1');
      }
    });

    it('falls back safely for malformed manifest fields', () => {
      const badManifest = { version: null, schemaVersion: 'invalid' };
      const parsed = CatalogManifestSchema.safeParse(badManifest);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.version).toBe('1.0.0');
        expect(parsed.data.schemaVersion).toBe(1);
      }
    });
  });

  describe('Static Bundled Seed JSON Loading', () => {
    it('successfully loads and parses bundled seedExercises.json and seedFoods.json', () => {
      const seed = getSeedCatalog();

      expect(seed).toBeDefined();
      expect(seed.manifest.version).toBe('1.0.0');
      expect(Array.isArray(seed.exercises)).toBe(true);
      expect(Array.isArray(seed.foods)).toBe(true);
      expect(seed.exercises.length).toBeGreaterThan(10);
      expect(seed.foods.length).toBeGreaterThan(10);

      // Verify exercise shape in seed
      const firstEx = seed.exercises[0];
      expect(firstEx.id).toBeDefined();
      expect(firstEx.name).toBeDefined();

      // Verify food shape in seed
      const firstFood = seed.foods[0];
      expect(firstFood.id).toBeDefined();
      expect(firstFood.name).toBeDefined();
      expect(firstFood.kcal).toBeDefined();
    });

    it('enforces cache key separation: catalog cached in dedicated IDB key', () => {
      expect(CATALOG_CACHE_KEY).toBe('logbook_cached_global_catalog');
      expect(CATALOG_CACHE_KEY).not.toBe('logbook_cached_user_data');
    });
  });

  describe('O(1) Manifest Sync & Conditional Download', () => {
    it('skips downloading catalog items when remote version matches local cache version (0 extra reads)', async () => {
      const seed = getSeedCatalog();
      await saveCatalogToCache(seed);

      // Set remote manifest to matching version "1.0.0"
      mockFirestoreData['global_catalog/manifest'] = {
        version: '1.0.0',
        updatedAt: '2026-08-22T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' },
        itemCounts: { exercises: seed.exercises.length, foods: seed.foods.length },
      };

      const result = await syncGlobalCatalog(mockDb);

      expect(result.updated).toBe(false);
      expect(result.catalog.manifest.version).toBe('1.0.0');
    });

    it('downloads updated catalog documents when remote manifest has newer version', async () => {
      const seed = getSeedCatalog();
      await saveCatalogToCache(seed);

      // Set remote manifest with updated version "1.1.0"
      mockFirestoreData['global_catalog/manifest'] = {
        version: '1.1.0',
        updatedAt: '2026-08-23T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'exercises_v2', foods: 'foods_v2' },
        itemCounts: { exercises: 1, foods: 1 },
      };

      mockFirestoreData['global_catalog/exercises_v2'] = {
        items: [{ id: 'ex_updated_1', name: 'Panca inclinata bilanciere', trackingType: 'weight_reps' }],
      };
      mockFirestoreData['global_catalog/foods_v2'] = {
        items: [{ id: 'food_updated_1', name: 'Petto di pollo', kcal: 110, pro: 23, carbs: 0, fat: 1.5 }],
      };

      const result = await syncGlobalCatalog(mockDb);

      expect(result.updated).toBe(true);
      expect(result.catalog.manifest.version).toBe('1.1.0');
      expect(result.catalog.exercises.some((e) => e.id === 'ex_updated_1')).toBe(true);
      expect(result.catalog.foods.some((f) => f.id === 'food_updated_1')).toBe(true);
    });
  });

  describe('Runtime Delta Resolver (User Overrides + Custom Additions)', () => {
    const globalExercises = [
      { id: 'bench_press', name: 'Panca piana bilanciere', trackingType: 'weight_reps' as const, setsCount: 3 },
      { id: 'squat', name: 'Squat bilanciere', trackingType: 'weight_reps' as const, setsCount: 4 },
      { id: 'lat_machine', name: 'Lat machine', trackingType: 'weight_reps' as const, setsCount: 3 },
    ];

    const customExercises: Exercise[] = [
      { id: 'my_custom_curl', name: 'Curl bicipiti ai cavi personalizzato', setsCount: 3, sets: [] },
    ];

    it('resolves effective exercises applying overrides and omitting hidden IDs', () => {
      const overrides = {
        exercises: {
          bench_press: {
            notes: 'Tenere i gomiti a 45 gradi',
            equipmentWeight: 20,
          },
        },
        hiddenExerciseIds: ['lat_machine'],
      };

      const resolved = resolveEffectiveExercises(globalExercises, customExercises, overrides);

      // Hidden exercise should be excluded
      expect(resolved.some((e) => e.id === 'lat_machine')).toBe(false);

      // Overridden exercise should have custom properties applied
      const bench = resolved.find((e) => e.id === 'bench_press');
      expect(bench).toBeDefined();
      expect(bench?.notes).toBe('Tenere i gomiti a 45 gradi');
      expect(bench?.equipmentWeight).toBe(20);

      // Unmodified exercise remains intact
      const squat = resolved.find((e) => e.id === 'squat');
      expect(squat).toBeDefined();

      // Custom exercise is included
      const custom = resolved.find((e) => e.id === 'my_custom_curl');
      expect(custom).toBeDefined();
    });

    it('resolves effective foods applying overrides and omitting hidden IDs', () => {
      const globalFoods = [
        { id: 'chicken_breast', name: 'Petto di pollo', kcal: 110, pro: 23, carbs: 0, fat: 1.5 },
        { id: 'white_rice', name: 'Riso basmati', kcal: 350, pro: 7, carbs: 78, fat: 0.5 },
      ];

      const customFoods: Food[] = [
        { id: 'custom_protein_shake', name: 'Frullato proteico fatto in casa', kcal: 250, pro: 35, carbs: 15, fat: 3 },
      ];

      const overrides = {
        foods: {
          chicken_breast: {
            kcal: 115,
            brand: 'Fileni',
          },
        },
        hiddenFoodIds: ['white_rice'],
      };

      const resolved = resolveEffectiveFoods(globalFoods, customFoods, overrides);

      expect(resolved.some((f) => String(f.id) === 'white_rice')).toBe(false);

      const chicken = resolved.find((f) => String(f.id) === 'chicken_breast');
      expect(chicken).toBeDefined();
      expect(chicken?.kcal).toBe(115);
      expect(chicken?.brand).toBe('Fileni');

      const custom = resolved.find((f) => String(f.id) === 'custom_protein_shake');
      expect(custom).toBeDefined();
    });
  });
});
