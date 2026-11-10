import { MUSCLES, GROUP_MAP } from './constants/muscles';
import { 
    generateId, 
    getLocalDateString, 
    formatItalianDate, 
    parseDateInput, 

    formatDuration, 
    normalizeDuration, 
    getCalendarMonthGrid, 
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid
} from './utils/date';
import { generateUniqueName } from './utils/string';
import { calculateBodyFatByMethod, calculateBodyFat } from './calc/bodyFat';
import {
    calculateTDEE,
    calculateMacrosFromKg,

    calculateTDEEAndMacros,

    validateCustomFood,

} from './calc/nutrition';
import {
    validateWorkoutRatings,

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

export {
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid,

    normalizeStem,
    getDetailedMuscleCategory
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

    formatDuration,
    normalizeDuration,
    getCalendarMonthGrid,
    formatSleepTime,
    parseSleepInput,
    isSleepTimeValid,
    generateUniqueName,

    // Body Fat
    calculateBodyFatByMethod,
    calculateBodyFat,

    // Nutrition & Foods
    calculateTDEE,
    calculateMacrosFromKg,

    calculateTDEEAndMacros,

    validateCustomFood,

    // Workouts & Planning
    validateWorkoutRatings,

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

