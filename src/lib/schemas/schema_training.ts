import { z } from '../zod';
import { 
    safeNumber, 
    safeOptionalNumber, 
    safeOptionalString, 
    safeString, 
    safeBoolean,
    safeOptionalBoolean,
    safeOptionalNullableNumber,
    reportZodSchemaFallback 
} from './schema_utils';

export const ExerciseSetSchema = z.object({
    weight: safeString(''),
    reps: safeString(''),
    time: safeOptionalString(),
    done: safeBoolean(false),
}).passthrough().catch({ weight: '', reps: '', done: false }).default({ weight: '', reps: '', done: false });

export const ExerciseSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    notes: safeOptionalString(),
    setsCount: safeNumber(0),
    muscles: z.array(safeString('')).optional().catch([]).default([]),
    secondaryMuscles: z.array(safeString('')).optional().catch([]).default([]),
    sets: z.array(ExerciseSetSchema).catch([]).default([]),
    trackingType: z.enum(['weight_reps', 'time', 'cardio']).optional().catch(undefined),
    isDefault: safeOptionalBoolean(),
    isBodyweight: safeOptionalBoolean(),
    equipmentWeight: safeOptionalNumber(),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'ExerciseSchema',
        fallbackUsed: 'default_empty_exercise',
        error: ctx?.error,
    });
    return { id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] };
}).default({ id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] });

export const ExerciseLibraryItemSchema = ExerciseSchema;

export const RoutineExerciseSchema = z.object({
    exId: safeString(''),
    setsCount: safeNumber(0),
    minReps: safeOptionalNumber(),
    maxReps: safeOptionalNumber(),
    defaultTechnique: z.enum(['none', 'dropset', 'isometrics']).optional().catch(undefined),
}).passthrough().catch({ exId: '', setsCount: 0 }).default({ exId: '', setsCount: 0 });

export const WorkoutRoutineSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    exercises: z.array(RoutineExerciseSchema).catch([]).default([]),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'WorkoutRoutineSchema',
        fallbackUsed: 'default_empty_routine',
        error: ctx?.error,
    });
    return { id: '', name: '', exercises: [] };
}).default({ id: '', name: '', exercises: [] });

export const RoutineSchema = WorkoutRoutineSchema;

export const SessionExerciseDropsetSchema = z.object({
    id: safeString(''),
    kg: safeString(''),
    reps: safeString(''),
}).passthrough().catch({ id: '', kg: '', reps: '' }).default({ id: '', kg: '', reps: '' });

export const SessionExerciseIsometricSchema = z.object({
    id: safeString(''),
    kg: safeString(''),
    time: safeString(''),
}).passthrough().catch({ id: '', kg: '', time: '' }).default({ id: '', kg: '', time: '' });

export const SessionExerciseSetSchema = z.object({
    id: safeString(''),
    kg: safeString(''),
    reps: safeString(''),
    time: safeOptionalString(),
    distance: safeOptionalString(),
    speed: safeOptionalString(),
    incline: safeOptionalString(),
    kcal: safeOptionalString(),
    done: safeOptionalBoolean(),
    dropsets: z.array(SessionExerciseDropsetSchema).optional().catch([]).default([]),
    isometrics: z.array(SessionExerciseIsometricSchema).optional().catch([]).default([]),
}).passthrough().catch({ id: '', kg: '', reps: '', dropsets: [], isometrics: [] }).default({ id: '', kg: '', reps: '', dropsets: [], isometrics: [] });

export const SessionExerciseSchema = z.object({
    id: safeOptionalString(),
    exId: safeString(''),
    sessionNote: safeString(''),
    sets: z.array(SessionExerciseSetSchema).catch([]).default([]),
    minReps: safeOptionalNumber(),
    maxReps: safeOptionalNumber(),
}).passthrough().catch({ exId: '', sessionNote: '', sets: [] }).default({ exId: '', sessionNote: '', sets: [] });

export const TrainingCycleStrategySchema = z.object({
    intent: z.enum(['development', 'maintenance', 'deload']).optional(),
    progressionFocus: z.enum(['performance', 'volume', 'density', 'execution']).optional().catch(undefined),
    primaryMuscles: z.array(z.string().trim().min(1)).optional().catch([]),
    secondaryMuscles: z.array(z.string().trim().min(1)).optional().catch([]),
}).passthrough();

export const WorkoutSessionSchema = z.object({
    id: safeOptionalString(),
    routineId: safeOptionalString(),
    routineName: safeOptionalString(),
    cycleId: safeOptionalString(),
    cycleName: safeOptionalString(),
    cycleStrategy: TrainingCycleStrategySchema.optional().catch(undefined),
    date: safeOptionalString(),
    globalStartTime: safeOptionalNumber(),
    globalEndTime: safeOptionalNumber(),
    globalDurationStr: safeOptionalString(),
    manualDurationStr: safeOptionalString(),
    moodRating: safeOptionalNullableNumber(),
    pumpRating: safeOptionalNullableNumber(),
    fatigueRating: safeOptionalNullableNumber(),
    waterLiters: safeOptionalNumber(),
    endTime: safeOptionalNumber(),
    exercises: z.array(SessionExerciseSchema).catch([]).default([]),
    isEditingHistory: safeOptionalBoolean(),
    originalHistoryId: safeOptionalString(),
    pains: z.array(safeString('')).optional().catch([]).default([]),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'WorkoutSessionSchema',
        fallbackUsed: 'default_empty_session',
        error: ctx?.error,
    });
    return { exercises: [], pains: [] };
}).default({ exercises: [], pains: [] });

export const TrainingCycleRoutineItemSchema = z.object({
    routineId: safeString(''),
    frequencyPerWeek: safeNumber(1),
}).passthrough().catch({ routineId: '', frequencyPerWeek: 1 }).default({ routineId: '', frequencyPerWeek: 1 });

export const TrainingCycleSchema = z.object({
    id: safeString(''),
    name: safeString(''),
    durationWeeks: safeNumber(4),
    sessionsPerWeek: safeOptionalNumber(),
    progressionMode: z.enum(['sequential', 'fixed']).optional().catch(undefined),
    startDate: safeOptionalString(),
    endDate: safeOptionalString(),
    notes: safeOptionalString(),
    strategy: TrainingCycleStrategySchema.optional().catch(undefined),
    routines: z.array(TrainingCycleRoutineItemSchema).catch([]).default([]),
    createdAt: safeOptionalNumber(),
    isActive: safeOptionalBoolean(),
}).passthrough().catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'TrainingCycleSchema',
        fallbackUsed: 'default_empty_cycle',
        error: ctx?.error,
    });
    return { id: '', name: '', durationWeeks: 4, routines: [] };
}).default({ id: '', name: '', durationWeeks: 4, routines: [] });
