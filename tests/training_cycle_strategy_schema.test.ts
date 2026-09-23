import { describe, expect, it } from 'vitest';
import { TrainingCycleSchema, WorkoutSessionSchema } from '../src/lib/schema';
import { createBackup, decodeImport } from '../src/lib/backup';
import { buildShareExportData } from '../src/lib/export';
import { mergeUserData } from '../src/lib/merge';
import type { TrainingCycle, UserData } from '../src/types';

describe('training cycle strategy schema', () => {
    const baseCycle = {
        id: 'cycle-1',
        name: 'Ciclo',
        durationWeeks: 6,
        routines: [],
    };

    it('keeps legacy cycles valid without inventing a strategy', () => {
        const parsed = TrainingCycleSchema.parse(baseCycle);
        expect(parsed.id).toBe('cycle-1');
        expect(parsed.strategy).toBeUndefined();
    });

    it('accepts muscle priorities with an unspecified objective', () => {
        const parsed = TrainingCycleSchema.parse({
            ...baseCycle,
            strategy: {
                primaryMuscles: ['biceps_right'],
                secondaryMuscles: ['delts_rear_left'],
            },
        });

        expect(parsed.strategy).toEqual({
            primaryMuscles: ['biceps_right'],
            secondaryMuscles: ['delts_rear_left'],
        });
    });

    it('preserves unspecified muscle priorities through export, backup and merge', () => {
        const cycle: TrainingCycle = {
            ...baseCycle,
            strategy: {
                primaryMuscles: ['biceps_right'],
                secondaryMuscles: ['delts_rear_left'],
            },
        };
        const data: UserData = {
            library: [],
            routines: [],
            trainingCycles: [cycle],
        };

        const shared = buildShareExportData(data, {
            exportLibrary: false,
            exportRoutines: false,
            exportTrainingCycles: true,
        });
        expect(shared.trainingCycles[0].strategy).toEqual(cycle.strategy);

        const backup = createBackup(data, 'owner-1');
        const decoded = decodeImport(JSON.parse(JSON.stringify(backup)), 'owner-1');
        expect((decoded.data.trainingCycles as TrainingCycle[])[0].strategy).toEqual(cycle.strategy);

        const merged = mergeUserData({ trainingCycles: [] }, data);
        expect(merged.trainingCycles?.[0]?.strategy).toEqual(cycle.strategy);
    });

    it.each([
        ['performance'],
        ['volume'],
        ['density'],
        ['execution'],
    ] as const)('accepts development with %s focus', (progressionFocus) => {
        const parsed = TrainingCycleSchema.parse({
            ...baseCycle,
            strategy: {
                intent: 'development',
                progressionFocus,
                primaryMuscles: ['quads'],
                secondaryMuscles: ['triceps'],
            },
        });
        expect(parsed.strategy).toEqual({
            intent: 'development',
            progressionFocus,
            primaryMuscles: ['quads'],
            secondaryMuscles: ['triceps'],
        });
    });

    it.each([
        ['maintenance'],
        ['deload'],
    ] as const)('accepts %s without progression focus or muscle priorities', (intent) => {
        const parsed = TrainingCycleSchema.parse({
            ...baseCycle,
            strategy: { intent },
        });

        expect(parsed.strategy).toEqual({ intent });
    });

    it('drops an invalid strategy intent instead of inventing a replacement', () => {
        const parsed = TrainingCycleSchema.parse({
            ...baseCycle,
            strategy: { intent: 'bulk-forever', progressionFocus: 'performance' },
        });

        expect(parsed.strategy).toBeUndefined();
    });

    it('sanitizes an invalid progression focus while preserving a valid declared intent', () => {
        const parsed = TrainingCycleSchema.parse({
            ...baseCycle,
            strategy: { intent: 'development', progressionFocus: 'magic-score' },
        });

        expect(parsed.strategy?.intent).toBe('development');
        expect(parsed.strategy?.progressionFocus).toBeUndefined();
    });
    it('survives share export, backup import and guest-to-account merge without losing strategy', () => {
        const cycle: TrainingCycle = {
            ...baseCycle,
            strategy: {
                intent: 'development',
                progressionFocus: 'volume',
                primaryMuscles: ['quads'],
                secondaryMuscles: ['triceps'],
            },
        };
        const data: UserData = {
            library: [],
            routines: [],
            trainingCycles: [cycle],
        };

        const shared = buildShareExportData(data, {
            exportLibrary: false,
            exportRoutines: false,
            exportTrainingCycles: true,
        });
        expect(shared.trainingCycles[0].strategy).toEqual(cycle.strategy);

        const backup = createBackup(data, 'owner-1');
        const decoded = decodeImport(JSON.parse(JSON.stringify(backup)), 'owner-1');
        expect((decoded.data.trainingCycles as TrainingCycle[])[0].strategy).toEqual(cycle.strategy);

        const merged = mergeUserData({ trainingCycles: [] }, data);
        expect(merged.trainingCycles?.[0]?.strategy).toEqual(cycle.strategy);
    });

    it('persists a valid strategy snapshot on workout sessions and drops a corrupt one', () => {
        const valid = WorkoutSessionSchema.parse({
            id: 'workout-1',
            cycleId: 'cycle-1',
            cycleStrategy: {
                intent: 'deload',
                primaryMuscles: ['quads'],
            },
            exercises: [],
        });
        const invalid = WorkoutSessionSchema.parse({
            id: 'workout-2',
            cycleId: 'cycle-1',
            cycleStrategy: { intent: 'invalid' },
            exercises: [],
        });

        expect(valid.cycleStrategy).toEqual({ intent: 'deload', primaryMuscles: ['quads'] });
        expect(invalid.cycleStrategy).toBeUndefined();
    });
});
