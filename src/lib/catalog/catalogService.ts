/**
 * Global Catalog Service (LogBook PWA)
 * 
 * Part of Requirement R3: Global Catalog, Offline Fallback & Separate Cache.
 * 
 * Architectural Highlights:
 * 1. Dedicated IndexedDB Key ('logbook_cached_global_catalog') completely separate from owner-scoped user envelopes.
 * 2. Provider-independent cache and strict catalog validation. Remote
 *    refresh is isolated in the legacy Firestore adapter until migration.
 * 3. Seed Fallback: Instantaneous offline/guest bootstrap using bundled seedExercises.json & seedFoods.json.
 * 4. Local reads use memory, durable IndexedDB or bundled seeds; they do not
 *    initialize Firebase or depend on Kinde/network availability.
 */

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import {
    type CatalogManifest,
    type CatalogFood,
    type CachedGlobalCatalog
} from '../../types';
import {
    CatalogExerciseSchema,
    CatalogFoodSchema,
    CachedGlobalCatalogSchema
} from '../schema';

export const CATALOG_CACHE_KEY = 'logbook_cached_global_catalog';
import seedExercisesRaw from './seedExercises.json';
import seedFoodsRaw from './seedFoods.json';

let inMemoryCatalogCache: CachedGlobalCatalog | null = null;
let isLoadedFromPersistentCache = false;

export function validManifest(value: unknown): value is CatalogManifest {
    if (!value || typeof value !== 'object') return false;
    const manifest = value as CatalogManifest;
    return typeof manifest.version === 'string' && !!manifest.version.trim() && manifest.schemaVersion === 1 &&
        [manifest.docRefs?.exercises, manifest.docRefs?.foods].every(ref => typeof ref === 'string' && !!ref && !ref.includes('/')) &&
        [manifest.itemCounts?.exercises, manifest.itemCounts?.foods].every(count => Number.isSafeInteger(count) && count >= 0);
}

export function validItems(items: unknown, count: number): items is Array<{ id: string | number; name: string }> {
    if (!Array.isArray(items) || items.length !== count) return false;
    const ids = new Set<string>();
    return items.every(item => {
        if (!item || !((typeof item.id === 'string' && item.id.trim()) || (typeof item.id === 'number' && Number.isFinite(item.id))) || typeof item.name !== 'string' || !item.name.trim()) return false;
        const id = String(item.id);
        if (ids.has(id)) return false;
        ids.add(id);
        return true;
    });
}

// Unlike local user input, global food documents are published with numeric
// macronutrients. A forgiving Zod fallback must not silently turn a corrupt
// persisted/remote value into 0 kcal or 0 g of protein.
export function validFoodItems(items: unknown, count: number): items is CatalogFood[] {
    return validItems(items, count) && items.every(item =>
        (['kcal', 'pro', 'carbs', 'fat'] as const).every(key => {
            const value = (item as unknown as Record<string, unknown>)[key];
            return typeof value === 'number' && Number.isFinite(value) && value >= 0;
        })
    );
}

/**
 * Returns the bundled static seed catalog for instantaneous cold starts.
 */
export function getSeedCatalog(): CachedGlobalCatalog {
    // A bundled seed is build-time input, not a bypass around catalog schemas.
    // Invalid entries must fail validation rather than become trusted defaults.
    const exercises = (seedExercisesRaw as unknown[]).map(item => CatalogExerciseSchema.parse(item));
    const foods = (seedFoodsRaw as unknown[]).map(item => CatalogFoodSchema.parse(item));

    return {
        manifest: {
            version: '1.0.0',
            updatedAt: '2026-08-22T00:00:00.000Z',
            schemaVersion: 1,
            docRefs: {
                exercises: 'exercises_v1',
                foods: 'foods_v1'
            },
            itemCounts: {
                exercises: exercises.length,
                foods: foods.length
            }
        },
        exercises,
        foods,
        cachedAt: Date.now()
    };
}

/**
 * Retrieves the global catalog from memory or IndexedDB.
 * Falls back to the bundled seed dataset if IndexedDB is empty or corrupt.
 */
