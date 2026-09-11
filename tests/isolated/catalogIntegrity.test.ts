import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
const remote = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => collection + '/' + id, getDoc: remote.get }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { clearCatalogCache, getSeedCatalog, saveCatalogToCache, syncGlobalCatalog, getCachedCatalog } from '../../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../../src/lib/catalog/deltaResolver';
const snap = (data: unknown) => ({ exists: () => data !== undefined, data: () => data });
const exercise = { id: 'a', name: 'Omonimo', trackingType: 'weight_reps' as const };
const food = { id: '0', name: 'Omonimo', kcal: 100, pro: 0, carbs: 25, fat: 0 };
beforeEach(async () => { await clearCatalogCache(); remote.get.mockReset(); vi.stubGlobal('navigator', { onLine: true }); });
const arrange = (exercises: unknown = [exercise], foods: unknown = [food], version = '1.0.0') => {
    const manifest = { ...getSeedCatalog().manifest, version, itemCounts: { exercises: 1, foods: 1 } };
    remote.get.mockImplementation(async (path: string) => snap(path.endsWith('manifest') ? manifest : path.endsWith('exercises_v1') ? exercises === undefined ? undefined : { items: exercises } : foods === undefined ? undefined : { items: foods }));
    return manifest;
};
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
    expect((await getCachedCatalog()).exercises).toEqual(getSeedCatalog().exercises);
});
it('coalesces overlapping downloads without a late old response replacing the new catalog', async () => {
    arrange(); const [a, b] = await Promise.all([syncGlobalCatalog({} as never), syncGlobalCatalog({} as never)]);
    expect(a).toEqual(b); expect(remote.get).toHaveBeenCalledTimes(3);
});
it('preserves distinct IDs sharing a name and gives the custom identity precedence on ID collision', () => {
    const custom = { ...exercise, id: 'b', sets: [], setsCount: 3, isDefault: false };
    expect(resolveEffectiveExercises([exercise], [custom]).map(item => item.id)).toEqual(['b', 'a']);
    expect(resolveEffectiveFoods([food], [{ ...food, id: 'b', isCustom: true }]).map(item => item.id)).toEqual(['b', '0']);
    expect(resolveEffectiveFoods([food], [{ ...food, name: 'Locale', isCustom: true }])).toHaveLength(1);
    expect(resolveEffectiveFoods([food], [{ ...food, name: 'Locale', isCustom: true }])[0].name).toBe('Locale');
});
