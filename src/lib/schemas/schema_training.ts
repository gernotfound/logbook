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

const SetTechniqueSchema = z.enum(['straight', 'dropset', 'rest_pause', 'cluster', 'rep_match', 'diminishing']);
const SetTargetSchema = z.object({
    type: z.literal('reps'),
    reps: z.number().int().nonnegative(),
    sourceSetId: safeOptionalString(),
}).passthrough();
const PlannedSetTechniqueSchema = z.object({
    technique: SetTechniqueSchema,
    target: SetTargetSchema.optional().catch(undefined),
    restSeconds: z.number().int().nonnegative().optional().catch(undefined),
    segmentCount: z.number().int().positive().optional().catch(undefined),
}).passthrough();

export const RoutineExerciseSchema = z.object({
    exId: safeString(''),
    setsCount: safeNumber(0),
    minReps: safeOptionalNumber(),
    maxReps: safeOptionalNumber(),
    defaultTechnique: z.enum(['none', 'dropset', 'isometrics', 'rest_pause', 'cluster', 'rep_match', 'diminishing']).optional().catch(undefined),
    setPlans: z.array(PlannedSetTechniqueSchema).optional().catch(undefined),
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

const SessionSetSegmentSchema = z.object({
    id: safeString(''),
    kg: safeString(''),
    reps: safeString(''),
    time: safeOptionalString(),
    restBeforeSeconds: z.number().int().nonnegative().optional().catch(undefined),
}).passthrough();

export const SessionExerciseSetSchema = z.object({
    id: safeString(''),
    kg: safeString(''),
    reps: safeString(''),
    rir: z.number().int().min(0).max(10).optional().catch(undefined),
    time: safeOptionalString(),
    distance: safeOptionalString(),
    speed: safeOptionalString(),
    incline: safeOptionalString(),
    kcal: safeOptionalString(),
    done: safeOptionalBoolean(),
    technique: SetTechniqueSchema.optional().catch(undefined),
    executionMode: z.enum(['standard', 'stop_reps']).optional().catch(undefined),
    segments: z.array(SessionSetSegmentSchema).optional().catch(undefined),
    target: SetTargetSchema.optional().catch(undefined),
    dropsets: z.array(SessionExerciseDropsetSchema).optional().catch([]).default([]),
    isometrics: z.array(SessionExerciseIsometricSchema).optional().catch([]).default([]),
}).passthrough().transform((set) => {
    if (set.rir !== undefined) return set;
    const { rir: _rir, ...withoutRir } = set;
    return withoutRir;
}).catch({ id: '', kg: '', reps: '', dropsets: [], isometrics: [] }).default({ id: '', kg: '', reps: '', dropsets: [], isometrics: [] });

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

const ReadinessRatingSchema = z.number().int().min(1).max(5);

export const WorkoutReadinessSchema = z.object({
    capturedAt: z.number().finite().nonnegative(),
    energy: ReadinessRatingSchema.optional(),
    stress: ReadinessRatingSchema.optional(),
    motivation: ReadinessRatingSchema.optional(),
    muscleRecovery: ReadinessRatingSchema.optional(),
}).strict();

export const WorkoutSessionSchema = z.object({
    id: safeOptionalString(),
    routineId: safeOptionalString(),
    routineName: safeOptionalString(),
    cycleId: safeOptionalString(),
    cycleName: safeOptionalString(),
    cycleStrategy: TrainingCycleStrategySchema.optional().catch(undefined),
    readiness: WorkoutReadinessSchema.optional().catch(undefined),
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