export async function getCachedCatalog(): Promise<CachedGlobalCatalog> {
    if (inMemoryCatalogCache && isLoadedFromPersistentCache) {
        return inMemoryCatalogCache;
    }

    let cacheReadFailed = false;
    // The first IDB read may fail transiently during startup. Retry once in
    // this boundary so a single failure cannot publish an empty catalog UI.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rawCached = await idbGet<unknown>(CATALOG_CACHE_KEY);
        cacheReadFailed = false;
        // A network update or explicit save may complete while the IDB read is pending.
        // Never publish an older IDB snapshot over that newer in-memory catalog.
        if (inMemoryCatalogCache && isLoadedFromPersistentCache) return inMemoryCatalogCache;
        if (rawCached) {
            const parsed = CachedGlobalCatalogSchema.safeParse(rawCached);
            // Validate raw identities and required nutritional values before
            // permissive schema fallbacks can conceal damaged persisted data.
            const raw = rawCached as Partial<CachedGlobalCatalog>;
            if (parsed.success && validManifest(raw.manifest) &&
                validItems(raw.exercises, raw.manifest.itemCounts.exercises) &&
                validFoodItems(raw.foods, raw.manifest.itemCounts.foods) &&
                validManifest(parsed.data.manifest) &&
                validItems(parsed.data.exercises, parsed.data.manifest.itemCounts.exercises) &&
                validFoodItems(parsed.data.foods, parsed.data.manifest.itemCounts.foods)) {
                inMemoryCatalogCache = parsed.data;
                isLoadedFromPersistentCache = true;
                return parsed.data;
            }
            console.warn("[CatalogService] Cache IndexedDB corrotta, ripristino seed predefinito.");
        }
        // A successful empty or invalid read is not a transport failure.
        break;
      } catch (err) {
        cacheReadFailed = true;
        console.warn("[CatalogService] Errore lettura cache IndexedDB:", err);
        if (inMemoryCatalogCache && isLoadedFromPersistentCache) return inMemoryCatalogCache;
      }
    }

    // The read may also fail after another caller has published a fresh catalog.
    if (inMemoryCatalogCache && isLoadedFromPersistentCache) return inMemoryCatalogCache;

    // Fallback to static bundled seed
    const seedCatalog = getSeedCatalog();
    inMemoryCatalogCache = seedCatalog;
    // A transient read error must not pin the empty seed for this session:
    // the existing durable catalog might be readable on the next attempt.
    isLoadedFromPersistentCache = !cacheReadFailed;

    // The bundled seed is reproducible and needs no IndexedDB write. A delayed
    // seed write could overwrite a newly downloaded catalog or a failed read's
    // last recoverable cache entry.

    return seedCatalog;
}

/**
 * Updates memory and attempts IndexedDB persistence; returns false when not durable.
 */
export async function saveCatalogToCache(catalog: CachedGlobalCatalog): Promise<boolean> {
    inMemoryCatalogCache = catalog;
    isLoadedFromPersistentCache = true;
    try {
        await idbSet(CATALOG_CACHE_KEY, catalog);
        return true;
    } catch (err) {
        console.warn("[CatalogService] Errore salvataggio catalogo in IndexedDB:", err);
        // The catalog is usable in memory, but its offline persistence failed.
        return false;
    }
}

/**
 * Clears the catalog from both IndexedDB and memory.
 */
export async function clearCatalogCache(): Promise<void> {
    inMemoryCatalogCache = null;
    isLoadedFromPersistentCache = false;
    try {
        await idbDel(CATALOG_CACHE_KEY);
    } catch (err) {
        console.warn("[CatalogService] Errore eliminazione cache catalogo:", err);
    }
}

/**
 * Synchronous in-memory lookup with guaranteed seed fallback by default.
 * Passing `false` allows checking if the catalog is already in memory without auto-populating seed.
 */
export function getInMemoryCatalog(fallbackToSeed?: true): CachedGlobalCatalog;
export function getInMemoryCatalog(fallbackToSeed: false): CachedGlobalCatalog | null;
export function getInMemoryCatalog(fallbackToSeed: boolean = true): CachedGlobalCatalog | null {
    if (!inMemoryCatalogCache && fallbackToSeed) {
        inMemoryCatalogCache = getSeedCatalog();
    }
    return inMemoryCatalogCache;
}


