export { generateWeekIntervals } from './weekIntervals';
export { computeWeeklyNutritionSeries, computeWeeklyActivitySeries, computeWeeklyWeightSeries } from './weeklyHealthMetrics';

export interface WeeklyVolumePoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    volumeKg: number;
    volumeTon: number;
    workoutCount: number;
    sessionIds: string[];
}

export interface WeeklyVolumeStats {
    totalVolumeKg: number;
    avgWeeklyVolumeKg: number;
    currentWeekVolumeKg: number;
    previousWeekVolumeKg: number;
    percentageChange: number | null;
    peakWeekVolumeKg: number;
    hasData: boolean;
    activeWeeksCount: number;
    totalWorkouts: number;
}

export interface WeeklyNutritionPoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    avgDailyKcal: number;
    totalKcal: number;
    loggedDaysCount: number;
    avgCarbs?: number;
    avgPro?: number;
    avgFat?: number;
}

export interface WeeklyActivityPoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    averageSteps: number | null;
    totalSteps: number;
    stepDaysCount: number;
    daysConsidered: number;
    cardioMinutes: number;
    cardioSessionsCount: number;
    cardioMinutesByIntensity: { low: number; moderate: number; high: number; unclassified: number };
}

export interface WeeklyActivityStats {
    hasData: boolean;
    totalSteps: number;
    stepDaysCount: number;
    cardioMinutes: number;
    cardioSessionsCount: number;
}

export interface WeeklyWeightPoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    averageWeightKg: number | null;
    recordedDaysCount: number;
    daysConsidered: number;
}

export interface WeeklyWeightStats {
    hasData: boolean;
    latestAverageWeightKg: number | null;
    latestRecordedDaysCount: number;
    latestDaysConsidered: number;
}

export interface VolumeCaloriesPoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    volumeKg: number;
    volumeTon: number;
    avgDailyKcal: number;
    workoutCount: number;
    loggedNutritionDays: number;
}

export interface VolumeCaloriesCorrelationStats {
    hasData: boolean;
    correlationCoefficient: number | null;
    correlationInsight: string;
    avgWeeklyVolumeKg: number;
    avgDailyKcal: number;
    validDataPointsCount: number;
}

export interface WeekInterval {
    weekIndex: number;
    startDate: Date;
    endDate: Date;
    weekStart: string;
    weekEnd: string;
    label: string;
}

export { getWorkoutDateString, computeWeeklyVolumeSeries, computeWeeklyTrainingActivityContext } from './analyticsWeeklyVolume';
export interface WeeklyTrainingActivityPoint extends WeeklyActivityPoint {
    workoutCount: number;
    volumeKg: number;
}
export { computeReadinessTrends } from './analyticsReadiness';
interface ReadinessTrendDimension {
    average: number | null;
    latest: number | null;
    previous: number | null;
    deltaFromPrevious: number | null;
    count: number;
}
export interface ReadinessTrendStats {
    energy: ReadinessTrendDimension;
    stress: ReadinessTrendDimension;
    motivation: ReadinessTrendDimension;
    muscleRecovery: ReadinessTrendDimension;
    sessionsWithReadiness: number;
}
export { calculatePearsonCorrelation, computeVolumeCaloriesCorrelationFromVolume, computeVolumeCaloriesCorrelation } from './analyticsCorrelation';
