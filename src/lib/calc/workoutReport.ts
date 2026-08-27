import type { WorkoutSession, SessionExercise } from '../../types';

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
    starExercise?: ExerciseComparison;
    newPRs: ExerciseComparison[];
}

function calculateExerciseStats(ex: SessionExercise) {
    let volume = 0;
    let totalReps = 0;
    let totalWeight = 0;
    let weightCount = 0;

    for (const set of (ex.sets || [])) {
        const kgStr = String(set.kg || '').replace(',', '.');
        const kg = parseFloat(kgStr) || 0;
        const reps = parseInt(String(set.reps), 10) || 0;

        if (kg > 0 && reps > 0) {
            volume += kg * reps;
            totalReps += reps;
            totalWeight += kg;
            weightCount++;
        } else if (reps > 0) { // bodyweight
            totalReps += reps;
        }

        // Dropsets
        for (const ds of (set.dropsets || [])) {
            const dskgStr = String(ds.kg || '').replace(',', '.');
            const dskg = parseFloat(dskgStr) || 0;
            const dsreps = parseInt(String(ds.reps), 10) || 0;
            if (dskg > 0 && dsreps > 0) {
                volume += dskg * dsreps;
                totalReps += dsreps;
                totalWeight += dskg;
                weightCount++;
            } else if (dsreps > 0) {
                totalReps += dsreps;
            }
        }
    }

    const avgWeight = weightCount > 0 ? totalWeight / weightCount : 0;

    return { volume, totalReps, avgWeight };
}

export function computeWorkoutReport(currentWorkout: WorkoutSession, history: WorkoutSession[], libraryMap?: Map<string, any>): WorkoutReport {
    const routineId = currentWorkout.routineId;
    let previousWorkout: WorkoutSession | undefined;

    // Assumiamo che history sia ordinato dal più recente al più vecchio
    for (const w of history) {
        if (w.id === currentWorkout.id) continue;
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
    let starExercise: ExerciseComparison | undefined;
    let maxDeltaPercent = -Infinity;

    if (!previousWorkout) {
        for (const ex of (currentWorkout.exercises || [])) {
            const stats = calculateExerciseStats(ex);
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
        
        const currStats = calculateExerciseStats(ex);
        currentTotalVolume += currStats.volume;

        const prevEx = prevExMap.get(ex.exId);
        if (prevEx) {
            const prevStats = calculateExerciseStats(prevEx);
            previousTotalVolume += prevStats.volume;

            let volumeDelta = currStats.volume - prevStats.volume;
            let volumeDeltaPercent = 0;
            if (prevStats.volume > 0) {
                volumeDeltaPercent = (volumeDelta / prevStats.volume) * 100;
            } else if (currStats.volume > 0) {
                volumeDeltaPercent = 100;
            }

            const repsDelta = currStats.totalReps - prevStats.totalReps;
            const weightDelta = currStats.avgWeight - prevStats.avgWeight;
            const repsDeltaPercent = prevStats.totalReps > 0 ? (repsDelta / prevStats.totalReps) * 100 : (currStats.totalReps > 0 ? 100 : 0);

            // PR logic: 
            // 1) volume improved >=5%
            // 2) or avg weight improved and reps didn't drop
            // 3) or it's a bodyweight exercise (volume=0) and reps improved >=5%
            const isPR = (volumeDeltaPercent >= 5 && currStats.volume > 0) || 
                         (weightDelta > 0 && currStats.totalReps >= prevStats.totalReps) ||
                         (currStats.volume === 0 && repsDeltaPercent >= 5 && currStats.totalReps > 0);

            let exName = 'Esercizio';
            if (libraryMap && libraryMap.has(ex.exId)) {
                exName = libraryMap.get(ex.exId).name;
            }

            const comp: ExerciseComparison = {
                exId: ex.exId,
                exName: exName,
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

            if (volumeDeltaPercent > maxDeltaPercent && volumeDeltaPercent > 0 && currStats.volume > 0) {
                maxDeltaPercent = volumeDeltaPercent;
                starExercise = comp;
            }
        }
    }

    report.totalVolume = currentTotalVolume;
    report.previousTotalVolume = previousTotalVolume;
    
    if (previousTotalVolume > 0) {
        report.volumeDeltaPercent = ((currentTotalVolume - previousTotalVolume) / previousTotalVolume) * 100;
    } else if (currentTotalVolume > 0 && previousTotalVolume === 0 && report.exerciseComparisons.length > 0) {
        report.volumeDeltaPercent = 100;
    }

    report.starExercise = starExercise;

    return report;
}
