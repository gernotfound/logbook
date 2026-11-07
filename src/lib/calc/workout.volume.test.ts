import { describe, expect, it } from 'vitest';
import { calculateSetVolume } from './workout';

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
