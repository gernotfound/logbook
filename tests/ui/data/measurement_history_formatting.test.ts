import { describe, expect, it } from 'vitest';
import { hasMeasurementData } from '../../../src/lib/nutrition/measurementPresence';
import {
    finiteAverage,
    hasFiniteValue,
    hasMeasurementData as hasHistoryMeasurementData,
    recordSummary,
} from '../../../src/components/Data/dataHistoryFormatting';

describe('measurement history: one presence contract, safe numerical display', () => {
    it('shares the exact meaning of a recorded measurement across editor and history', () => {
        const zero = { date: '2026-11-20', weight: 0 };
        const sleepOnly = { date: '2026-11-20', sleepHours: '07:30' };
        const unrecognized = { date: '2026-11-20', weight: ' ' };
        expect(hasHistoryMeasurementData).toBe(hasMeasurementData);
        expect(hasMeasurementData(zero)).toBe(true);
        expect(hasMeasurementData(sleepOnly)).toBe(false);
        expect(hasMeasurementData(undefined)).toBe(false);
        // A malformed entry must remain discoverable, not disappear as an empty record.
        expect(hasMeasurementData(unrecognized)).toBe(true);
    });

    it('rejects empty-looking or non-finite numbers while retaining zero and decimal strings', () => {
        for (const value of [undefined, null, '', '  ', '\t', Number.NaN, Infinity, '-Infinity']) {
            expect(hasFiniteValue(value)).toBe(false);
        }
        expect(hasFiniteValue(0)).toBe(true);
        expect(hasFiniteValue('0')).toBe(true);
        expect(hasFiniteValue('81.5')).toBe(true);
    });

    it('calculates the monthly mean without overflow from valid finite samples', () => {
        const day1 = { date: '2026-11-19', weight: Number.MAX_VALUE };
        const day2 = { date: '2026-11-20', weight: Number.MAX_VALUE };
        expect(finiteAverage([day1, day2], 'weight')).toBe(Number.MAX_VALUE);
        expect(finiteAverage([day1, { date: '2026-11-20', weight: -Number.MAX_VALUE }], 'weight')).toBe(0);
        expect(finiteAverage([{ date: '2026-11-20', weight: ' ' }], 'weight')).toBeNull();
        expect(finiteAverage([{ date: '2026-11-20', weight: 0 }], 'weight')).toBe(0);
    });

    it('does not print a misleading sleep label for an invalid time value', () => {
        expect(recordSummary({ date: '2026-11-20', sleepHours: 'invalid' })).toBe('Dati registrati');
        expect(recordSummary({ date: '2026-11-20', sleepHours: '07:30' })).toBe('Sonno 07:30');
    });
});
