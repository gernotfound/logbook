import { Logic } from '../../lib/logic';
import type { UserData, WorkoutRoutine, WorkoutSession } from '../../types';

export interface WorkoutCycleInfo {
    cycleId?: string;
    cycleName?: string;
}

export interface WorkoutPreparationRuntime {
    generateId: (prefix: string) => string;
    getLocalDateString: () => string;
    now: () => number;
}

const defaultRuntime: WorkoutPreparationRuntime = {
    generateId: (prefix) => Logic.generateId(prefix),
    getLocalDateString: () => Logic.getLocalDateString(),
    now: () => new Date().getTime(),
};

export function buildRoutineWorkout(
    userData: UserData | null | undefined,
    routine: WorkoutRoutine,
    cycleInfo?: WorkoutCycleInfo,
    runtime: WorkoutPreparationRuntime = defaultRuntime,
): WorkoutSession {
    const activeCycleId = userData?.activeCycleId;
    const activeCycle = activeCycleId ? (userData?.trainingCycles || []).find(c => c.id === activeCycleId) : null;
    const belongsToActiveCycle = activeCycle && (activeCycle.routines || []).some(r => r.routineId === routine.id);

    const assignedCycleId = cycleInfo?.cycleId || (belongsToActiveCycle ? activeCycle.id : undefined);
    const assignedCycle = assignedCycleId
        ? (userData?.trainingCycles || []).find(cycle => cycle.id === assignedCycleId)
        : undefined;
    const assignedCycleName = cycleInfo?.cycleName || assignedCycle?.name || (belongsToActiveCycle ? activeCycle.name : undefined);
    const assignedCycleStrategy = assignedCycle?.strategy ? structuredClone(assignedCycle.strategy) : undefined;

    return {
        id: runtime.generateId('w'),
        routineId: routine.id,
        routineName: routine.name,
        cycleId: assignedCycleId,
        cycleName: assignedCycleName,
        ...(assignedCycleStrategy ? { cycleStrategy: assignedCycleStrategy } : {}),
        date: runtime.getLocalDateString(),
        exercises: (routine.exercises || []).map((ex: any) => {
            const libDef = (userData?.library || []).find(l => l.id === ex.exId);
            const isCardio = libDef?.trackingType === 'cardio';
            const setsCount = isCardio ? 1 : (ex.setsCount || 3);
            const sets = [];
            for (let i = 0; i < setsCount; i++) {
                const setObj: any = { id: runtime.generateId('s'), kg: '', reps: '' };
                const plan = ex.setPlans?.[i];
                const plannedTechnique = plan?.technique || ex.defaultTechnique;
                if (plannedTechnique === 'dropset' || ['rest_pause', 'cluster', 'rep_match', 'diminishing'].includes(plannedTechnique)) {
                    setObj.technique = plannedTechnique;
                    const extraSegments = plannedTechnique === 'cluster' && plan?.segmentCount
                        ? Math.max(1, plan.segmentCount - 1)
                        : 1;
                    setObj.segments = Array.from({ length: extraSegments }, () => ({
                        id: runtime.generateId('seg'),
                        kg: '',
                        reps: '',
                        ...(plan?.restSeconds !== undefined ? { restBeforeSeconds: plan.restSeconds } : {}),
                    }));
                    if (plan?.target) setObj.target = structuredClone(plan.target);
                } else if (plannedTechnique === 'isometrics') {
                    setObj.isometrics = [{ id: runtime.generateId('iso'), kg: '', time: '' }];
                }
                sets.push(setObj);
            }
            const result: any = { id: runtime.generateId('se'), exId: ex.exId, sets, sessionNote: '' };
            if (ex.defaultTechnique) result.defaultTechnique = ex.defaultTechnique;
            if (ex.setPlans) result.setPlans = structuredClone(ex.setPlans);
            if (ex.minReps) result.minReps = ex.minReps;
            if (ex.maxReps) result.maxReps = ex.maxReps;
            return result;
        }),
    };
}

export function buildFreeWorkout(runtime: WorkoutPreparationRuntime = defaultRuntime): WorkoutSession {
    return {
        id: runtime.generateId('w'),
        routineName: 'Allenamento libero',
        date: runtime.getLocalDateString(),
        exercises: [],
    };
}

