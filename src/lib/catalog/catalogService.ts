/**
 * Global Catalog Service (LogBook PWA)
 * 
 * Part of Requirement R3: Global Catalog, Offline Fallback & Separate Cache.
 * 
 * Architectural Highlights:
 * 1. Dedicated IndexedDB Key ('logbook_cached_global_catalog') completely separate from 'logbook_cached_user_data'.
 * 2. O(1) Manifest Verification: Single Firestore document read to check version freshness.
 *    If version matches, zero additional reads are performed (Spark 50k read limit preservation).
 * 3. Seed Fallback: Instantaneous offline/guest bootstrap using bundled seedExercises.json & seedFoods.json.
 * 4. Resilient Network Degradation: 4-second timeout protection; falls back silently to cache on network/App Check failure.
 * 5. Zero Realtime Listeners: Snapshot listeners are strictly prohibited to avoid billable read streams.
 */

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import {
    type CatalogManifest,
    type CatalogExercise,
    type CatalogFood,
    type CachedGlobalCatalog
} from '../../types';
import {
    CatalogManifestSchema,
    CatalogExerciseSchema,
    CatalogFoodSchema,
    CachedGlobalCatalogSchema
} from '../schema';

export const CATALOG_CACHE_KEY = 'logbook_cached_global_catalog';
export const CATALOG_FIRESTORE_COLLECTION = 'global_catalog';
export const CATALOG_MANIFEST_DOC_ID = 'manifest';

import seedExercisesRaw from './seedExercises.json';
import seedFoodsRaw from './seedFoods.json';

const DEFAULT_SYNC_TIMEOUT_MS = 4000;

let inMemoryCatalogCache: CachedGlobalCatalog | null = null;
let isLoadedFromPersistentCache = false;

function withTimeout<T>(promise: Promise<T>, ms: number, errMsg = "Timeout operazione catalogo"): Promise<T> {
    let timer: any;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errMsg)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Returns the bundled static seed catalog for instantaneous cold starts.
 */
export function getSeedCatalog(): CachedGlobalCatalog {
    const exercises = (seedExercisesRaw as any[]).map(item => {
        const parsed = CatalogExerciseSchema.safeParse(item);
        return parsed.success ? parsed.data : (item as CatalogExercise);
    });

    const foods = (seedFoodsRaw as any[]).map(item => {
        const parsed = CatalogFoodSchema.safeParse(item);
        return parsed.success ? parsed.data : (item as CatalogFood);
    });

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

    try {
        const rawCached = await idbGet<unknown>(CATALOG_CACHE_KEY);
        if (rawCached) {
            const parsed = CachedGlobalCatalogSchema.safeParse(rawCached);
            if (parsed.success) {
                inMemoryCatalogCache = parsed.data;
                isLoadedFromPersistentCache = true;
                return parsed.data;
            }
            console.warn("[CatalogService] Cache IndexedDB corrotta, ripristino seed predefinito.");
        }
    } catch (err) {
        console.warn("[CatalogService] Errore lettura cache IndexedDB:", err);
    }

    // Fallback to static bundled seed
    const seedCatalog = getSeedCatalog();
    inMemoryCatalogCache = seedCatalog;
    isLoadedFromPersistentCache = true;

    // Asynchronously populate IndexedDB in background
    saveCatalogToCache(seedCatalog).catch(err => {
        console.warn("[CatalogService] Impossibile salvare il seed in IndexedDB:", err);
    });

    return seedCatalog;
}

/**
 * Persists the catalog to both memory and IndexedDB.
 */
export async function saveCatalogToCache(catalog: CachedGlobalCatalog): Promise<void> {
    inMemoryCatalogCache = catalog;
    isLoadedFromPersistentCache = true;
    try {
        await idbSet(CATALOG_CACHE_KEY, catalog);
    } catch (err) {
        console.warn("[CatalogService] Errore salvataggio catalogo in IndexedDB:", err);
    }
}

/**
 * Performs a single O(1) Firestore read to fetch the latest catalog manifest.
 */
