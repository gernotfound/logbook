import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/telemetryHub', () => ({
    telemetryHub: { trackError: vi.fn() },
}));

import { prepareImport } from '../../src/lib/backup';
import { UserDataSchema } from '../../src/lib/schema';
import { commitLocal, initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import type { UserData } from '../../src/types';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    await clear();
    vi.restoreAllMocks();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    await createAndMigrateVault('user:a');
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
});

it('does not convert device snapshot omissions into monthly journal removals', async () => {
    const base = parse({
        profile: { height: '170' },
        history: [{ id: 'old-workout', date: '2024-01-10' }],
        nutrition: { '2024-01-10': { date: '2024-01-10', weight: 70 } },
    });
    const incoming = parse({
        profile: { height: '171' },
        history: [],
        nutrition: {},
    });
    const restored = prepareImport(
        base,
        incoming as unknown as Record<string, unknown>,
        'restore',
        { scope: 'device', months: [] },
    ).data;

    await initializeLocal('a', base);
    const operations = await commitLocal('a', restored, base);
    const stored = await readLocal('a');
    expect(await get('logbook:v2:user:a')).toMatch(/^tlb-sealed:v1:/);

    expect(stored?.data.history?.map(item => item.id)).toContain('old-workout');
    expect(stored?.data.nutrition?.['2024-01-10']?.weight).toBe(70);
    expect(operations.some(op => op.docPath === 'history_months/2024-01' && op.isDelete)).toBe(false);
    expect(operations.some(op => op.docPath === 'nutrition_months/2024-01' && op.isDelete)).toBe(false);
});
