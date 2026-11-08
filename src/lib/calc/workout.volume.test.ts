import { describe, expect, it } from 'vitest';
import { calculateEffectiveSetWeight, calculateSetVolume, calculateWorkoutVolume } from './workout';

describe('observed mechanical volume', () => {
    it('rejects partial or fractional repetitions instead of silently rounding them down', () => {
        expect(calculateSetVolume({ kg: '50', reps: '8reps' })).toBe(0);
        expect(calculateSetVolume({ kg: '50', reps: '8.5' })).toBe(0);
        expect(calculateSetVolume({ kg: '50', reps: '-2' })).toBe(-100);
        expect(calculateSetVolume({ kg: '50', reps: '8' })).toBe(400);
    });

    it('excludes invalid continuation repetitions without losing valid set volume', () => {
        const workoutSet = {
            kg: '50', reps: '8',
            segments: [
                { id: 'invalid', technique: 'dropset' as const, kg: '40', reps: '2.5' },
                { id: 'valid', technique: 'dropset' as const, kg: '30', reps: '3' },
            ],
        };
        expect(calculateSetVolume(workoutSet)).toBe(490);
    });
});

describe('finite workout mechanical volume', () => {
    it('preserves signed and decimal loads but never accepts a numeric prefix or Infinity', () => {
        expect(calculateEffectiveSetWeight('12,5')).toBe(12.5);
        expect(calculateEffectiveSetWeight('-20', { isBodyweight: true }, 80)).toBe(60);
        expect(calculateEffectiveSetWeight('40kg')).toBe(0);
        expect(calculateEffectiveSetWeight('8oops')).toBe(0);
        expect(calculateEffectiveSetWeight('Infinity')).toBe(0);
        expect(calculateEffectiveSetWeight(Number.POSITIVE_INFINITY)).toBe(0);
        expect(calculateEffectiveSetWeight(10, { isBodyweight: true }, Number.POSITIVE_INFINITY)).toBe(10);
        expect(calculateEffectiveSetWeight(10, { equipmentWeight: Number.POSITIVE_INFINITY })).toBe(10);
    });

    it('ignores malformed continuation loads while preserving correct work', () => {
        const set = {
            kg: '50', reps: '8',
            segments: [
                { id: 'invalid', technique: 'dropset' as const, kg: '1e309', reps: '5' },
                { id: 'valid', technique: 'dropset' as const, kg: '30', reps: '3' },
            ],
        };
        expect(calculateSetVolume(set)).toBe(490);
        expect(calculateSetVolume({ kg: Number.MAX_VALUE, reps: '2' })).toBe(Infinity);
    });

    it('retains valid sets alongside malformed loads and non-array collections', () => {
        const session = {
            exercises: [
                { exId: 'bad', sets: {} },
                { exId: 'bench', sets: [
                    { kg: 'Infinity', reps: '2' },
                    { kg: '50', reps: '8' },
                ] },
            ],
        } as unknown as Parameters<typeof calculateWorkoutVolume>[0];
        expect(calculateWorkoutVolume(session)).toBe(400);
        // Analytics filters this mathematical overflow at its own boundary.
        expect(calculateWorkoutVolume({ exercises: [
            { exId: 'big', sets: [{ kg: '1e308', reps: '10' }] },
        ] })).toBe(Infinity);
    });
});
