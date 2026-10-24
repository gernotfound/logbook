import 'fake-indexeddb/auto';
const storageFault = vi.hoisted(() => ({
    failNextSet: false,
    stallNextGet: false,
    resolveGet: null as null | ((value: unknown) => void),
    rejectGet: null as null | ((reason: Error) => void),
    setCalls: 0,
}));
vi.mock('idb-keyval', async (importOriginal) => {
    const original = await importOriginal<typeof import('idb-keyval')>();
    return {
        ...original,
        get: (...args: Parameters<typeof original.get>) => {
            if (storageFault.stallNextGet) {
                storageFault.stallNextGet = false;
                return new Promise((resolve, reject) => {
                    storageFault.resolveGet = resolve;
                    storageFault.rejectGet = reject;
                });
            }
            return original.get(...args);
        },
        set: (...args: Parameters<typeof original.set>) => {
            storageFault.setCalls += 1;
            if (storageFault.failNextSet) {
                storageFault.failNextSet = false;
                return Promise.reject(new Error('quota exceeded'));
            }
            return original.set(...args);
        },
    };
});
import { beforeEach, expect, it, vi } from 'vitest';
const remote = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => collection + '/' + id, getDoc: remote.get }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackError: vi.fn() } }));
import { clearCatalogCache, getSeedCatalog, saveCatalogToCache, syncGlobalCatalog, getCachedCatalog } from '../../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../../src/lib/catalog/deltaResolver';
const snap = (data: unknown) => ({ exists: () => data !== undefined, data: () => data });
const exercise = { id: 'a', name: 'Omonimo', trackingType: 'weight_reps' as const };
const food = { id: '0', name: 'Omonimo', kcal: 100, pro: 0, carbs: 25, fat: 0 };
beforeEach(async () => {
    await clearCatalogCache();
    remote.get.mockReset();
    storageFault.failNextSet = false;
    storageFault.stallNextGet = false;
    storageFault.resolveGet = null;
    storageFault.rejectGet = null;
    storageFault.setCalls = 0;
    vi.stubGlobal('navigator', { onLine: true });
});
const arrange = (exercises: unknown = [exercise], foods: unknown = [food], version = '1.0.0') => {
    const manifest = { ...getSeedCatalog().manifest, version, itemCounts: { exercises: 1, foods: 1 } };
    remote.get.mockImplementation(async (path: string) => snap(path.endsWith('manifest') ? manifest : path.endsWith('exercises_v1') ? exercises === undefined ? undefined : { items: exercises } : foods === undefined ? undefined : { items: foods }));
    return manifest;
};
it('does not persist the reproducible empty seed or overwrite the cache on a failed read', async () => {
    const empty = await getCachedCatalog();
    expect(empty.exercises).toEqual([]);
    expect(storageFault.setCalls).toBe(0);
    expect(await (await import('idb-keyval')).get('logbook_cached_global_catalog')).toBeUndefined();
});

it.each(['fulfilled', 'rejected'] as const)('a stale %s IndexedDB read cannot undo a concurrent catalog save', async outcome => {
    storageFault.stallNextGet = true;
    const pending = getCachedCatalog();
    expect(storageFault.resolveGet).toBeTypeOf('function');
    const fresh = {
        ...getSeedCatalog(),
        manifest: { ...getSeedCatalog().manifest, version: 'newer-v6', itemCounts: { exercises: 1, foods: 1 } },
        exercises: [exercise],
        foods: [food],
    };
    expect(await saveCatalogToCache(fresh)).toBe(true);
    if (outcome === 'fulfilled') storageFault.resolveGet!(undefined);
    else storageFault.rejectGet!(new Error('database temporarily unavailable'));
    const resolved = await pending;
    expect(resolved.manifest.version).toBe('newer-v6');
    expect(resolved.exercises.map(item => item.id)).toEqual(['a']);
    expect((await getCachedCatalog()).manifest.version).toBe('newer-v6');
    expect(storageFault.setCalls).toBe(1);
});

it.each(['not-a-number', -1, Infinity])('rejects a cached food whose kcal value is %s rather than silently replacing it with zero', async kcal => {
    const malformed = {
        ...getSeedCatalog(),
        manifest: { ...getSeedCatalog().manifest, version: 'broken-v1', itemCounts: { exercises: 1, foods: 1 } },
        exercises: [exercise],
        foods: [{ ...food, kcal }],
    };
    await (await import('idb-keyval')).set('logbook_cached_global_catalog', malformed);
    const cached = await getCachedCatalog();
    expect(cached.manifest.version).toBe(getSeedCatalog().manifest.version);
    expect(cached.foods).toEqual([]);
    // The invalid raw cache is not overwritten with a guessed version.
    expect((await (await import('idb-keyval')).get<Record<string, unknown>>('logbook_cached_global_catalog'))?.manifest)
        .toEqual(malformed.manifest);
});

