import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { DomainParsers, UserDataSchema, safeNumber, safeOptionalNumber, safeOptionalNullableNumber, NutritionDaySchema } from '../../src/lib/schema';
import { calculateCycleTimeline } from '../../src/lib/calc/planning';
import { formatSleepTime } from '../../src/lib/utils/date';
import { normalizeOnDaysCount } from '../../src/lib/nutritionDefaults';

describe('audit data regression cases', () => {
    it('preserves zero and seven ON days while defaulting only invalid or absent input', () => {
        for (const value of [0, '0', 7, '7']) expect(normalizeOnDaysCount(value)).toBe(Number(value));
        for (const value of ['', ' ', null, undefined, '4x', Infinity, NaN, 2.5, false]) expect(normalizeOnDaysCount(value)).toBe(4);
    });
    it('preserves valid collections beyond the old 500 item cutoff', () => {
        const items = Array.from({ length: 501 }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}` }));
        const parsed = UserDataSchema.parse({ library: items, routines: items, customFoods: items, trainingCycles: items, supplements: items, activePains: items.map(i => i.id) });
        for (const name of ['library', 'routines', 'customFoods', 'trainingCycles', 'supplements', 'activePains'] as const) expect(parsed[name]).toHaveLength(501);
    });
    it('retains valid numeric food identifiers including zero', () => {
        expect(DomainParsers.parseCustomFoods([{ id: 0, name: 'A' }, { id: 123, name: 'B' }]).map(f => f.id)).toEqual([0, 123]);
    });
    it.each([Infinity, -Infinity, NaN, 'Infinity', '-Infinity', 'NaN'])('never returns non-finite numbers for %s', value => {
        expect(safeNumber(4).parse(value)).toBe(4);
        expect(safeOptionalNumber().parse(value)).toBeUndefined();
        expect(safeOptionalNullableNumber().parse(value)).toBeNull();
    });
    it('migrates legacy decimal sleep without discarding zero', () => {
        expect(formatSleepTime(7.5)).toBe('07:30');
        expect(formatSleepTime('7,5')).toBe('07:30');
        expect(formatSleepTime(0)).toBe('00:00');
        expect(NutritionDaySchema.parse({ sleepHours: 7.5 }).sleepHours).toBe('07:30');
    });
    it('honors the explicit cycle end even if durationWeeks is stale', () => {
        const cycle = { id: 'c', name: 'Ciclo', startDate: '2026-09-01', endDate: '2026-09-10', durationWeeks: 1, routines: [] };
        expect(calculateCycleTimeline(cycle, '2026-09-08')).toMatchObject({ totalWeeks: 2, currentWeek: 2, isEnded: false, daysRemaining: 2 });
        expect(calculateCycleTimeline(cycle, '2026-09-10').isEnded).toBe(false);
        expect(calculateCycleTimeline(cycle, '2026-09-11').isEnded).toBe(true);
    });
});
