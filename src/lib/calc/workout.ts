// Keep the existing workout calculation API stable for UI, hooks and analytics callers.
export { normalizeStem } from './searchNormalization';
export { createExerciseLibrarySearcher } from './workoutSearch';
export { getMuscleName, searchMuscles } from './workoutMuscleSearch';
export {
    parsePositiveWeight,
    getLatestUserWeight,
    calculateEffectiveSetWeight,
    calculateSetVolume,
    calculateWorkoutVolume,
} from './workoutVolume';
export { validateWorkoutRatings, mergeActivePains } from './workoutSession';
