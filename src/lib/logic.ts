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
    validateInputData, 
    getCalendarMonthGrid, 
    CalendarDayCell,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid
} from './utils/date';
import { isPlainObject, removeUndefinedValues } from './utils/object';
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
    calculateMacros,
    calculateMacroRatio,
    modulateMacroRatio,
    calculateNormocaloricaDiff,
    calculateTDEEAndMacros,
    calculateFoodMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals,
    generateMockNutrition
} from './calc/nutrition';
import {
    validateWorkoutRatings,
    validateHistory,
    getWorkoutDatesSet,
    searchRoutines,
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
    validateInputData,
    getCalendarMonthGrid,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid,
    isPlainObject,
    removeUndefinedValues,
    calculateUsNavyBodyFat,
    calculateBodyFatByMethod,
    calculateBodyFat,
    calculateBodyComposition,
    validateMeasurementData,
    calculateTDEE,
    calculateDailyCalories,
    calculateMacrosFromKg,
    calculateMacros,
    calculateMacroRatio,
    modulateMacroRatio,
    calculateNormocaloricaDiff,
    calculateTDEEAndMacros,
    calculateFoodMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals,
    generateMockNutrition,
    validateWorkoutRatings,
    validateHistory,
    getWorkoutDatesSet,
    searchRoutines,
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
    validateInputData,
    getCalendarMonthGrid,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid,
    generateMockHistory: (): any[] => [],
    isPlainObject,
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
    calculateMacros,
    calculateMacroRatio,
    modulateMacroRatio,
    calculateNormocaloricaDiff,
    calculateTDEEAndMacros,
    calculateFoodMacros,
    scaleFoodNutrients,
    searchFoods,
    validateCustomFood,
    calculateMealTotals,
    generateMockNutrition,

    // Workouts & Planning
    validateWorkoutRatings,
    validateHistory,
    getWorkoutDatesSet,
    searchRoutines,
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




