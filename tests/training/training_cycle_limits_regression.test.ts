import { describe, expect, it } from 'vitest';
import { UserDataSchema, TrainingCycleSchema, TrainingCycleWriteSchema } from '../../src/lib/schema';
import { applyDomainOperations } from '../../src/lib/sync/domainOperations';
import { calculateCycleSchedule, calculateCycleTimeline } from '../../src/lib/calc/planning';
import { getCycleVolumeFrequencies, hasValidCycleWriteFrequencies, isBoundedCycleCount, isRepresentableCycleVolume, previewCycleCount, MAX_EDITABLE_CYCLE_WEEKS, MAX_CYCLE_SESSIONS_PER_WEEK } from '../../src/lib/calc/cycleLimits';
import type { TrainingCycle, UserData, WorkoutRoutine } from '../../src/types';

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

    it('rejects malformed raw write values before permissive Zod fallbacks and sanitizers', () => {
        for (const mutation of [
            { durationWeeks: 'invalid' },
            { durationWeeks: undefined },
            { sessionsPerWeek: 'wrong' },
            { sessionsPerWeek: NaN },
            { routines: [{ routineId: 'r', frequencyPerWeek: 'bad' }] },
            { routines: [{ routineId: 'r', frequencyPerWeek: undefined }, { routineId: 'r', frequencyPerWeek: 1 }] },
            { routines: 'not-an-array' },
            { routines: [{ routineId: '', frequencyPerWeek: 1 }] },
            { id: '' },
        ]) {
            const raw = { ...cycle, ...mutation };
            const before = structuredClone(raw);
            expect(TrainingCycleWriteSchema.safeParse(raw).success).toBe(false);
            expect(raw).toEqual(before);
        }
        expect(TrainingCycleWriteSchema.safeParse(cycle).success).toBe(true);
        expect(TrainingCycleSchema.parse({ ...cycle, durationWeeks: 'invalid' }).durationWeeks).toBe(4);
    });

    it('rejects invalid routine frequencies in both cycle and individual-routine writes', () => {
        const base = UserDataSchema.parse({ trainingCycles: [cycle] }) as UserData;
        const before = structuredClone(base);
        for (const bad of [0, -1, 1.5, 15, NaN, Infinity, null, 'not-a-number']) {
            const frequencyPerWeek = bad as number;
            const badCycle = { ...cycle, routines: [{ routineId: 'r', frequencyPerWeek }] };
            expect(() => applyDomainOperations(base, {
                type: 'training-cycle.upsert', cycle: badCycle,
            })).toThrow(/Frequenza routine ciclo non valida/);
            expect(() => applyDomainOperations(base, {
                type: 'training-cycle-routine.upsert', cycleId: cycle.id,
                routine: { routineId: 'r', frequencyPerWeek },
            })).toThrow(/Frequenza routine ciclo non valida/);
        }
        expect(base).toEqual(before);

        const valid = applyDomainOperations(base, {
            type: 'training-cycle-routine.upsert', cycleId: cycle.id,
            routine: { routineId: 'r', frequencyPerWeek: 14 },
        });
        expect(valid.trainingCycles?.[0]?.routines[0].frequencyPerWeek).toBe(14);
        expect(base).toEqual(before);
    });

    it('rejects implicit schedules above fourteen sessions while retaining tolerant reads', () => {
        const base = UserDataSchema.parse({}) as UserData;
        const noExplicitSchedule = {
            ...cycle, sessionsPerWeek: undefined,
            routines: [{ routineId: 'r', frequencyPerWeek: 14 }, { routineId: 'r2', frequencyPerWeek: 1 }],
        };
        expect(() => applyDomainOperations(base, { type: 'training-cycle.upsert', cycle: noExplicitSchedule }))
            .toThrow(/Frequenza routine ciclo non valida/);
        expect(TrainingCycleWriteSchema.safeParse(noExplicitSchedule).success).toBe(false);

        const stored = TrainingCycleSchema.parse(noExplicitSchedule);
        expect(stored.routines).toHaveLength(2);
        const existing = UserDataSchema.parse({ trainingCycles: [{
            ...noExplicitSchedule, routines: [{ routineId: 'r', frequencyPerWeek: 14 }],
        }] }) as UserData;
        expect(() => applyDomainOperations(existing, {
            type: 'training-cycle-routine.upsert', cycleId: cycle.id,
            routine: { routineId: 'r2', frequencyPerWeek: 1 },
        })).toThrow(/Frequenza routine ciclo non valida/);
        expect(existing.trainingCycles?.[0]?.routines).toHaveLength(1);
    });

    it('shares a single weekly-frequency contract between Zod and domain writes', () => {
        const base = UserDataSchema.parse({}) as UserData;
        const samples = [
            { routines: [{ routineId: 'r', frequencyPerWeek: 14 }], sessionsPerWeek: undefined, valid: true },
            { routines: [{ routineId: 'r', frequencyPerWeek: 14 }, { routineId: 's', frequencyPerWeek: 1 }], sessionsPerWeek: undefined, valid: false },
            { routines: [{ routineId: 'r', frequencyPerWeek: 14 }, { routineId: 's', frequencyPerWeek: 1 }], sessionsPerWeek: 14, valid: true },
            { routines: [{ routineId: 'r', frequencyPerWeek: 0 }], sessionsPerWeek: 3, valid: false },
            { routines: [{ routineId: 'r', frequencyPerWeek: '1' }], sessionsPerWeek: 3, valid: false },
            { routines: [{ routineId: 'r', frequencyPerWeek: null }], sessionsPerWeek: 3, valid: false },
        ];
        for (const { routines, sessionsPerWeek, valid } of samples) {
            const input = { ...cycle, routines, sessionsPerWeek };
            expect(hasValidCycleWriteFrequencies(routines, sessionsPerWeek)).toBe(valid);
            expect(TrainingCycleWriteSchema.safeParse(input).success).toBe(valid);
            if (valid) {
                expect(applyDomainOperations(base, { type: 'training-cycle.upsert', cycle: input as unknown as TrainingCycle }).trainingCycles)
                    .toHaveLength(1);
            } else {
                expect(() => applyDomainOperations(base, { type: 'training-cycle.upsert', cycle: input as unknown as TrainingCycle }))
                    .toThrow(/Frequenza routine ciclo non valida/);
            }
        }
        expect(base.trainingCycles).toHaveLength(0);
    });

    it('preserves the default weekly frequency before strict validation and after domain writes', () => {
        const base = UserDataSchema.parse({ trainingCycles: [{ ...cycle, routines: [] }] }) as UserData;
        const before = structuredClone(base);
        for (const item of [{ routineId: 'r' }, { routineId: 'r', frequencyPerWeek: undefined }]) {
            const input = { ...cycle, sessionsPerWeek: undefined, routines: [item] };
            const source = structuredClone(input);
            expect(hasValidCycleWriteFrequencies(input.routines, input.sessionsPerWeek)).toBe(true);
            const parsed = TrainingCycleWriteSchema.parse(input);
            expect(parsed.routines[0].frequencyPerWeek).toBe(1);
            // Domain operations consume the normalized routine type, whose frequency is required.
            const created = applyDomainOperations(base, { type: 'training-cycle.upsert', cycle: parsed });
            expect(created.trainingCycles?.[0].routines[0].frequencyPerWeek).toBe(1);
            const updated = applyDomainOperations(base, {
                type: 'training-cycle-routine.upsert', cycleId: cycle.id, routine: parsed.routines[0],
            });
            expect(updated.trainingCycles?.[0].routines[0].frequencyPerWeek).toBe(1);
            expect(input).toEqual(source);
            expect(base).toEqual(before);
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

    it('checks exact cycle count boundaries independently of the editor or persistence', () => {
        expect(isBoundedCycleCount(1, MAX_CYCLE_SESSIONS_PER_WEEK)).toBe(true);
        expect(isBoundedCycleCount(14, MAX_CYCLE_SESSIONS_PER_WEEK)).toBe(true);
        for (const value of [0, -1, 15, 1.5, NaN, Infinity, '1', null, undefined]) {
            expect(isBoundedCycleCount(value, MAX_CYCLE_SESSIONS_PER_WEEK)).toBe(false);
        }
        expect(previewCycleCount('1', 4, MAX_EDITABLE_CYCLE_WEEKS)).toBe(1);
        expect(previewCycleCount('0', 4, MAX_EDITABLE_CYCLE_WEEKS)).toBe(4);
    });

    it('scales valid weekly frequencies without changing their proportions', () => {
        expect(getCycleVolumeFrequencies([
            { frequencyPerWeek: 1 }, { frequencyPerWeek: 2 },
        ], 6)).toEqual({ sessionsPerWeek: 6, frequencies: [2, 4] });
        expect(getCycleVolumeFrequencies([
            {}, { frequencyPerWeek: 2 },
        ], undefined)).toEqual({ sessionsPerWeek: 3, frequencies: [1, 2] });
        expect(getCycleVolumeFrequencies([
            { frequencyPerWeek: 1 }, { frequencyPerWeek: 1 },
        ], 1)).toEqual({ sessionsPerWeek: 1, frequencies: [0.5, 0.5] });
    });

    it('refuses empty, malformed, excessive or unsafe weekly schedules', () => {
        expect(getCycleVolumeFrequencies([], 1)).toBeNull();
        for (const frequencyPerWeek of [0, -1, 1.5, NaN, Infinity]) {
            expect(getCycleVolumeFrequencies([
                { frequencyPerWeek: 2 }, { frequencyPerWeek },
            ], 4)).toBeNull();
        }
        for (const sessions of [0, -1, 1.5, 15, Infinity]) {
            expect(getCycleVolumeFrequencies([{ frequencyPerWeek: 2 }], sessions)).toBeNull();
        }
        expect(getCycleVolumeFrequencies([{ frequencyPerWeek: 15 }], undefined)).toBeNull();
        expect(getCycleVolumeFrequencies([
            { frequencyPerWeek: Number.MAX_SAFE_INTEGER }, { frequencyPerWeek: 1 },
        ], 4)).toBeNull();
    });

    it('keeps fractional and exact-boundary volumes but refuses negative or unrepresentable estimates', () => {
        for (const value of [0, -0, 0.5, 1, Number.MAX_SAFE_INTEGER]) {
            expect(isRepresentableCycleVolume(value)).toBe(true);
        }
        for (const value of [-Number.EPSILON, -1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity]) {
            expect(isRepresentableCycleVolume(value)).toBe(false);
        }
    });

});
