import type { MuscleDef } from './constants/muscles';
import { z } from './zod';

export type ExerciseTrackingType = 'weight_reps' | 'time' | 'cardio';

export interface ExerciseDraft {
    name: string;
    notes: string;
    trackingType: ExerciseTrackingType;
    selectedMuscles: MuscleDef[];
    secondaryMuscles: MuscleDef[];
    isBodyweight: boolean;
    equipmentWeight: string;
}

const muscleDraftSchema = z.object({ id: z.string().min(1), name: z.string() }).passthrough();
export const exerciseDraftSchema = z.object({
    name: z.string(),
    notes: z.string(),
    trackingType: z.enum(['weight_reps', 'time', 'cardio']),
    selectedMuscles: z.array(muscleDraftSchema),
    secondaryMuscles: z.array(muscleDraftSchema),
    isBodyweight: z.boolean(),
    equipmentWeight: z.string(),
});
