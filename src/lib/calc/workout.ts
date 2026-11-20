// Keep the existing workout calculation API stable for UI, hooks and analytics callers.
export { normalizeStem, createExerciseLibrarySearcher, getMuscleName, searchMuscles } from './workoutSearch';
export {
    parsePositiveWeight,
    getLatestUserWeight,
    calculateEffectiveSetWeight,
    calculateSetVolume,
    calculateWorkoutVolume,
} from './workoutVolume';
export type { VolumeExerciseRef } from './workoutVolume';
export { validateWorkoutRatings, mergeActivePains } from './workoutSession';
