import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/telemetryHub', () => ({
    telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() },
}));

import { prepareImport } from '../../src/lib/backup';
import { UserDataSchema } from '../../src/lib/schema';
import { commitLocal, initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import type { UserData } from '../../src/types';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

beforeEach(async () => {
    await clear();
    vi.restoreAllMocks();
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

    expect(stored?.data.history?.map(item => item.id)).toContain('old-workout');
    expect(stored?.data.nutrition?.['2024-01-10']?.weight).toBe(70);
    expect(operations.some(op => op.docPath === 'history_months/2024-01' && op.isDelete)).toBe(false);
    expect(operations.some(op => op.docPath === 'nutrition_months/2024-01' && op.isDelete)).toBe(false);
});
