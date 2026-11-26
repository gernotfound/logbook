import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { clearCatalogCache, getCachedCatalog, getSeedCatalog, saveCatalogToCache } from '../../../src/lib/catalog/catalogService';
import { syncStaticCatalog } from '../../../src/lib/catalog/staticCatalogAdapter';

const exercise = { id: 'synthetic-ex', name: 'Synthetic squat', trackingType: 'weight_reps' };
const food = { id: 'synthetic-food', name: 'Synthetic oats', kcal: 110, pro: 4, carbs: 17, fat: 2 };
const version = 'v2';

function fixtures(exercises: unknown = [exercise], foods: unknown = [food], candidateVersion = version) {
  const doc = (items: unknown) => JSON.stringify({ items });
  const bodies = { exercises: doc(exercises), foods: doc(foods) };
  const digests = Object.fromEntries(Object.entries(bodies).map(([kind, body]) =>
    [kind, createHash('sha256').update(body).digest('hex')])) as Record<'exercises' | 'foods', string>;
  const docRefs = {
    exercises: `exercises_${candidateVersion}_${digests.exercises}.json`,
    foods: `foods_${candidateVersion}_${digests.foods}.json`,
  };
  const manifest = {
    version: candidateVersion, updatedAt: '2026-11-26T10:00:00.000Z', schemaVersion: 1,
    docRefs, itemCounts: { exercises: Array.isArray(exercises) ? exercises.length : 1, foods: Array.isArray(foods) ? foods.length : 1 },
    digests,
  };
  const mapping = new Map([
    ['/catalog/manifest.json', JSON.stringify(manifest)],
    [`/catalog/${docRefs.exercises}`, bodies.exercises],
    [`/catalog/${docRefs.foods}`, bodies.foods],
  ]);
  return { manifest, mapping };
}

