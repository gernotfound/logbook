import { MUSCLES, GROUP_MAP, MuscleDef } from './constants/muscles';
import { generateId, getLocalDateString, calculateAge, formatTime, formatDuration, normalizeDuration, validateInputData, getCalendarMonthGrid, CalendarDayCell } from './utils/date';
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
    filterItems
} from './calc/workout';
import {
    calculateCycleVolume,
    getDetailedMuscleCategory
} from './calc/planning';

// Re-export all constants and types
export { MUSCLES, GROUP_MAP };
export type { MuscleDef, CalendarDayCell };

// Re-export all functions
export {
    generateId,
    getLocalDateString,
    calculateAge,
    formatTime,
    formatDuration,
    normalizeDuration,
    validateInputData,
    getCalendarMonthGrid,
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
    calculateCycleVolume,
    getDetailedMuscleCategory
};

// Aggregated Logic object for full backward compatibility
export const Logic = {
    // Constants
    MUSCLES,
    GROUP_MAP,

    // Utility & Dates
    generateId,
    getLocalDateString,
    calculateAge,
    formatTime,
    formatDuration,
    normalizeDuration,
    validateInputData,
    getCalendarMonthGrid,
    generateMockHistory: (): any[] => [],

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
    calculateCycleVolume,
    getDetailedMuscleCategory
};

