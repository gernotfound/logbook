import { describe, expect, it } from 'vitest';
import { createPostSessionDraft, parsePostSessionRecovery } from './postSessionDraft';

const draft = {
    workoutId: 'workout-a',
    mood: '5',
    pump: '4',
    fatigue: '2',
    water: '1.5',
    pains: ['shoulders'],
};

describe('post-session device draft data contract', () => {
    it('copies ratings and the pains array from the current workout', () => {
        const pains = ['shoulders'];
        const result = createPostSessionDraft({
            id: 'workout-a',
            exercises: [],
            moodRating: 0,
            pumpRating: 5,
            fatigueRating: null,
            waterLiters: 1.5,
            pains,
        });
        expect(result).toEqual({
            workoutId: 'workout-a',
            mood: '0',
            pump: '5',
            fatigue: '',
            water: '1.5',
            pains: ['shoulders'],
        });
        expect(result.pains).not.toBe(pains);
    });

    it('reads the unchanged device format and copies mutable pains', () => {
        const raw = { pendingEndTime: 1250, draft };
        const result = parsePostSessionRecovery(raw, 'workout-a');
        expect(result).toEqual(raw);
        expect(result?.draft).not.toBe(draft);
        expect(result?.draft.pains).not.toBe(draft.pains);
        expect(parsePostSessionRecovery(null, 'workout-a')).toBeNull();
        expect(parsePostSessionRecovery({ draft }, 'workout-a')?.pendingEndTime).toBeNull();
    });

    it('rejects a draft for another workout without adopting it', () => {
        expect(() => parsePostSessionRecovery({ pendingEndTime: 1250, draft }, 'workout-b'))
            .toThrow(/workout diverso/);
    });

    it('rejects malformed pain values, ratings and nonfinite end times', () => {
        expect(() => parsePostSessionRecovery({ draft: { ...draft, pains: ['ok', 12] } }, 'workout-a'))
            .toThrow(/corrotta/);
        expect(() => parsePostSessionRecovery({ draft: { ...draft, mood: 5 } }, 'workout-a'))
            .toThrow(/non valida/);
        expect(() => parsePostSessionRecovery({ pendingEndTime: Number.POSITIVE_INFINITY, draft }, 'workout-a'))
            .toThrow(/Timestamp/);
    });
});
