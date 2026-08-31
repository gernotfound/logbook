import { MUSCLES, GROUP_MAP, MuscleDef } from './constants/muscles';
import { 
    generateId, 
    getLocalDateString, 
    formatItalianDate, 
    parseDateInput, 
    calculateAge, 
    formatTime, 
    formatDuration, 
    normalizeDuration, 
    getCalendarMonthGrid, 
    CalendarDayCell,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid
} from './utils/date';
import { isPlainObject, removeUndefinedValues } from './utils/object';
import { generateUniqueName } from './utils/string';
import { 
    calculateUsNavyBodyFat, 
    calculateBodyFatByMethod, 
    calculateBodyFat, 
    calculateBodyComposition, 
    validateMeasurementData 
} from './calc/bodyFat';
import {
    calculateTDEE,
    calculateDailyCalories,
    calculateMacrosFromKg,
    calculateMacroRatio,
    calculateNormocaloricaDiff,
    calculateTDEEAndMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals
} from './calc/nutrition';
import {
    validateWorkoutRatings,
    getWorkoutDatesSet,
    filterItems,
    searchExerciseLibrary,
    normalizeStem,
    VolumeExerciseRef,
    getLatestUserWeight,
    calculateEffectiveSetWeight,
    calculateSetVolume,
    calculateWorkoutVolume,
    getMuscleName,
    searchMuscles,
    autoHealPains
} from './calc/workout';
import {
    calculateCycleVolume,
    getDetailedMuscleCategory,
    calculateCycleTimeline,
    CycleTimelineInfo,
    calculateCycleSchedule,
    getNextScheduledRoutine,
    ScheduledCycleSession,
    WeeklyCycleSchedule,
    CycleScheduleResult,
    NextScheduledRoutineResult
} from './calc/planning';

// Re-export all constants and types
export { MUSCLES, GROUP_MAP };
export type { 
    MuscleDef, 
    CalendarDayCell, 
    CycleTimelineInfo,
    ScheduledCycleSession,
    WeeklyCycleSchedule,
    CycleScheduleResult,
    NextScheduledRoutineResult,
    VolumeExerciseRef
};

// Re-export all functions
export {
    generateId,
    getLocalDateString,
    formatItalianDate,
    parseDateInput,
    calculateAge,
    formatTime,
    formatDuration,
    normalizeDuration,
    getCalendarMonthGrid,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid,
    isPlainObject,
    generateUniqueName,
    removeUndefinedValues,
    calculateUsNavyBodyFat,
    calculateBodyFatByMethod,
    calculateBodyFat,
    calculateBodyComposition,
    validateMeasurementData,
    calculateTDEE,
    calculateDailyCalories,
    calculateMacrosFromKg,
    calculateMacroRatio,
    calculateNormocaloricaDiff,
    calculateTDEEAndMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals,
    validateWorkoutRatings,
    getWorkoutDatesSet,
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
    autoHealPains
};

// Aggregated Logic object for full backward compatibility
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
    formatTime,
    formatDuration,
    normalizeDuration,
    getCalendarMonthGrid,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid,
    isPlainObject,
    generateUniqueName,
    removeUndefinedValues,

    // Body Fat & Composition
    calculateUsNavyBodyFat,
    calculateBodyFatByMethod,
    calculateBodyFat,
    calculateBodyComposition,
    validateMeasurementData,

    // Nutrition & Foods
    calculateTDEE,
    calculateDailyCalories,
    calculateMacrosFromKg,
    calculateMacroRatio,
    calculateNormocaloricaDiff,
    calculateTDEEAndMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals,

    // Workouts & Planning
    validateWorkoutRatings,
    getWorkoutDatesSet,
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
    autoHealPains
};





