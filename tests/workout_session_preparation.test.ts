import { describe, expect, it } from 'vitest';
import type { UserData, WorkoutRoutine, WorkoutSession } from '../src/types';
import {
    buildFreeWorkout,
    buildRoutineWorkout,
    prepareCompletedWorkout,
    prepareHistoricalWorkoutForEditing,
    prepareHistoricalWorkoutForSave,
    type WorkoutPreparationRuntime,
} from '../src/hooks/workout/workoutSessionPreparation';

function createRuntime(): WorkoutPreparationRuntime {
    let sequence = 0;
    return {
        generateId: prefix => `${prefix}_${++sequence}`,
        getLocalDateString: () => '2026-09-16',
        now: () => 1_700_000_000_000,
    };
}

describe('workout session preparation', () => {
    it('builds a routine workout with the same cycle and set semantics as the hook', () => {
        const routine = {
            id: 'routine-a',
            name: 'Routine A',
            exercises: [
                { exId: 'cardio', setsCount: 4 },
                { exId: 'bench', setsCount: 2, minReps: 6, maxReps: 8, defaultTechnique: 'dropset' },
            ],
        } as WorkoutRoutine;
        const userData = {
            activeCycleId: 'cycle-a',
            trainingCycles: [{
                id: 'cycle-a',
                name: 'Cycle A',
                durationWeeks: 4,
                strategy: {
                    intent: 'development',
                    progressionFocus: 'performance',
                    primaryMuscles: ['chest'],
                },
                routines: [{ routineId: 'routine-a', frequencyPerWeek: 1 }],
            }],
            library: [
                { id: 'cardio', name: 'Bike', trackingType: 'cardio' },
                { id: 'bench', name: 'Bench', trackingType: 'weight_reps' },
            ],
        } as unknown as UserData;

        const workout = buildRoutineWorkout(userData, routine, undefined, createRuntime());

        expect(workout).toMatchObject({
            routineId: 'routine-a',
            routineName: 'Routine A',
            cycleId: 'cycle-a',
            cycleName: 'Cycle A',
            cycleStrategy: {
                intent: 'development',
                progressionFocus: 'performance',
                primaryMuscles: ['chest'],
            },
            date: '2026-09-16',
            globalStartTime: 1_700_000_000_000,
        });
        expect(workout.exercises[0].sets).toHaveLength(1);
        expect(workout.exercises[1].sets).toHaveLength(2);
        expect(workout.exercises[1].sets.every(set => set.dropsets?.length === 1)).toBe(true);
        expect(workout.exercises[1]).toMatchObject({ minReps: 6, maxReps: 8 });
    });

    it('snapshots cycle strategy so later edits do not rewrite historical session meaning', () => {
        const routine = { id: 'routine-a', name: 'Routine A', exercises: [] } as WorkoutRoutine;
        const userData: UserData = {
            activeCycleId: 'cycle-a',
            trainingCycles: [{
                id: 'cycle-a',
                name: 'Cycle A',
                durationWeeks: 4,
                strategy: { intent: 'development', progressionFocus: 'performance' },
                routines: [{ routineId: 'routine-a', frequencyPerWeek: 1 }],
            }],
        };

        const firstSession = buildRoutineWorkout(userData, routine, undefined, createRuntime());
        userData.trainingCycles![0] = {
            ...userData.trainingCycles![0],
            strategy: { intent: 'development', progressionFocus: 'volume' },
        };
        const secondSession = buildRoutineWorkout(userData, routine, undefined, createRuntime());

        expect(firstSession.cycleStrategy).toEqual({ intent: 'development', progressionFocus: 'performance' });
        expect(secondSession.cycleStrategy).toEqual({ intent: 'development', progressionFocus: 'volume' });
    });

    it('snapshots muscle priorities even when the cycle objective is unspecified', () => {
        const routine = { id: 'routine-a', name: 'Routine A', exercises: [] } as WorkoutRoutine;
        const userData: UserData = {
            activeCycleId: 'cycle-a',
            trainingCycles: [{
                id: 'cycle-a',
                name: 'Cycle A',
                durationWeeks: 4,
                strategy: {
                    primaryMuscles: ['biceps_right'],
                    secondaryMuscles: ['delts_rear_left'],
                },
                routines: [{ routineId: 'routine-a', frequencyPerWeek: 1 }],
            }],
        };

        const session = buildRoutineWorkout(userData, routine, undefined, createRuntime());

        expect(session.cycleStrategy).toEqual({
            primaryMuscles: ['biceps_right'],
            secondaryMuscles: ['delts_rear_left'],
        });
    });

    it('lets explicit cycle info override active-cycle inference and builds free workouts deterministically', () => {
        const routine = { id: 'routine-a', name: 'Routine A', exercises: [] } as WorkoutRoutine;
        const workout = buildRoutineWorkout(
            {},
            routine,
            { cycleId: 'manual-cycle', cycleName: 'Manual Cycle' },
            createRuntime(),
        );
        const freeWorkout = buildFreeWorkout(createRuntime());

        expect(workout.cycleId).toBe('manual-cycle');
        expect(workout.cycleName).toBe('Manual Cycle');
        expect(freeWorkout).toMatchObject({
            routineName: 'Allenamento libero',
            date: '2026-09-16',
            globalStartTime: 1_700_000_000_000,
            exercises: [],
        });
    });

    it('sanitizes a historical workout for editing without changing its business identity', () => {
        const historicalWorkout = {
            id: 'history-1',
            routineName: 'Storico',
            globalStartTime: 1_000,
            globalEndTime: 3_601_000,
            exercises: [{
                exId: 'bench',
                sessionNote: 'nota',
                sets: [{
                    kg: 80,
                    reps: 8,
                    time: 12,
                    dropsets: [{ kg: 60, reps: 6 }],
                    isometrics: [{ kg: 40, time: 20 }],
                }],
            }],
        } as unknown as WorkoutSession;

        const editing = prepareHistoricalWorkoutForEditing(historicalWorkout, createRuntime());

        expect(editing.id).toBe('history-1');
        expect(editing.originalHistoryId).toBe('history-1');
        expect(editing.isEditingHistory).toBe(true);
        expect(editing.manualDurationStr).toBe('01:00:00');
        expect(editing.exercises[0].id).toBeTruthy();
        expect(editing.exercises[0].sets[0]).toMatchObject({ kg: '80', reps: '8', time: '12' });
        expect(editing.exercises[0].sets[0].dropsets?.[0]).toMatchObject({ kg: '60', reps: '6' });
        expect(editing.exercises[0].sets[0].isometrics?.[0]).toMatchObject({ kg: '40', time: '20' });
    });

    it('prepares a historical save and strips edit-only markers', () => {
        const currentWorkout = {
            id: 'editing-copy',
            originalHistoryId: 'history-1',
            isEditingHistory: true,
            routineName: 'Storico',
            exercises: [],
            pains: ['chest'],
        } as WorkoutSession;

        const saved = prepareHistoricalWorkoutForSave(
            currentWorkout,
            'history-1',
            { mood: '8', pump: '9', fatigue: '4' },
            '1,5',
            '00:45:00',
            createRuntime(),
        );

        expect(saved).toMatchObject({
            id: 'history-1',
            globalDurationStr: '00:45:00',
            manualDurationStr: '00:45:00',
            moodRating: 8,
            pumpRating: 9,
            fatigueRating: 4,
            waterLiters: 1.5,
            pains: ['chest'],
            date: '2026-09-16',
        });
        expect(saved.isEditingHistory).toBeUndefined();
        expect(saved.originalHistoryId).toBeUndefined();
    });

    it('prepares workout completion while preserving duration and cleanup semantics', () => {
        const currentWorkout = {
            id: 'active-1',
            routineName: 'Routine A',
            globalStartTime: 1_000,
            moodRating: 7,
            pumpRating: 8,
            fatigueRating: 5,
            waterLiters: '1,5',
            pains: ['back'],
            isEditingHistory: true,
            originalHistoryId: 'old-id',
            exercises: [],
        } as unknown as WorkoutSession;

        const prepared = prepareCompletedWorkout(currentWorkout, 3_601_000, createRuntime());

        expect(prepared.diff).toBe(3600);
        expect(prepared.durationStr).toBe('01:00:00');
        expect(prepared.sessionPains).toEqual(['back']);
        expect(prepared.finishedWorkout).toMatchObject({
            id: 'active-1',
            globalEndTime: 3_601_000,
            globalDurationStr: '01:00:00',
            moodRating: 7,
            pumpRating: 8,
            fatigueRating: 5,
            waterLiters: 1.5,
            pains: ['back'],
        });
        expect(prepared.finishedWorkout.isEditingHistory).toBeUndefined();
        expect(prepared.finishedWorkout.originalHistoryId).toBeUndefined();
    });
});
