import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import {
  clearCatalogCache,
  getCachedCatalog,
  getSeedCatalog,
  saveCatalogToCache,
  syncGlobalCatalog,
} from '../src/lib/catalog/catalogService';

describe('Global catalog hydration timeout', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await clearCatalogCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('shares the timeout between manifest and document reads without replacing the valid offline cache', async () => {
    const cached = getSeedCatalog();
    await saveCatalogToCache(cached);
    const newManifest = {
      ...cached.manifest,
      version: 'remote-v2',
      docRefs: { exercises: 'exercises_v2', foods: 'foods_v2' },
    };

    vi.useFakeTimers();
    vi.mocked(getDoc)
      .mockImplementationOnce(async () => {
        await new Promise(resolve => setTimeout(resolve, 600));
        return { exists: () => true, data: () => newManifest } as any;
      })
      .mockImplementationOnce(() => new Promise<Awaited<ReturnType<typeof getDoc>>>(() => {}))
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ items: [] }) } as any);

    const settled = vi.fn();
    const sync = syncGlobalCatalog({} as any, { timeoutMs: 1000 }).then(settled);

    await vi.advanceTimersByTimeAsync(1100);
    expect(getDoc).toHaveBeenCalledTimes(3);
    expect(settled).toHaveBeenCalledWith({
      catalog: cached,
      updated: false,
    });
    await sync;
    expect(await getCachedCatalog()).toEqual(cached);
  });

  it('uses the existing cached catalog offline without starting a Firestore read', async () => {
    const cached = getSeedCatalog();
    await saveCatalogToCache(cached);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    const result = await syncGlobalCatalog({} as any);
    expect(result.catalog).toEqual(cached);
    expect(result.updated).toBe(false);
    expect(getDoc).not.toHaveBeenCalled();
  });
});
