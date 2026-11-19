import type { WorkoutRoutine } from '../../types';

// Keep the established planning API stable for UI, domain consumers and existing callers.
export { calculateCycleTimeline } from './planningTimeline';
export interface CycleTimelineInfo {
    startDate?: string;
    endDate?: string;
    formattedStartDate: string;
    formattedEndDate: string;
    formattedRange: string;
    currentWeek: number;
    totalWeeks: number;
    isStarted: boolean;
    isEnded: boolean;
    progressPercent: number;
    statusLabel: string;
    daysRemaining?: number;
}
export { calculateCycleSchedule, getNextScheduledRoutine } from './planningSchedule';
export type { CycleScheduleResult } from './planningSchedule';
export interface NextScheduledRoutineResult {
    nextRoutine: WorkoutRoutine | undefined;
    nextRoutineId: string | undefined;
    nextRoutineName: string;
    nextSessionIndex: number; // 1-based (es. 1, 2, 3...)
    completedCount: number;
    totalSessions: number;
    rotationNumber: number; // 1-based (es. Giro 1, Giro 2...)
    positionInRotation: number; // 1-based (es. Scheda 3 di 6)
    totalRoutinesInCycle: number;
    isCycleCompleted: boolean;
}
export { calculateCycleVolume, getDetailedMuscleCategory } from './planningVolume';
interface MuscleVolumeDetail {
    key: string;
    label: string;
    sets: number;
    percentage: number;
}
export interface CycleVolumeResult {
    totalWorkoutsPerWeek: number;
    totalSetsPerWeek: number;
    muscleVolumes: MuscleVolumeDetail[];
    muscleColors: Record<string, string>;
    highlightedMuscles: string[];
}
