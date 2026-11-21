import { describe, expect, it } from 'vitest';
import { TrainingCycleSchema, DomainParsers } from '../../../src/lib/schema';
import { calculateCycleVolume, getNextScheduledRoutine } from '../../../src/lib/calc/planning';
import type { TrainingCycle } from '../../../src/types';
import { sampleLibrary, sampleRoutines } from './cycleChallengerFixtures';

describe('Empirical Challenger: Cycle schemas and scheduled volume', () => {
    it('sanitizes malformed routines while retaining permitted cycle metadata and dates', () => {
        const parsed = TrainingCycleSchema.parse({
            id: 'malformed-cycle',
            name: 'Malformed cycle',
            durationWeeks: '6',
            startDate: '2026-05-01',
            endDate: '2026-06-11',
            unexpectedProperty: { hack: true },
            routines: 'not-an-array',
        });
        expect(parsed.durationWeeks).toBe(6);
        expect(parsed.startDate).toBe('2026-05-01');
        expect(parsed.endDate).toBe('2026-06-11');
        expect(parsed.routines).toEqual([]);
        expect(parsed.unexpectedProperty).toEqual({ hack: true });
    });

    describe('7. Schema & Domain Parsers Resilience', () => {
        it('DomainParsers.parseTrainingCycles sanitizes individual cycle fields and retains valid objects', () => {
            const raw = [
                {
                    id: 'c1',
                    name: 'C1',
                    durationWeeks: 4,
                    startDate: '2026-09-01',
                    endDate: '2026-09-28',
                    routines: []
                },
                {
                    id: 'c2',
                    name: 'C2',
                    durationWeeks: 8,
                    startDate: '2026-10-01',
                    endDate: { invalid: true } as unknown as string, // Object converted to undefined
                    routines: []
                },
                {
                    id: 'c3',
                    name: 'C3',
                    durationWeeks: '6', // String coerced
                    startDate: null,
                    endDate: null,
                    routines: []
                }
            ];

            const parsed = DomainParsers.parseTrainingCycles(raw);
            expect(parsed).toHaveLength(3);
            expect(parsed[0].endDate).toBe('2026-09-28');
            expect(parsed[1].endDate).toBeUndefined(); // Coerced safely from invalid object
            expect(parsed[2].endDate).toBeUndefined();
            expect(parsed[2].durationWeeks).toBe(6);
        });

        it('getNextScheduledRoutine handles cycles with startDate and endDate gracefully', () => {
            const cycle: TrainingCycle = {
                id: 'c_next_test',
                name: 'Ciclo Next',
                durationWeeks: 4,
                sessionsPerWeek: 3,
                startDate: '2026-09-01',
                endDate: '2026-09-28',
                routines: [
                    { routineId: 'r_push', frequencyPerWeek: 1 },
                    { routineId: 'r_pull', frequencyPerWeek: 1 },
                    { routineId: 'r_legs', frequencyPerWeek: 1 }
                ]
            };

            // History with 2 sessions completed
            const history = [
                { id: 'w1', cycleId: 'c_next_test', routineId: 'r_push', exercises: [] },
                { id: 'w2', cycleId: 'c_next_test', routineId: 'r_pull', exercises: [] }
            ];

            const next = getNextScheduledRoutine(cycle, sampleRoutines, history);
            expect(next).not.toBeNull();
            expect(next?.completedCount).toBe(2);
            expect(next?.totalSessions).toBe(12);
            expect(next?.nextRoutineId).toBe('r_legs');
            expect(next?.nextRoutineName).toBe('Legs C');
            expect(next?.isCycleCompleted).toBe(false);
        });

        it('calculateCycleVolume computes volume with full muscle distribution when cycle has endDate', () => {
            const cycle: TrainingCycle = {
                id: 'c_vol',
                name: 'Ciclo Volume',
                durationWeeks: 4,
                sessionsPerWeek: 3,
                startDate: '2026-09-01',
                endDate: '2026-09-28',
                routines: [
                    { routineId: 'r_push', frequencyPerWeek: 1 },
                    { routineId: 'r_pull', frequencyPerWeek: 1 },
                    { routineId: 'r_legs', frequencyPerWeek: 1 }
                ]
            };

            const vol = calculateCycleVolume(cycle, sampleRoutines, sampleLibrary);
            expect(vol.totalWorkoutsPerWeek).toBe(3);
            expect(vol.totalSetsPerWeek).toBe(13); // 4 + 4 + 5
            expect(Object.fromEntries(vol.muscleVolumes.map(({ key, sets }) => [key, sets]))).toEqual({
                chest: 4, triceps: 4, back: 4, biceps: 4, quads: 5, glutes: 5,
            });
            expect(vol.highlightedMuscles).toContain('chest');
            expect(vol.highlightedMuscles).toContain('back');
            expect(vol.highlightedMuscles).toContain('quads');
        });
    });
});
