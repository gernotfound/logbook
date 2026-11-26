import type { CachedGlobalCatalog, CatalogManifest } from '../../types';
import { CatalogExerciseSchema, CatalogFoodSchema, CatalogManifestSchema } from '../schema';
import { getCachedCatalog, saveCatalogToCache, validFoodItems, validItems, validManifest } from './catalogService';

type CatalogKind = 'exercises' | 'foods';
type StaticManifest = CatalogManifest & { digests: Record<CatalogKind, string> };
type SyncResult = { catalog: CachedGlobalCatalog; updated: boolean; persisted?: boolean };

const MAX_MANIFEST_BYTES = 16_384;
const MAX_DOCUMENT_BYTES = 800_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
let syncInFlight: Promise<SyncResult> | null = null;

function parseManifest(raw: unknown): StaticManifest {
  if (!validManifest(raw)) throw new Error('Manifest catalogo non valido');
  const parsed = CatalogManifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Schema manifest non valido');
  const manifest = raw as StaticManifest;
  if (!VERSION_PATTERN.test(manifest.version) ||
      typeof manifest.updatedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(manifest.updatedAt) ||
      !Number.isFinite(Date.parse(manifest.updatedAt)) ||
      new Date(manifest.updatedAt).toISOString() !== manifest.updatedAt ||
      manifest.itemCounts.exercises === 0 || manifest.itemCounts.foods === 0 ||
      !manifest.digests || typeof manifest.digests !== 'object') throw new Error('Versione o impronte mancanti');
  for (const kind of ['exercises', 'foods'] as const) {
    const digest = manifest.digests[kind];
    if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest) ||
        manifest.docRefs[kind] !== `${kind}_${manifest.version}_${digest}.json`) {
      throw new Error('Riferimento non immutabile o impronta non valida');
    }
  }
  return manifest;
}

function validStaticFields(items: unknown, kind: CatalogKind): boolean {
  if (!Array.isArray(items)) return false;
  const numericFields = kind === 'foods'
    ? ['baseQty', 'servingWeight', 'satFat', 'sugars', 'sodium', 'fiber', 'iron', 'potassium', 'calcium', 'magnesium', 'cholesterol']
    : ['equipmentWeight', 'setsCount'];
  const textFields = kind === 'foods'
    ? ['brand', 'category', 'unit', 'servingUnit'] : ['notes'];
  return items.every(item => {
    if (kind === 'exercises' &&
        (typeof item.id !== 'string' ||
         (item.trackingType !== undefined && !['weight_reps', 'time', 'cardio'].includes(item.trackingType)) ||
         ['muscles', 'secondaryMuscles'].some(key => item[key] !== undefined &&
           (!Array.isArray(item[key]) || item[key].some((value: unknown) => typeof value !== 'string'))) ||
         ['isDefault', 'isBodyweight'].some(key => item[key] !== undefined && typeof item[key] !== 'boolean'))) return false;
    if (kind === 'foods' && item.isCustom !== undefined && typeof item.isCustom !== 'boolean') return false;
    return !numericFields.some(key => item[key] !== undefined && !(key === 'servingWeight' && item[key] === null) &&
      (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0)) &&
      !textFields.some(key => item[key] !== undefined && typeof item[key] !== 'string');
  });
}

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (response.status !== 200 || response.redirected ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Risposta asset catalogo non valida');
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new Error('Asset catalogo troppo grande');
  }
  if (!response.body) throw new Error('Asset catalogo senza corpo');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('Timeout catalogo');
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error('Timeout catalogo');
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Asset catalogo troppo grande');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchJson(url: string, limit: number, signal: AbortSignal, cache: RequestCache): Promise<{ raw: unknown; bytes: Uint8Array }> {
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache, signal });
  if (signal.aborted) throw new Error('Timeout catalogo');
  const bytes = await readBounded(response, limit, signal);
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return { raw, bytes };
}

async function hexDigest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function performSync(cached: CachedGlobalCatalog, signal: AbortSignal, force: boolean): Promise<SyncResult> {
  const { raw: rawManifest } = await fetchJson('/catalog/manifest.json', MAX_MANIFEST_BYTES, signal, 'no-store');
  const manifest = parseManifest(rawManifest);
  const unchanged = !force && cached.manifest.version === manifest.version &&
    cached.manifest.docRefs.exercises === manifest.docRefs.exercises &&
    cached.manifest.docRefs.foods === manifest.docRefs.foods &&
    cached.manifest.itemCounts.exercises === manifest.itemCounts.exercises &&
    cached.manifest.itemCounts.foods === manifest.itemCounts.foods &&
    validItems(cached.exercises, manifest.itemCounts.exercises) &&
    validFoodItems(cached.foods, manifest.itemCounts.foods);
  if (unchanged) return { catalog: cached, updated: false };

  const [exercisesDoc, foodsDoc] = await Promise.all((['exercises', 'foods'] as const).map(async kind => {
    const result = await fetchJson(`/catalog/${manifest.docRefs[kind]}`, MAX_DOCUMENT_BYTES, signal, 'force-cache');
    if (await hexDigest(result.bytes) !== manifest.digests[kind]) throw new Error(`${kind}: impronta SHA-256 non corrispondente`);
    return result.raw;
  }));
  const exercises = (exercisesDoc as { items?: unknown } | null)?.items;
  const foods = (foodsDoc as { items?: unknown } | null)?.items;
  if (!validItems(exercises, manifest.itemCounts.exercises) || !validStaticFields(exercises, 'exercises') ||
      !validFoodItems(foods, manifest.itemCounts.foods) || !validStaticFields(foods, 'foods')) {
    throw new Error('Catalogo incompleto o dati non validi');
  }
  const updated: CachedGlobalCatalog = {
    manifest,
    exercises: exercises.map(item => CatalogExerciseSchema.parse(item)),
    foods: foods.map(item => CatalogFoodSchema.parse(item)),
    cachedAt: Date.now(),
  };
  if (signal.aborted) throw new Error('Timeout catalogo');
  const persisted = await saveCatalogToCache(updated);
  return { catalog: updated, updated: true, persisted };
}

/** Candidate-only reader. Not mounted until static assets have been reviewed and published. */
export async function syncStaticCatalog(options?: { force?: boolean; timeoutMs?: number }): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;
  const work = (async () => {
    const cached = await getCachedCatalog();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (typeof navigator !== 'undefined' && !navigator.onLine || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { catalog: cached, updated: false };
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Timeout bounds even a transport that ignores AbortSignal. Aborted work
      // also checks the signal before publishing anything to the durable cache.
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Timeout catalogo')); }, timeoutMs);
      });
      return await Promise.race([performSync(cached, controller.signal, options?.force === true), timedOut]);
    } catch (err) {
      console.warn('[StaticCatalog] Aggiornamento fallito, mantenuta la cache locale:', err);
      return { catalog: cached, updated: false };
    } finally {
      clearTimeout(timer);
    }
  })();
  syncInFlight = work;
  try { return await work; }
  finally { if (syncInFlight === work) syncInFlight = null; }
}