function response(body: string, init?: ResponseInit) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function serve(mapping: Map<string, string>) {
  const fetchMock = vi.fn(async (url: string) => response(mapping.get(url) ?? 'Not Found',
    mapping.has(url) ? undefined : { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('navigator', { onLine: true });
  await clearCatalogCache();
});

it('verifies immutable bytes before saving, then refreshes only the manifest for an unchanged version', async () => {
  const { mapping, manifest } = fixtures();
  const fetchMock = serve(mapping);
  const first = await syncStaticCatalog();
  expect(first.updated).toBe(true);
  expect(first.persisted).toBe(true);
  expect(first.catalog.exercises[0].id).toBe(exercise.id);
  expect(first.catalog.foods[0].kcal).toBe(food.kcal);
  expect((await getCachedCatalog()).manifest.docRefs).toEqual(manifest.docRefs);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toMatch(/^\/catalog\//);
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe(url.endsWith('/manifest.json') ? 'no-store' : 'force-cache');
  }
  const second = await syncStaticCatalog();
  expect(second.updated).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('refreshes matching version when immutable references change, then permits rollback to an older manifest', async () => {
  const initial = fixtures();
  serve(initial.mapping);
  expect((await syncStaticCatalog()).updated).toBe(true);
  const revised = fixtures([{ ...exercise, name: 'Synthetic modified' }]);
  serve(revised.mapping);
  expect((await syncStaticCatalog()).catalog.exercises[0].name).toBe('Synthetic modified');
  const rollback = fixtures([exercise], [food], 'v1');
  serve(rollback.mapping);
  expect((await syncStaticCatalog()).catalog.manifest.version).toBe('v1');
});

it('preserves the complete durable cache when an immutable asset differs from its digest', async () => {
  const previous = { ...getSeedCatalog(), manifest: { ...getSeedCatalog().manifest, version: 'trusted', itemCounts: { exercises: 1, foods: 1 } }, exercises: [exercise], foods: [food] };
  await saveCatalogToCache(previous);
  const { manifest, mapping } = fixtures();
  mapping.set(`/catalog/${manifest.docRefs.foods}`, JSON.stringify({ items: [{ ...food, kcal: 999 }] }));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  serve(mapping);
  const result = await syncStaticCatalog();
  expect(result.updated).toBe(false);
  expect(result.catalog.manifest.version).toBe('trusted');
  expect((await getCachedCatalog()).foods[0].kcal).toBe(110);
});

it.each([
  ['duplicate exercise IDs', [exercise, exercise], [food]],
  ['numeric exercise IDs', [{ ...exercise, id: 123 }], [food]],
  ['invalid tracking type', [{ ...exercise, trackingType: 'nonsense' }], [food]],
  ['negative food macros', [exercise], [{ ...food, pro: -1 }]],
  ['missing food macros', [exercise], [{ id: food.id, name: food.name }]],
  ['invalid optional nutrient', [exercise], [{ ...food, calcium: 'bad' }]],
] as const)('rejects %s even when the attacker recomputes a matching digest', async (_label, exercises, foods) => {
  const { mapping } = fixtures(exercises, foods);
  serve(mapping);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect((await syncStaticCatalog()).updated).toBe(false);
  expect((await getCachedCatalog()).exercises).toEqual([]);
});

it('rejects a signed but empty catalog rather than replacing complete offline data', async () => {
  const { mapping } = fixtures([], []);
  serve(mapping);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect((await syncStaticCatalog()).updated).toBe(false);
  expect((await getCachedCatalog()).foods).toEqual([]);
});

it('rejects path traversal, HTML app-shell fallback, redirection and oversized manifest', async () => {
  const { mapping, manifest } = fixtures();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mapping.set('/catalog/manifest.json', JSON.stringify({ ...manifest, docRefs: { ...manifest.docRefs, exercises: '../sensitive.json' } }));
  serve(mapping);
  expect((await syncStaticCatalog()).updated).toBe(false);
  mapping.set('/catalog/manifest.json', '<html>app shell</html>');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(mapping.get('/catalog/manifest.json'), { headers: { 'content-type': 'text/html' } })));
  expect((await syncStaticCatalog()).updated).toBe(false);
  vi.stubGlobal('fetch', vi.fn(async () => response('{}', { status: 302 })));
  expect((await syncStaticCatalog()).updated).toBe(false);
  vi.stubGlobal('fetch', vi.fn(async () => response(' '.repeat(16_385))));
  expect((await syncStaticCatalog()).updated).toBe(false);
  expect((await getCachedCatalog()).exercises).toEqual([]);
});

it('rejects noncanonical timestamps and missing or oversized document responses', async () => {
  const { mapping, manifest } = fixtures();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mapping.set('/catalog/manifest.json', JSON.stringify({ ...manifest, updatedAt: 'yesterday' }));
  serve(mapping);
  expect((await syncStaticCatalog()).updated).toBe(false);
  mapping.set('/catalog/manifest.json', JSON.stringify(manifest));
  mapping.delete(`/catalog/${manifest.docRefs.foods}`);
  serve(mapping);
  expect((await syncStaticCatalog()).updated).toBe(false);
  mapping.set(`/catalog/${manifest.docRefs.foods}`, ' '.repeat(800_001));
  serve(mapping);
  expect((await syncStaticCatalog()).updated).toBe(false);
  expect((await getCachedCatalog()).exercises).toEqual([]);
});

it('never fetches on an offline device and shares an in-flight refresh between callers', async () => {
  const { mapping } = fixtures();
  const fetchMock = serve(mapping);
  vi.stubGlobal('navigator', { onLine: false });
  expect((await syncStaticCatalog()).updated).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', { onLine: true });
  const [first, second] = await Promise.all([syncStaticCatalog(), syncStaticCatalog()]);
  expect(first).toBe(second);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('expires stalled transports without late cache publication even when fetch ignores AbortSignal', async () => {
  const { mapping } = fixtures();
  let release!: (value: Response) => void;
  const late = new Promise<Response>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/catalog/manifest.json' ? late : response(mapping.get(url) ?? '{}')));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const result = await syncStaticCatalog({ timeoutMs: 10 });
  expect(result.updated).toBe(false);
  release(response(mapping.get('/catalog/manifest.json')!));
  await new Promise(resolve => setTimeout(resolve, 5));
  expect((await getCachedCatalog()).exercises).toEqual([]);
});