export async function fetchRemoteManifest(
    dbInstance: Firestore,
    timeoutMs: number = DEFAULT_SYNC_TIMEOUT_MS
): Promise<CatalogManifest | null> {
    try {
        const manifestRef = doc(dbInstance, CATALOG_FIRESTORE_COLLECTION, CATALOG_MANIFEST_DOC_ID);
        const snapshot = await withTimeout(
            getDoc(manifestRef),
            timeoutMs,
            "Timeout lettura manifest catalogo globale"
        );

        if (!snapshot.exists()) {
            return null;
        }

        const data = snapshot.data();
        const parsed = CatalogManifestSchema.safeParse(data);
        if (parsed.success) {
            return parsed.data;
        } else {
            console.warn("[CatalogService] Manifest remoto non conforme allo schema:", parsed.error);
            return null;
        }
    } catch (err) {
        console.warn("[CatalogService] Impossibile recuperare il manifest remoto:", err);
        return null;
    }
}

/**
 * Synchronizes the global catalog with Firestore.
 * 
 * Algorithm:
 * 1. Reads current local cache from IndexedDB.
 * 2. Fetches remote manifest (1 read).
 * 3. Compares remoteManifest.version vs cached.manifest.version.
 * 4. If identical, returns immediately with updated = false (0 extra reads).
 * 5. If different, fetches exercises doc & foods doc (2 reads), updates cache and returns updated = true.
 */
export async function syncGlobalCatalog(
    dbInstance: Firestore,
    options?: { force?: boolean; timeoutMs?: number }
): Promise<{ catalog: CachedGlobalCatalog; updated: boolean }> {
    const cached = await getCachedCatalog();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;

    if (!navigator.onLine) {
        return { catalog: cached, updated: false };
    }

    try {
        const remoteManifest = await fetchRemoteManifest(dbInstance, timeoutMs);
        if (!remoteManifest) {
            return { catalog: cached, updated: false };
        }

        const isOutdated = cached.manifest.version !== remoteManifest.version ||
            cached.manifest.schemaVersion !== remoteManifest.schemaVersion ||
            options?.force === true;

        if (!isOutdated) {
            // Version matches: Zero extra reads!
            return { catalog: cached, updated: false };
        }

        console.info(`[CatalogService] Aggiornamento catalogo da v${cached.manifest.version} a v${remoteManifest.version}...`);

        // Fetch updated exercises document
        const exercisesDocRef = doc(dbInstance, CATALOG_FIRESTORE_COLLECTION, remoteManifest.docRefs.exercises);
        const foodsDocRef = doc(dbInstance, CATALOG_FIRESTORE_COLLECTION, remoteManifest.docRefs.foods);

        const [exercisesSnap, foodsSnap] = await withTimeout(
            Promise.all([getDoc(exercisesDocRef), getDoc(foodsDocRef)]),
            timeoutMs,
            "Timeout scaricamento documenti catalogo globale"
        );

        let newExercises: CatalogExercise[] = cached.exercises;
        if (exercisesSnap.exists()) {
            const data = exercisesSnap.data();
            const items = Array.isArray(data?.items) ? data.items : [];
            const sanitizedExercises: CatalogExercise[] = [];
            for (const item of items) {
                const parsed = CatalogExerciseSchema.safeParse(item);
                if (parsed.success) {
                    sanitizedExercises.push(parsed.data);
                }
            }
            if (sanitizedExercises.length > 0) {
                newExercises = sanitizedExercises;
            }
        }

        let newFoods: CatalogFood[] = cached.foods;
        if (foodsSnap.exists()) {
            const data = foodsSnap.data();
            const items = Array.isArray(data?.items) ? data.items : [];
            const sanitizedFoods: CatalogFood[] = [];
            for (const item of items) {
                const parsed = CatalogFoodSchema.safeParse(item);
                if (parsed.success) {
                    sanitizedFoods.push(parsed.data);
                }
            }
            if (sanitizedFoods.length > 0) {
                newFoods = sanitizedFoods;
            }
        }

        const updatedCatalog: CachedGlobalCatalog = {
            manifest: remoteManifest,
            exercises: newExercises,
            foods: newFoods,
            cachedAt: Date.now()
        };

        await saveCatalogToCache(updatedCatalog);
        return { catalog: updatedCatalog, updated: true };
    } catch (err) {
        console.warn("[CatalogService] Sincronizzazione remota catalogo fallita, mantenuta versione locale:", err);
        return { catalog: cached, updated: false };
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

/**
 * Checks whether the catalog is currently populated in memory.
 */
export function isCatalogInMemory(): boolean {
    return inMemoryCatalogCache !== null;
}

