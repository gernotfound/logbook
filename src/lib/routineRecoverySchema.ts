import { z } from './zod';
import { normalizeBusinessId } from './businessIdentity';
import type { RoutineExercise } from '../types';

// Owner, consent revision and ciphertext are verified by the device recovery reader
// before this schema is used to hydrate an editor.
const recoveredRoutineExerciseSchema = z.object({
    exId: z.string().refine(id => id.trim().length > 0),
    setsCount: z.union([z.string(), z.number().finite()]),
    minReps: z.union([z.string(), z.number().finite()]).optional(),
    maxReps: z.union([z.string(), z.number().finite()]).optional(),
    setPlans: z.array(z.object({
        technique: z.enum(['straight', 'dropset', 'rest_pause', 'cluster', 'rep_match', 'diminishing']),
        target: z.object({ type: z.literal('reps'), reps: z.number().int().nonnegative(),
            sourceSetId: z.string().optional() }).optional(),
        restSeconds: z.number().int().nonnegative().optional(),
        segmentCount: z.number().int().positive().optional(),
    }).passthrough()).optional(),
    technicalStandard: z.string().optional(),
    defaultTechnique: z.enum([
        'none', 'dropset', 'isometrics', 'rest_pause', 'cluster', 'rep_match', 'diminishing',
    ]).optional(),
    progressionContract: z.object({
        role: z.enum(['primary', 'secondary', 'support']).optional(),
        metric: z.enum(['performance', 'volume', 'density', 'execution']).optional(),
    }).passthrough().optional(),
}).passthrough();

const recoveredRoutineDraftSchema = z.object({
    name: z.string().optional(),
    exercises: z.array(recoveredRoutineExerciseSchema).optional(),
}).passthrough();

const routineValuesSchema = z.object({ name: z.string(), exercises: z.array(recoveredRoutineExerciseSchema) });
const routineId = z.string().refine(id => normalizeBusinessId(id) === id);

export const accountRoutineDraftSchema = routineValuesSchema.extend({
    version: z.literal(1),
    routineId,
    basis: routineValuesSchema.nullable(),
    submitted: z.boolean(),
}).strict();

export function parseRoutineRecovery(value: unknown | null): { name?: string; exercises?: RoutineExercise[] } | null {
    if (value === null) return null;
    const parsed = recoveredRoutineDraftSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error('Bozza scheda non valida: originale cifrato conservato.');
    }
    return parsed.data;
}

