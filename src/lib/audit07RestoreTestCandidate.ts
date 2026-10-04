import { expect, it, vi } from 'vitest';

vi.mock('../../src/lib/telemetryHub', () => ({
    telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() },
}));

import { createBackup, decodeImport, prepareImport } from '../../src/lib/backup';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

it('requires valid coverage metadata', () => {
    const base = createBackup(parse({}), 'guest') as any;
    expect(() => decodeImport({ ...base, coverage: undefined }, 'guest')).toThrow(/Coverage/);
    expect(() => decodeImport({ ...base, coverage: { scope: 'device', months: ['2026-13'] } }, 'guest')).toThrow(/Coverage/);
});

it('preserves local monthly entries not present in a device snapshot', () => {
    const current = parse({
        history: [
            { id: 'old-only', date: '2024-01-10' },
            { id: 'shared', date: '2026-09-03', routineName: 'Local version' },
        ],
        nutrition: {
            '2024-01-10': { date: '2024-01-10', weight: 70 },
            '2026-09-03': { date: '2026-09-03', weight: 72 },
        },
    });
    const incoming = parse({
        history: [{ id: 'shared', date: '2026-09-03', routineName: 'Backup version' }],
        nutrition: { '2026-09-03': { date: '2026-09-03', weight: 80 } },
    });
    const restored = prepareImport(
        current,
        incoming as unknown as Record<string, unknown>,
        'restore',
        { scope: 'device', months: ['2026-09'] },
    ).data;

    expect(restored.history?.map(item => item.id)).toEqual(['old-only', 'shared']);
    expect(restored.history?.find(item => item.id === 'shared')?.routineName).toBe('Backup version');
    expect(restored.nutrition?.['2024-01-10']?.weight).toBe(70);
    expect(restored.nutrition?.['2026-09-03']?.weight).toBe(80);
});

it('lets complete cloud coverage replace monthly collections', () => {
    const current = parse({
        history: [{ id: 'old-only', date: '2024-01-10' }],
        nutrition: { '2024-01-10': { date: '2024-01-10', weight: 70 } },
    });
    const incoming = parse({ history: [], nutrition: {} });
    const restored = prepareImport(
        current,
        incoming as unknown as Record<string, unknown>,
        'restore',
        { scope: 'cloud-and-device', months: [] },
    ).data;

    expect(restored.history).toEqual([]);
    expect(restored.nutrition).toEqual({});
});
