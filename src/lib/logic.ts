import { MUSCLES, GROUP_MAP } from './constants/muscles';
import { 
    generateId, 
    getLocalDateString, 
    formatItalianDate, 
    parseDateInput, 
    calculateAge, 
    formatDuration, 
    normalizeDuration, 
    getCalendarMonthGrid, 
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid
} from './utils/date';
import { generateUniqueName } from './utils/string';
import { 
    calculateBodyFatByMethod, 
    calculateBodyFat, 
    calculateBodyComposition, 
    validateMeasurementData 
} from './calc/bodyFat';
import {
    calculateTDEE,
    calculateMacrosFromKg,
    calculateMacroRatio,
    calculateTDEEAndMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals
} from './calc/nutrition';
import {
    validateWorkoutRatings,
    filterItems,
    searchExerciseLibrary,
    normalizeStem,
    getLatestUserWeight,
    calculateEffectiveSetWeight,
    calculateSetVolume,
    calculateWorkoutVolume,
    getMuscleName,
    searchMuscles,
    mergeActivePains
} from './calc/workout';
import {
    calculateCycleVolume,
    getDetailedMuscleCategory,
    calculateCycleTimeline,
    calculateCycleSchedule,
    getNextScheduledRoutine,
} from './calc/planning';

// Re-export shared constants.
export { MUSCLES, GROUP_MAP };

// Re-export all functions
export {
    generateId,
    getLocalDateString,
    formatItalianDate,
    parseDateInput,
    calculateAge,
    formatDuration,
    normalizeDuration,
    getCalendarMonthGrid,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid,
    generateUniqueName,
    calculateBodyFatByMethod,
    calculateBodyFat,
    calculateBodyComposition,
    validateMeasurementData,
    calculateTDEE,
    calculateMacrosFromKg,
    calculateMacroRatio,
    calculateTDEEAndMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals,
    validateWorkoutRatings,
    filterItems,
    searchExerciseLibrary,
    normalizeStem,
    getLatestUserWeight,
    calculateEffectiveSetWeight,
    calculateSetVolume,
    calculateWorkoutVolume,
    calculateCycleVolume,
    getDetailedMuscleCategory,
    calculateCycleTimeline,
    calculateCycleSchedule,
    getNextScheduledRoutine,
    getMuscleName,
    searchMuscles,
    mergeActivePains
};

export const Logic = {
    // Constants
    MUSCLES,
    GROUP_MAP,

    // Utility & Dates
    generateId,
    getLocalDateString,
    formatItalianDate,
    parseDateInput,
    calculateAge,
    formatDuration,
    normalizeDuration,
    getCalendarMonthGrid,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid,
    generateUniqueName,

    // Body Fat & Composition
    calculateBodyFatByMethod,
    calculateBodyFat,
    calculateBodyComposition,
    validateMeasurementData,

    // Nutrition & Foods
    calculateTDEE,
    calculateMacrosFromKg,
    calculateMacroRatio,
    calculateTDEEAndMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals,

    // Workouts & Planning
    validateWorkoutRatings,
    filterItems,
    searchExerciseLibrary,
    normalizeStem,
    getLatestUserWeight,
    calculateEffectiveSetWeight,
    calculateSetVolume,
    calculateWorkoutVolume,
    calculateCycleVolume,
    getDetailedMuscleCategory,
    calculateCycleTimeline,
    calculateCycleSchedule,
    getNextScheduledRoutine,
    getMuscleName,
    searchMuscles,
    mergeActivePains
};





