import type { WorkoutSession, SessionExercise } from '../../types';
import { calculateEffectiveSetWeight, VolumeExerciseRef } from './workout';

export interface ExerciseComparison {
    exId: string;
    exName: string;
    currentVolume: number;
    previousVolume: number;
    volumeDelta: number;
    volumeDeltaPercent: number;
    currentReps: number;
    previousReps: number;
    repsDelta: number;
    currentAvgWeight: number;
    previousAvgWeight: number;
    weightDelta: number;
    isPR: boolean;
}

export interface WorkoutReport {
    isFirstSession: boolean;
    workoutId: string;
    workoutName: string;
    date: string;
    durationSeconds: number;
    totalVolume: number;
    previousTotalVolume?: number;
    volumeDeltaPercent?: number;
    exerciseComparisons: ExerciseComparison[];
    newPRs: ExerciseComparison[];
}

function calculateExerciseStats(
    ex: SessionExercise,
    libEx?: VolumeExerciseRef | null,
    userWeight: number = 80
) {
    let volume = 0;
    let totalReps = 0;
    let totalWeight = 0;
    let weightCount = 0;

    for (const set of (ex.sets || [])) {
        const reps = parseInt(String(set.reps), 10) || 0;
        if (reps <= 0) continue;

        const effectiveKg = calculateEffectiveSetWeight(set.kg, libEx, userWeight);
        volume += effectiveKg * reps;
        totalReps += reps;

        if (effectiveKg > 0) {
            totalWeight += effectiveKg;
            weightCount++;
        }

        // Dropsets
        for (const ds of (set.dropsets || [])) {
            const dsreps = parseInt(String(ds.reps), 10) || 0;
            if (dsreps <= 0) continue;

            const dskg = calculateEffectiveSetWeight(ds.kg, libEx, userWeight);
            volume += dskg * dsreps;
            totalReps += dsreps;

            if (dskg > 0) {
                totalWeight += dskg;
                weightCount++;
            }
        }
    }

    const avgWeight = weightCount > 0 ? Math.round((totalWeight / weightCount) * 10) / 10 : 0;

    return { volume, totalReps, avgWeight };
}

export function computeWorkoutReport(
    currentWorkout: WorkoutSession,
    history: WorkoutSession[] = [],
    libraryMap?: Map<string, any> | null,
    userWeight: number = 80
): WorkoutReport {
    const routineId = currentWorkout.routineId;
    let previousWorkout: WorkoutSession | undefined;

    // Assumiamo che history sia ordinato dal più recente al più vecchio
    for (const w of history) {
        if (!w || w.id === currentWorkout.id) continue;
        if (w.routineId === routineId && w.date && currentWorkout.date && w.date <= currentWorkout.date) {
            previousWorkout = w;
            break;
        }
    }

    let durationSeconds = 0;
    const durationStr = currentWorkout.globalDurationStr || currentWorkout.manualDurationStr;
    if (durationStr) {
        const parts = durationStr.split(':');
        if (parts.length === 3) {
            durationSeconds = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
        }
    }

    const report: WorkoutReport = {
        isFirstSession: !previousWorkout,
        workoutId: currentWorkout.id || '',
        workoutName: currentWorkout.routineName || 'Sessione',
        date: currentWorkout.date || '',
        durationSeconds,
        totalVolume: 0,
        exerciseComparisons: [],
        newPRs: []
    };

    let currentTotalVolume = 0;
    let previousTotalVolume = 0;

    if (!previousWorkout) {
        for (const ex of (currentWorkout.exercises || [])) {
            const libEx = ex.exId && libraryMap ? libraryMap.get(ex.exId) : null;
            const stats = calculateExerciseStats(ex, libEx, userWeight);
            currentTotalVolume += stats.volume;
        }
        report.totalVolume = currentTotalVolume;
        return report;
    }

    const prevExMap = new Map<string, SessionExercise>();
    for (const ex of (previousWorkout.exercises || [])) {
        if (ex.exId) prevExMap.set(ex.exId, ex);
    }

    for (const ex of (currentWorkout.exercises || [])) {
        if (!ex.exId) continue;
        
        const libEx = libraryMap ? libraryMap.get(ex.exId) : null;
        const currStats = calculateExerciseStats(ex, libEx, userWeight);
        currentTotalVolume += currStats.volume;

        let exName = 'Esercizio';
        if (libEx && libEx.name) {
            exName = libEx.name;
        }

        const prevEx = prevExMap.get(ex.exId);
        if (prevEx) {
            const prevStats = calculateExerciseStats(prevEx, libEx, userWeight);
            previousTotalVolume += prevStats.volume;

            const volumeDelta = currStats.volume - prevStats.volume;
            let volumeDeltaPercent = 0;
            if (prevStats.volume > 0) {
                volumeDeltaPercent = (volumeDelta / prevStats.volume) * 100;
            } else if (currStats.volume > 0) {
                volumeDeltaPercent = 100;
            }

            const repsDelta = currStats.totalReps - prevStats.totalReps;
            const weightDelta = Math.round((currStats.avgWeight - prevStats.avgWeight) * 10) / 10;

            // PR logic: only valid when comparing against a real previous baseline
            const isPR = (volumeDelta > 0 && currStats.volume > 0) || 
                         (weightDelta > 0 && currStats.totalReps >= prevStats.totalReps) ||
                         (currStats.volume === 0 && repsDelta > 0 && currStats.totalReps > 0);

            const comp: ExerciseComparison = {
                exId: ex.exId,
                exName,
                currentVolume: currStats.volume,
                previousVolume: prevStats.volume,
                volumeDelta,
                volumeDeltaPercent,
                currentReps: currStats.totalReps,
                previousReps: prevStats.totalReps,
                repsDelta,
                currentAvgWeight: currStats.avgWeight,
                previousAvgWeight: prevStats.avgWeight,
                weightDelta,
                isPR
            };

            report.exerciseComparisons.push(comp);

            if (isPR) {
                report.newPRs.push(comp);
            }
        } else {
            // Esercizio eseguito per la prima volta in questa scheda (non c'è in prevExMap)
            // Se non è mai stato eseguito prima, non è un PR
            const isPR = false;
            const comp: ExerciseComparison = {
                exId: ex.exId,
                exName,
                currentVolume: currStats.volume,
                previousVolume: 0,
                volumeDelta: currStats.volume,
                volumeDeltaPercent: currStats.volume > 0 ? 100 : 0,
                currentReps: currStats.totalReps,
                previousReps: 0,
                repsDelta: currStats.totalReps,
                currentAvgWeight: currStats.avgWeight,
                previousAvgWeight: 0,
                weightDelta: currStats.avgWeight,
                isPR
            };

            report.exerciseComparisons.push(comp);
        }
    }

    report.totalVolume = currentTotalVolume;
    report.previousTotalVolume = previousTotalVolume;
    
    if (previousTotalVolume > 0) {
        report.volumeDeltaPercent = ((currentTotalVolume - previousTotalVolume) / previousTotalVolume) * 100;
    } else if (currentTotalVolume > 0 && previousTotalVolume === 0 && report.exerciseComparisons.length > 0) {
        report.volumeDeltaPercent = 100;
    }

    return report;
}
