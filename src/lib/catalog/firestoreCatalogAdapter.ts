/**
 * Legacy Firestore catalog refresh, kept separate from local offline reads.
 * This adapter remains only while authenticated cloud hydration uses Firebase.
 * The target PWA will use the bundled catalog with a reviewed static update path.
 */
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { type CatalogManifest, type CatalogFood, type CachedGlobalCatalog } from '../../types';
import { CatalogManifestSchema, CatalogExerciseSchema, CatalogFoodSchema } from '../schema';
import {
    getCachedCatalog, saveCatalogToCache, validManifest, validItems, validFoodItems,
} from './catalogService';

const CATALOG_FIRESTORE_COLLECTION = 'global_catalog';
const CATALOG_MANIFEST_DOC_ID = 'manifest';
const DEFAULT_SYNC_TIMEOUT_MS = 4000;
let syncInFlight: Promise<{ catalog: CachedGlobalCatalog; updated: boolean; persisted?: boolean }> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, errMsg = "Timeout operazione catalogo"): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errMsg)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Performs a single O(1) Firestore read to fetch the latest catalog manifest.
 */
async function fetchRemoteManifest(
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
        if (validManifest(data) && parsed.success) {
            return parsed.data;
        } else {
            console.warn("[CatalogService] Manifest remoto non conforme allo schema.");
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
): Promise<{ catalog: CachedGlobalCatalog; updated: boolean; persisted?: boolean }> {
    if (syncInFlight) return syncInFlight;
    const work = performCatalogSync(dbInstance, options);
    syncInFlight = work;
    try { return await work; }
    finally { if (syncInFlight === work) syncInFlight = null; }
}

async function performCatalogSync(dbInstance: Firestore, options?: { force?: boolean; timeoutMs?: number }): Promise<{ catalog: CachedGlobalCatalog; updated: boolean; persisted?: boolean }> {
    const cached = await getCachedCatalog();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
    // Manifest and data documents share one network budget. Two independent
    // timeouts could otherwise delay authenticated hydration for twice as long.
    const syncDeadline = Date.now() + timeoutMs;

    if (!navigator.onLine || timeoutMs <= 0) {
        return { catalog: cached, updated: false };
    }

    try {
        const remoteManifest = await fetchRemoteManifest(dbInstance, timeoutMs);
        if (!remoteManifest) {
            return { catalog: cached, updated: false };
        }

        const isOutdated = cached.manifest.version !== remoteManifest.version ||
            cached.manifest.schemaVersion !== remoteManifest.schemaVersion ||
            cached.manifest.docRefs.exercises !== remoteManifest.docRefs.exercises ||
            cached.manifest.docRefs.foods !== remoteManifest.docRefs.foods ||
            !validItems(cached.exercises, remoteManifest.itemCounts.exercises) ||
            !validItems(cached.foods, remoteManifest.itemCounts.foods) ||
            options?.force === true;

        if (!isOutdated) {
            // Version matches: Zero extra reads!
            return { catalog: cached, updated: false };
        }

        console.info(`[CatalogService] Aggiornamento catalogo da v${cached.manifest.version} a v${remoteManifest.version}...`);

        // Fetch updated exercises document
        const exercisesDocRef = doc(dbInstance, CATALOG_FIRESTORE_COLLECTION, remoteManifest.docRefs.exercises);
        const foodsDocRef = doc(dbInstance, CATALOG_FIRESTORE_COLLECTION, remoteManifest.docRefs.foods);

        const remainingMs = syncDeadline - Date.now();
        if (remainingMs <= 0) return { catalog: cached, updated: false };

        const [exercisesSnap, foodsSnap] = await withTimeout(
            Promise.all([getDoc(exercisesDocRef), getDoc(foodsDocRef)]),
            remainingMs,
            "Timeout scaricamento documenti catalogo globale"
        );

        if (!exercisesSnap.exists() || !foodsSnap.exists()) throw new Error('Documenti catalogo mancanti');
        const exerciseItems: unknown = exercisesSnap.data()?.items;
        const foodItems: unknown = foodsSnap.data()?.items;
        if (!validItems(exerciseItems, remoteManifest.itemCounts.exercises) || !validFoodItems(foodItems, remoteManifest.itemCounts.foods)) throw new Error('Catalogo incompleto o con identità non valide');
        const newExercises = exerciseItems.map(item => CatalogExerciseSchema.parse(item));
        const newFoods = foodItems.map(item => CatalogFoodSchema.parse(item));

        const updatedCatalog: CachedGlobalCatalog = {
            manifest: remoteManifest,
            exercises: newExercises,
            foods: newFoods,
            cachedAt: Date.now()
        };

        const persisted = await saveCatalogToCache(updatedCatalog);
        return { catalog: updatedCatalog, updated: true, persisted };
    } catch (err) {
        console.warn("[CatalogService] Sincronizzazione remota catalogo fallita, mantenuta versione locale:", err);
        return { catalog: cached, updated: false };
    }
}

