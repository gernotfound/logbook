import { beforeEach, describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData, WorkoutSession } from '../../src/types';
import { assertHistoryMonthDocument, assertNutritionMonthDocument, requireCanonicalWorkoutDate } from '../../src/lib/sync/monthlyIntegrity';

const parse = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;

function workout(id: string, exerciseIds: Array<[string, string]> = []): WorkoutSession {
    return {
        id,
        date: '2026-10-03',
        exercises: exerciseIds.map(([instanceId, exId], index) => ({
            id: instanceId,
            exId,
            sessionNote: '',
            sets: [{ id: `s-${index}`, kg: '10', reps: '10' }],
        })),
    };
}

describe('Business identity and monthly temporal boundaries', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('uses one strict business-identity contract at the UserData gateway and strips unknown top-level fields', () => {
        const parsed = parse({
            routines: [
                { id: 'bad/id', name: 'Bad', exercises: [] },
                { id: 'undefined', name: 'Bad sentinel', exercises: [] },
                { id: 'ok', name: 'Good', exercises: [] },
            ],
            extension: { shadow: true },
        });

        expect(parsed.routines?.map(item => item.id)).toEqual(['ok']);
        expect(parsed).not.toHaveProperty('extension');
    });

    it('enforces path/key/embedded temporal identity for monthly shards and forbids implicit today fallback', () => {
        expect(() => assertHistoryMonthDocument('2026-09', {
            'w-1': workout('w-1'),
        })).toThrow(/appartiene a 2026-10/i);

        expect(() => assertNutritionMonthDocument('2026-10', {
            '2026-10-03': { date: '2026-10-04', kcal: 0, carbs: 0, pro: 0, fat: 0 },
        })).toThrow(/diversa da day.date/i);

        expect(() => requireCanonicalWorkoutDate({})).toThrow(/identità temporale/i);
    });

    it('only derives a missing workout day from a representable start instant', () => {
        const startedAt = new Date(2026, 4, 11, 12, 0).getTime();
        expect(requireCanonicalWorkoutDate({ globalStartTime: startedAt })).toBe('2026-05-11');
        expect(requireCanonicalWorkoutDate({ date: '2026-05-11', globalStartTime: startedAt })).toBe('2026-05-11');

        for (const invalidDate of ['', '2026-02-31', '11/05/2026', '2026-05-32']) {
            expect(() => requireCanonicalWorkoutDate({ date: invalidDate, globalStartTime: startedAt }))
                .toThrow(/identità temporale non valida/i);
        }
        expect(() => requireCanonicalWorkoutDate({ globalStartTime: Number.MAX_VALUE }))
            .toThrow(/identità temporale non valida/i);
    });
});