it.each(['not-a-number', -1, Infinity])('rejects remote %s kcal values and retains the last complete catalog', async kcal => {
    const before = getSeedCatalog();
    await saveCatalogToCache(before);
    arrange([exercise], [{ ...food, kcal }], 'invalid-remote-v1');
    const failed = await syncGlobalCatalog({} as never);
    expect(failed.updated).toBe(false);
    expect((await getCachedCatalog()).manifest.version).toBe(before.manifest.version);
    arrange([exercise], [food], 'valid-remote-v2');
    expect((await syncGlobalCatalog({} as never)).catalog.manifest.version).toBe('valid-remote-v2');
});

it('downloads a populated manifest even when the empty seed shares its version', async () => {
    arrange(); const result = await syncGlobalCatalog({} as never);
    expect(result.updated).toBe(true); expect(result.catalog.exercises.map(item => item.id)).toEqual(['a']);
    expect(result.catalog.foods.map(item => item.id)).toEqual(['0']); expect(remote.get).toHaveBeenCalledTimes(3);
    remote.get.mockClear(); expect((await syncGlobalCatalog({} as never)).updated).toBe(false);
    expect(remote.get).toHaveBeenCalledTimes(1);
});
it.each([null, [], [{ id: '', name: 'Rotto' }], [exercise, exercise]])('retains the previous manifest after an incomplete exercise document: %j', async items => {
    const before = getSeedCatalog(); await saveCatalogToCache(before); arrange(items, [food], '2.0.0');
    expect((await syncGlobalCatalog({} as never)).updated).toBe(false);
    expect((await getCachedCatalog()).manifest.version).toBe('1.0.0');
    arrange(); expect((await syncGlobalCatalog({} as never)).updated).toBe(true);
});
it('does not advance freshness when one document is absent', async () => {
    arrange(); const get = remote.get.getMockImplementation()!;
    remote.get.mockImplementation((path: string) => path.endsWith('foods_v1') ? Promise.resolve(snap(undefined)) : get(path));
    const result = await syncGlobalCatalog({} as never);
    expect(result.updated).toBe(false);
    expect(result.catalog.exercises).toEqual(getSeedCatalog().exercises);
    expect((await getCachedCatalog()).manifest.version).toBe(getSeedCatalog().manifest.version);
    expect(remote.get).toHaveBeenCalledTimes(3);
});
it('coalesces simultaneous downloads into one manifest and document request', async () => {
    arrange(); const [a, b] = await Promise.all([syncGlobalCatalog({} as never), syncGlobalCatalog({} as never)]);
    expect(a).toEqual(b); expect(remote.get).toHaveBeenCalledTimes(3);
});
it('ignores a timed-out obsolete manifest response after a later successful sync', async () => {
    const before = getSeedCatalog();
    await saveCatalogToCache(before);
    let resolveObsolete!: (value: ReturnType<typeof snap>) => void;
    remote.get.mockImplementationOnce(() => new Promise(resolve => { resolveObsolete = resolve; }));
    const stale = await syncGlobalCatalog({} as never, { timeoutMs: 10 });
    expect(stale.updated).toBe(false);

    arrange([exercise], [food], 'fresh-v4');
    const fresh = await syncGlobalCatalog({} as never);
    expect(fresh.updated).toBe(true);
    expect(fresh.catalog.manifest.version).toBe('fresh-v4');

    resolveObsolete(snap({ ...before.manifest, version: 'stale-v2' }));
    await Promise.resolve();
    expect((await getCachedCatalog()).manifest.version).toBe('fresh-v4');
});

it('preserves distinct IDs sharing a name and gives the custom identity precedence on ID collision', () => {
    const custom = { ...exercise, id: 'b', sets: [], setsCount: 3, isDefault: false };
    expect(resolveEffectiveExercises([exercise], [custom]).map(item => item.id)).toEqual(['b', 'a']);
    expect(resolveEffectiveFoods([food], [{ ...food, id: 'b', isCustom: true }]).map(item => item.id)).toEqual(['b', '0']);
    expect(resolveEffectiveFoods([food], [{ ...food, name: 'Locale', isCustom: true }])).toHaveLength(1);
    expect(resolveEffectiveFoods([food], [{ ...food, name: 'Locale', isCustom: true }])[0].name).toBe('Locale');
});


it('reports a new catalog as memory-only if IndexedDB rejects the write', async () => {
    await saveCatalogToCache(getSeedCatalog());
    arrange();
    storageFault.failNextSet = true;
    const result = await syncGlobalCatalog({} as never);
    expect(result.updated).toBe(true);
    expect(result.persisted).toBe(false);
    expect((await getCachedCatalog()).exercises.map(item => item.id)).toEqual(['a']);
    // A fresh module has no in-memory copy. The failed IDB write must not
    // masquerade as durable data after restart.
    vi.resetModules();
    const restarted = await import('../../src/lib/catalog/catalogService');
    const offline = await restarted.getCachedCatalog();
    expect(offline.exercises).toEqual(getSeedCatalog().exercises);
    expect(offline.manifest.version).toBe(getSeedCatalog().manifest.version);
});
