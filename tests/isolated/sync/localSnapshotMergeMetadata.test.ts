import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: async () => ({ exercises: [], foods: [] }),
}));

import { UserDataSchema } from '../../../src/lib/schema';
import { mergeUserData } from '../../../src/lib/merge';
import { getNutritionConflictFingerprint } from '../../../src/lib/utils/object';
import {
    clearNutritionConflict, commitLocal, initializeLocal, readLocal, StaleLocalRevisionError,
} from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import type { LocalEnvelope } from '../../../src/lib/sync/localRepository';
import type { UserData } from '../../../src/types';

const owner = 'user:snapshot-merge';
const key = 'logbook:v2:' + owner;
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const cloud = () => parse({
    profile: { height: '170' }, nutritionPlanningOrigin: 'user-edited',
    nutritionPlanning: { avgMacros: { carbsPerKg: 3, proPerKg: 2, fatPerKg: 1 } },
});
const guest = () => parse({
    nutritionPlanningOrigin: 'user-edited',
    nutritionPlanning: { avgMacros: { carbsPerKg: 4, proPerKg: 2, fatPerKg: 1 } },
});

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    localStorage.setItem(key + ':health-consent-generation', '1');
    await createAndMigrateVault(owner);
    await initializeLocal(owner, cloud());
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function snapshot(): Promise<LocalEnvelope> {
    const envelope = await readLocal(owner);
    if (!envelope) throw new Error('Missing snapshot merge fixture');
    return envelope;
}

describe('explicit local metadata in a bulk snapshot commit', () => {
    it('persists a metadata-only merge without inventing a cloud sequence and preserves a repeated no-op', async () => {
        const before = await snapshot();
        const merged = mergeUserData(before.data, guest());
        expect(merged.pendingConflicts?.nutritionPlanning?.avgMacros?.carbsPerKg).toBe(4);
        const operations = await commitLocal(owner, merged, before.data, undefined, before.revision,
            { pendingConflicts: merged.pendingConflicts });
        expect(operations).toEqual([]);
        const after = await snapshot();
        expect(after.data.pendingConflicts).toEqual(merged.pendingConflicts);
        expect(after.data.nutritionPlanning?.avgMacros?.carbsPerKg).toBe(3);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.actorSeq).toBe(before.actorSeq);
        expect(after.clock).toEqual(before.clock);
        expect(after.pending).toEqual(before.pending);
        expect(after.revision).toBe(before.revision + 1);

        const ciphertext = await get(key);
        await commitLocal(owner, after.data, after.data, undefined, after.revision,
            { pendingConflicts: after.data.pendingConflicts });
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(after);
    });

    it('rejects a metadata merge whose preview was invalidated by another local edit', async () => {
        const before = await snapshot();
        const merged = mergeUserData(before.data, guest());
        const edited = parse({ ...before.data, profile: { height: '171' } });
        await commitLocal(owner, edited, before.data);
        const concurrent = await snapshot();
        const ciphertext = await get(key);

        await expect(commitLocal(owner, merged, before.data, undefined, before.revision,
            { pendingConflicts: merged.pendingConflicts })).rejects.toBeInstanceOf(StaleLocalRevisionError);
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(concurrent);
    });

    it('requires the revision proof before accepting explicit local metadata', async () => {
        const before = await snapshot();
        const merged = mergeUserData(before.data, guest());
        const ciphertext = await get(key);
        await expect(commitLocal(owner, merged, before.data, undefined, undefined,
            { pendingConflicts: merged.pendingConflicts })).rejects.toThrow('richiede una revisione verificata');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('does not resurrect a resolved alternative through an ordinary stale snapshot', async () => {
        const before = await snapshot();
        const merged = mergeUserData(before.data, guest());
        await commitLocal(owner, merged, before.data, undefined, before.revision,
            { pendingConflicts: merged.pendingConflicts });
        const captured = await snapshot();
        const fingerprint = getNutritionConflictFingerprint(captured.data.pendingConflicts?.nutritionPlanning);
        await clearNutritionConflict(owner, fingerprint);
        const edited = parse({ ...captured.data, profile: { height: '180' } });

        await commitLocal(owner, edited, captured.data);
        const after = await snapshot();
        expect(after.data.profile?.height).toBe('180');
        expect(after.data.pendingConflicts?.nutritionPlanning).toBeUndefined();
        expect(after.pending.length).toBeGreaterThan(0);
    });
});
