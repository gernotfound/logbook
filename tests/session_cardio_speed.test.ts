import { describe, expect, it } from 'vitest';
import { deriveCardioSpeed } from '../src/components/Training/session/deriveCardioSpeed';

describe('session cardio speed calculation', () => {
    it('updates speed from duration with the saved distance, preserving two decimals', () => {
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'time', '20')).toBe('15.00');
    });

    it('accepts decimal commas without changing the saved input format', () => {
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'distance', '5,5')).toBe('11.00');
        expect(deriveCardioSpeed({ time: '30', distance: '5,5' }, 'time', '33')).toBe('10.00');
    });

    it('clears speed when a duration or distance is erased', () => {
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'time', '')).toBe('');
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'distance', '')).toBe('');
    });

    it('leaves the current speed unchanged when incomplete values cannot calculate it', () => {
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'time', 'zero')).toBeUndefined();
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'time', '0')).toBeUndefined();
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'distance', 'five')).toBeUndefined();
    });

    it('keeps the established representation of zero distance', () => {
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'distance', '0')).toBe('0.00');
    });

    it('refuses malformed pasted values, negatives and non-finite metrics instead of saving bogus speeds', () => {
        const previous = { time: '30', distance: '5' };
        expect(deriveCardioSpeed(previous, 'distance', '5km')).toBeUndefined();
        expect(deriveCardioSpeed(previous, 'distance', '-5')).toBeUndefined();
        expect(deriveCardioSpeed(previous, 'distance', 'Infinity')).toBeUndefined();
        expect(deriveCardioSpeed(previous, 'time', '-20')).toBeUndefined();
        expect(deriveCardioSpeed(previous, 'time', '20min')).toBeUndefined();
        expect(deriveCardioSpeed(previous, 'time', '0,0')).toBeUndefined();
        expect(deriveCardioSpeed(previous, 'distance', '2,5.0')).toBeUndefined();
    });

    it('retains partial decimal entry formats without accepting junk suffixes', () => {
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'distance', ',5')).toBe('1.00');
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'distance', '5,')).toBe('10.00');
        expect(deriveCardioSpeed({ time: '30', distance: '5' }, 'time', ' 15 ')).toBe('20.00');
    });
});
