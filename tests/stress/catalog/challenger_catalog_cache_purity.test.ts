import { beforeEach, describe, expect, it } from 'vitest';
import { clearCatalogCache, getSeedCatalog, getCachedCatalog, getInMemoryCatalog, saveCatalogToCache } from '../../../src/lib/catalog/catalogService';
import { resolveEffectiveExercises } from '../../../src/lib/catalog/deltaResolver';
import type { CatalogExercise, CatalogFood, CachedGlobalCatalog } from '../../../src/types';

describe('Catalog adversarial: concurrent cache access and input isolation', () => {
    beforeEach(async () => { await clearCatalogCache(); });

    describe('4. Concurrency & Async State Race Condition Stress Tests', () => {
        it('handles multiple concurrent calls to getCachedCatalog() and getInMemoryCatalog() without state corruption', async () => {
            await clearCatalogCache();

            // Inject a local fixture catalog so the concurrency test has non-trivial data to work with.
            // seedExercises.json is intentionally empty (commit e61a133); the real-world catalog
            // is fetched from Firestore and stored here. This fixture simulates that state.
            const fixtureExercises: CatalogExercise[] = Array.from({ length: 60 }, (_, i) => ({
                id: `fixture-ex-${i}`,
                name: `Fixture Exercise ${i}`,
                muscles: ['chest'],
                trackingType: 'weight_reps' as const,
                isDefault: true,
                setsCount: 3
            }));
            const fixtureFoods: CatalogFood[] = Array.from({ length: 60 }, (_, i) => ({
                id: `fixture-food-${i}`,
                name: `Fixture Food ${i}`,
                kcal: 100 + i,
                pro: 10,
                carbs: 20,
                fat: 2,
                isCustom: false
            }));
            const fixtureCatalog: CachedGlobalCatalog = {
                manifest: {
                    version: '1.0.0',
                    updatedAt: '2026-08-22T00:00:00.000Z',
                    schemaVersion: 1,
                    docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' },
                    itemCounts: { exercises: fixtureExercises.length, foods: fixtureFoods.length },
                },
                exercises: fixtureExercises,
                foods: fixtureFoods,
                cachedAt: Date.now(),
            };
            expect(await saveCatalogToCache(fixtureCatalog)).toBe(true);

            const promises: Promise<CachedGlobalCatalog>[] = [];
            const syncResults: (CachedGlobalCatalog | null)[] = [];

            for (let i = 0; i < 50; i++) {
                promises.push(getCachedCatalog());
                syncResults.push(getInMemoryCatalog());
            }

            const asyncResults = await Promise.all(promises);

            const exerciseIds = fixtureExercises.map(item => item.id);
            const foodIds = fixtureFoods.map(item => String(item.id));
            expect(asyncResults).toHaveLength(50);
            expect(syncResults).toHaveLength(50);
            // Both APIs must return the identities and order that were persisted,
            // not merely arrays with plausible lengths.
            for (const catalog of [...asyncResults, ...syncResults]) {
                expect(catalog).not.toBeNull();
                expect(catalog?.manifest.itemCounts).toEqual({ exercises: 60, foods: 60 });
                expect(catalog?.exercises.map(item => item.id)).toEqual(exerciseIds);
                expect(catalog?.foods.map(item => String(item.id))).toEqual(foodIds);
            }
        });

        it('keeps the empty bundled seed isolated and does not mutate a nonempty catalog source', () => {
            const seed1 = getSeedCatalog();
            // Empty bundled seeds are the approved baseline, not a meaningful
            // fixture for testing reference isolation of a populated catalog.
            expect(seed1.manifest.itemCounts).toEqual({ exercises: 0, foods: 0 });
            expect(seed1.exercises).toEqual([]);
            expect(seed1.foods).toEqual([]);

            const globals: CatalogExercise[] = [{
                id: 'source-bench', name: 'Source bench', muscles: ['chest'],
                trackingType: 'weight_reps', isDefault: true,
            }];
            const original = structuredClone(globals);
            const resolved = resolveEffectiveExercises(globals, []);
            expect(resolved).toHaveLength(1);
            resolved[0].name = 'DIRTY MUTATION';
            resolved[0].muscles?.push('quads');
            resolved.push({ id: 'extra-ex', name: 'Injected', setsCount: 3, sets: [] });

            expect(globals).toEqual(original);
            expect(resolveEffectiveExercises(globals, []).map(item => [item.id, item.name, item.muscles]))
                .toEqual([['source-bench', 'Source bench', ['chest']]]);

            const seed2 = getSeedCatalog();
            expect(seed2.manifest.itemCounts).toEqual({ exercises: 0, foods: 0 });
            expect(seed2.exercises).toEqual(seed1.exercises);
            expect(seed2.foods).toEqual(seed1.foods);
            expect(seed2.exercises).not.toBe(seed1.exercises);
            expect(seed2.foods).not.toBe(seed1.foods);
        });
    });

    // -------------------------------------------------------------------------
    // 5. Complex Legacy Migration Scenarios
    // -------------------------------------------------------------------------
});
