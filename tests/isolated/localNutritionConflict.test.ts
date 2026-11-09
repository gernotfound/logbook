import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { UserDataSchema } from '../../src/lib/schema';
import {
    clearNutritionConflict, commitLocal, initializeLocal, readLocal,
} from '../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../src/lib/sync/localRepository';
import { getNutritionConflictFingerprint } from '../../src/lib/utils/object';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import type { CachedGlobalCatalog, UserData } from '../../src/types';

const owner = 'user:nutrition-conflict-diagnostic';
const key = 'logbook:v2:' + owner;
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'nutrition-conflict-diagnostic', updatedAt: '2026-11-09T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const firstAlternative = { onDaysCount: 4, avgMacros: { carbsPerKg: 4, proPerKg: 2, fatPerKg: 1 } };
const secondAlternative = { onDaysCount: 5, avgMacros: { carbsPerKg: 5, proPerKg: 2, fatPerKg: 1 } };
const initial = () => parse({
    profile: { height: '170' }, nutritionPlanningOrigin: 'user-edited',
    nutritionPlanning: { onDaysCount: 3, avgMacros: { carbsPerKg: 3, proPerKg: 2, fatPerKg: 1 } },
    pendingConflicts: { nutritionPlanning: firstAlternative },
});

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    localStorage.setItem(key + ':health-consent-generation', '1');
    await createAndMigrateVault(owner);
    await initializeLocal(owner, initial());
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function snapshot(): Promise<LocalEnvelope> {
    const current = await readLocal(owner);
    if (!current) throw new Error('Missing diagnostic nutrition conflict archive');
    return current;
}
const fingerprint = (data: UserData) => getNutritionConflictFingerprint(data.pendingConflicts?.nutritionPlanning);

describe('diagnostic encrypted nutrition conflict resolution', () => {
    it('clears only the chosen alternative and preserves a different baseline conflict and the pending journal', async () => {
        const seeded = await snapshot();
        const changed = parse({
            ...seeded.data, profile: { height: '171' },
            pendingConflicts: { nutritionPlanning: secondAlternative },
        });
        // Explicit bulk metadata adoption is the supported writer for a new
        // alternative; the ordinary snapshot path preserves the durable one.
        await commitLocal(owner, changed, seeded.data, undefined, seeded.revision,
            { pendingConflicts: changed.pendingConflicts });
        const before = await snapshot();
        expect(fingerprint(before.data)).not.toBe(fingerprint(before.baseline));
        expect(before.pending.length).toBeGreaterThan(0);
        const expectedData = structuredClone(before.data);
        delete expectedData.pendingConflicts;

        const saved = await clearNutritionConflict(owner, fingerprint(before.data), () => true);
        const after = await snapshot();
        expect(saved).toEqual(expectedData);
        expect(after).toEqual({ ...before, data: expectedData, revision: before.revision + 1 });
        expect(after.data).not.toHaveProperty('pendingConflicts');
        expect(after.baseline.pendingConflicts).toEqual(seeded.baseline.pendingConflicts);
        expect(await get(key)).toMatch(/^tlb-sealed:v1:/);
    });

    it('reports an already resolved conflict as stale without rewriting the encrypted archive', async () => {
        const expected = fingerprint((await snapshot()).data);
        await clearNutritionConflict(owner, expected, () => true);
        const before = await snapshot();
        const ciphertext = await get(key);

        await expect(clearNutritionConflict(owner, expected, () => true))
            .rejects.toThrow('Conflitto cambiato durante la risoluzione');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('rejects an empty fingerprint even when both the current conflict and baseline are absent', async () => {
        const expected = fingerprint((await snapshot()).data);
        await clearNutritionConflict(owner, expected, () => true);
        const before = await snapshot();
        const ciphertext = await get(key);
        expect(before.data.pendingConflicts).toBeUndefined();
        expect(before.baseline.pendingConflicts).toBeUndefined();

        await expect(clearNutritionConflict(owner, '', () => true))
            .rejects.toThrow('Conflitto cambiato durante la risoluzione');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('retains the alternative and exact journal on quota failure, then removes it once on retry', async () => {
        const seeded = await snapshot();
        await commitLocal(owner, parse({ ...seeded.data, profile: { height: '171' } }), seeded.data);
        const before = await snapshot();
        const expected = fingerprint(before.data);
        const ciphertext = await get(key);
        expect(before.pending.length).toBeGreaterThan(0);
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('Conflict quota exceeded', 'QuotaExceededError');
        });

        await expect(clearNutritionConflict(owner, expected, () => true))
            .rejects.toThrow('Conflict quota exceeded');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
        put.mockRestore();

        const saved = await clearNutritionConflict(owner, expected, () => true);
        const after = await snapshot();
        expect(saved).toEqual(after.data);
        expect(after.data.pendingConflicts).toBeUndefined();
        expect(after.baseline.pendingConflicts).toBeUndefined();
        expect(after.pending).toEqual(before.pending);
        expect(after.actorSeq).toBe(before.actorSeq);
        expect(after.clock).toEqual(before.clock);
        expect(after.revision).toBe(before.revision + 1);
    });
});
