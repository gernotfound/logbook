import { describe, expect, it } from 'vitest';
import { UserDataSchema, TrainingCycleSchema } from '../src/lib/schema';
import { applyDomainOperations } from '../src/lib/sync/domainOperations';
import { calculateCycleSchedule, calculateCycleTimeline } from '../src/lib/calc/planning';
import { previewCycleCount, MAX_EDITABLE_CYCLE_WEEKS, MAX_CYCLE_SESSIONS_PER_WEEK } from '../src/lib/calc/cycleLimits';
import type { TrainingCycle, UserData, WorkoutRoutine } from '../src/types';

const routine: WorkoutRoutine = { id: 'r', name: 'A', exercises: [] };
const cycle: TrainingCycle = {
    id: 'cycle-limits', name: 'Ciclo valido', durationWeeks: 52,
    sessionsPerWeek: 14, routines: [{ routineId: 'r', frequencyPerWeek: 1 }],
};

describe('training cycle bounded input and safe legacy evaluation', () => {
    it('accepts the editor boundaries and refuses out-of-range/fractional domain writes without mutating input', () => {
        const input = UserDataSchema.parse({}) as UserData;
        const after = applyDomainOperations(input, { type: 'training-cycle.upsert', cycle });
        expect(after.trainingCycles?.[0]?.durationWeeks).toBe(52);
        expect(input.trainingCycles).toHaveLength(0);

        for (const invalid of [
            { durationWeeks: 0 }, { durationWeeks: 53 }, { durationWeeks: 1.5 },
            { durationWeeks: 1_000_000 }, { sessionsPerWeek: 0 },
            { sessionsPerWeek: 15 }, { sessionsPerWeek: 1.5 },
            { sessionsPerWeek: Number.POSITIVE_INFINITY },
        ]) {
            expect(() => applyDomainOperations(input, {
                type: 'training-cycle.upsert',
                cycle: { ...cycle, ...invalid },
            })).toThrow('Durata o frequenza del ciclo non valida');
            expect(input.trainingCycles).toHaveLength(0);
        }
    });

    it('bounds preview work without silently changing a saved input', () => {
        expect(previewCycleCount('1000000', 4, MAX_EDITABLE_CYCLE_WEEKS)).toBe(52);
        expect(previewCycleCount('1.5', 4, MAX_EDITABLE_CYCLE_WEEKS)).toBe(4);
        expect(previewCycleCount('15', 1, MAX_CYCLE_SESSIONS_PER_WEEK)).toBe(14);
    });

    it('keeps historical cycles readable but declines corrupt or excessive scheduling work', () => {
        const saved = TrainingCycleSchema.parse({ ...cycle, durationWeeks: 100, sessionsPerWeek: 3 });
        expect(saved.id).toBe(cycle.id);
        expect(calculateCycleSchedule(saved, [routine]).weeks).toHaveLength(100);

        for (const invalid of [
            { durationWeeks: 1_000_000 }, { durationWeeks: 2 },
            { durationWeeks: 1.5 }, { sessionsPerWeek: 1.5 },
            { sessionsPerWeek: 1_000_000 },
        ]) {
            const values = invalid.durationWeeks === 2
                ? { ...cycle, durationWeeks: 2, sessionsPerWeek: 1.5 }
                : { ...cycle, ...invalid };
            const malformed = TrainingCycleSchema.parse(values);
            expect(malformed.id).toBe(cycle.id);
            expect(calculateCycleSchedule(malformed, [routine]).weeks).toHaveLength(0);
        }
        expect(calculateCycleTimeline({ ...cycle, durationWeeks: 1_000_000 }).statusLabel)
            .toBe('Parametri del ciclo da correggere');
    });
});
