import { describe, expect, it } from 'vitest';
import { formatDuration, normalizeDuration, parseManualDuration } from '../../../src/lib/utils/duration';
import {
    formatDuration as legacyFormatDuration,
    normalizeDuration as legacyNormalizeDuration,
    parseManualDuration as legacyParseManualDuration,
} from '../../../src/lib/utils/date';

describe('workout duration utility boundary', () => {
    it('retains strict parsing for user-edited historical workout durations', () => {
        expect(parseManualDuration('75 min')).toBe('01:15:00');
        expect(parseManualDuration('1:02:03')).toBe('01:02:03');
        expect(parseManualDuration('2:30')).toBe('00:02:30');
        expect(parseManualDuration('')).toBe('00:00:00');
        for (const invalid of ['1:60', '1:02:60', '1.5', 'bad', '-1', '9007199254740993']) {
            expect(parseManualDuration(invalid)).toBeNull();
        }
    });

    it('keeps the intentionally permissive normalization separate from strict validation', () => {
        expect(normalizeDuration('75 min')).toBe('01:15:00');
        expect(normalizeDuration('1:02')).toBe('00:01:02');
        expect(normalizeDuration('bad')).toBe('00:00:00');
        expect(parseManualDuration('bad')).toBeNull();
    });

    it('formats seconds or milliseconds using the same HH:MM:SS contract', () => {
        expect(formatDuration(3661)).toBe('01:01:01');
        expect(formatDuration(62000, true)).toBe('00:01:02');
        expect(formatDuration(-30)).toBe('00:00:00');
    });

    it('preserves the existing date utility exports for unchanged call sites', () => {
        expect(legacyFormatDuration).toBe(formatDuration);
        expect(legacyNormalizeDuration).toBe(normalizeDuration);
        expect(legacyParseManualDuration).toBe(parseManualDuration);
    });
});