export function prepareHistoricalWorkoutForEditing(
    workout: WorkoutSession,
    runtime: WorkoutPreparationRuntime = defaultRuntime,
): WorkoutSession {
    let durationStr = workout.globalDurationStr || workout.manualDurationStr;
    if (!durationStr && workout.globalStartTime && workout.globalEndTime) {
        const diff = Math.max(0, Math.floor((workout.globalEndTime - workout.globalStartTime) / 1000));
        durationStr = Logic.formatDuration(diff);
    } else {
        durationStr = Logic.normalizeDuration(durationStr);
    }

    const sanitizedExercises = (workout.exercises || []).map((ex: any) => ({
        ...ex,
        id: ex.id || runtime.generateId('se'),
        sets: (ex.sets || []).map((s: any) => ({
            ...s,
            id: s.id || runtime.generateId('s'),
            kg: s.kg !== undefined && s.kg !== null ? String(s.kg) : '',
            reps: s.reps !== undefined && s.reps !== null ? String(s.reps) : '',
            time: s.time !== undefined && s.time !== null ? String(s.time) : '',
            dropsets: (s.dropsets || []).map((ds: any) => ({
                ...ds,
                id: ds.id || runtime.generateId('ds'),
                kg: ds.kg !== undefined && ds.kg !== null ? String(ds.kg) : '',
                reps: ds.reps !== undefined && ds.reps !== null ? String(ds.reps) : '',
            })),
            isometrics: (s.isometrics || []).map((iso: any) => ({
                ...iso,
                id: iso.id || runtime.generateId('iso'),
                kg: iso.kg !== undefined && iso.kg !== null ? String(iso.kg) : '',
                time: iso.time !== undefined && iso.time !== null ? String(iso.time) : '',
            })),
            segments: Array.isArray(s.segments) ? s.segments.map((segment: any) => ({
                ...segment,
                id: segment.id || runtime.generateId('seg'),
                kg: segment.kg !== undefined && segment.kg !== null ? String(segment.kg) : '',
                reps: segment.reps !== undefined && segment.reps !== null ? String(segment.reps) : '',
                ...(segment.time !== undefined && segment.time !== null ? { time: String(segment.time) } : {}),
            })) : undefined,
        })),
    }));

    return {
        ...workout,
        exercises: sanitizedExercises,
        isEditingHistory: true,
        originalHistoryId: workout.id,
        manualDurationStr: durationStr,
    };
}

export function prepareHistoricalWorkoutForSave(
    currentWorkout: WorkoutSession,
    targetId: string,
    ratings: { mood: string; pump: string; fatigue: string },
    water: string,
    manualDuration: string,
    runtime: WorkoutPreparationRuntime = defaultRuntime,
): WorkoutSession {
    const valRes = Logic.validateWorkoutRatings(ratings.mood, ratings.pump, ratings.fatigue);
    const durationStr = Logic.normalizeDuration(
        manualDuration?.trim() || currentWorkout.manualDurationStr || currentWorkout.globalDurationStr || '00:00:00',
    );

    const updatedWorkout: WorkoutSession = {
        ...currentWorkout,
        id: targetId,
        globalDurationStr: durationStr,
        manualDurationStr: durationStr,
        moodRating: valRes.mood,
        pumpRating: valRes.pump,
        fatigueRating: valRes.fatigue,
        waterLiters: water ? parseFloat(String(water).replace(',', '.')) : 0,
        pains: Array.isArray(currentWorkout.pains) ? currentWorkout.pains : [],
        date: currentWorkout.date || runtime.getLocalDateString(),
    };

    delete updatedWorkout.isEditingHistory;
    delete updatedWorkout.originalHistoryId;
    return updatedWorkout;
}

export function prepareCompletedWorkout(
    currentWorkout: WorkoutSession,
    endTime: number,
    runtime: WorkoutPreparationRuntime = defaultRuntime,
): {
    finishedWorkout: WorkoutSession;
    diff: number;
    durationStr: string;
    sessionPains: string[];
} {
    const valRes = Logic.validateWorkoutRatings(
        String(currentWorkout.moodRating ?? ''),
        String(currentWorkout.pumpRating ?? ''),
        String(currentWorkout.fatigueRating ?? ''),
    );
    const startTime = currentWorkout.globalStartTime || endTime;
    const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
    const durationStr = Logic.formatDuration(diff);
    const sessionPains = Array.isArray(currentWorkout.pains) ? currentWorkout.pains : [];

    const finishedWorkout: WorkoutSession = {
        ...currentWorkout,
        globalEndTime: endTime,
        globalDurationStr: durationStr,
        moodRating: valRes.mood,
        pumpRating: valRes.pump,
        fatigueRating: valRes.fatigue,
        waterLiters: currentWorkout.waterLiters ? parseFloat(String(currentWorkout.waterLiters).replace(',', '.')) : 0,
        pains: sessionPains,
        date: currentWorkout.date || runtime.getLocalDateString(),
    };

    delete finishedWorkout.isEditingHistory;
    delete finishedWorkout.originalHistoryId;

    return { finishedWorkout, diff, durationStr, sessionPains };
}
