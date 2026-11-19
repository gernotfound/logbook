import { format, isValid, parseISO, addDays } from 'date-fns';
import { getCycleVolumeFrequencies, isBoundedCycleCount, MAX_CALCULATED_CYCLE_WEEKS, MAX_CYCLE_SESSIONS_PER_WEEK } from './cycleLimits';
import { calculateCycleTimeline } from './planningTimeline';
import type { TrainingCycle, WorkoutRoutine, WorkoutSession } from '../../types';
import type { NextScheduledRoutineResult } from './planning';

interface ScheduledCycleSession {
    globalSessionIndex: number; // 1, 2, 3...
    sessionInWeekIndex: number; // 1, 2, ...
    routineId: string;
    routineName: string;
    rotationNumber: number; // 1, 2, ... (Giro della sequenza)
    positionInRotation: number; // 1, 2, ... N
}

interface WeeklyCycleSchedule {
    weekNumber: number;
    startDateStr?: string;
    endDateStr?: string;
    formattedRange?: string;
    sessions: ScheduledCycleSession[];
}

export interface CycleScheduleResult {
    weeks: WeeklyCycleSchedule[];
    totalSessions: number;
    sessionsPerWeek: number;
    totalRoutines: number;
    fullRotationsCount: number;
    remainderSessions: number;
    summaryText: string;
}

export function calculateCycleSchedule(
    cycle: TrainingCycle | null | undefined,
    routines: WorkoutRoutine[] = [],
    includeWeeks = true,
): CycleScheduleResult {
    const emptyResult: CycleScheduleResult = {
        weeks: [],
        totalSessions: 0,
        sessionsPerWeek: 0,
        totalRoutines: 0,
        fullRotationsCount: 0,
        remainderSessions: 0,
        summaryText: ''
    };

    if (!cycle || !Array.isArray(cycle.routines) || cycle.routines.length === 0) {
        return emptyResult;
    }

    const routineMap = new Map<string, WorkoutRoutine>();
    routines.forEach(r => {
        if (r?.id) routineMap.set(r.id, r);
    });

    const orderedRoutines = cycle.routines
        .filter(item => item && item.routineId)
        .map(item => {
            const found = routineMap.get(item.routineId);
            return {
                routineId: item.routineId,
                routineName: found ? found.name : 'Scheda non disponibile'
            };
        });

    const N = orderedRoutines.length;
    if (N === 0) return emptyResult;

    const durationWeeks = cycle.durationWeeks;
    if (!isBoundedCycleCount(durationWeeks, MAX_CALCULATED_CYCLE_WEEKS)) {
        return { ...emptyResult, summaryText: 'Parametri del ciclo da correggere' };
    }
    
    const counts = getCycleVolumeFrequencies(cycle.routines, cycle.sessionsPerWeek);
    if (!counts) return { ...emptyResult, summaryText: 'Parametri del ciclo da correggere' };
    const sessionsPerWeek = counts.sessionsPerWeek;

    if (!isBoundedCycleCount(sessionsPerWeek, MAX_CYCLE_SESSIONS_PER_WEEK)) {
        return { ...emptyResult, summaryText: 'Parametri del ciclo da correggere' };
    }
    // The explicit end date defines the period when present; durationWeeks
    // remains a compatible fallback for undated or historical cycles.
    const timeline = calculateCycleTimeline(cycle);
    const effectiveWeeks = timeline.totalWeeks;
    if (!isBoundedCycleCount(effectiveWeeks, MAX_CALCULATED_CYCLE_WEEKS)) {
        return { ...emptyResult, summaryText: 'Parametri del ciclo da correggere' };
    }
    const totalSessions = effectiveWeeks * sessionsPerWeek;
    const fullRotationsCount = Math.floor(totalSessions / N);
    const remainderSessions = totalSessions % N;

    const baseStartDate = includeWeeks && timeline.startDate ? parseISO(timeline.startDate) : null;
    const finalDate = includeWeeks && timeline.endDate ? parseISO(timeline.endDate) : null;
    const weeks: WeeklyCycleSchedule[] = [];

    for (let w = 1; includeWeeks && w <= effectiveWeeks; w++) {
        let startDateStr: string | undefined;
        let endDateStr: string | undefined;
        let formattedRange: string | undefined;

        if (baseStartDate) {
            const wStart = addDays(baseStartDate, (w - 1) * 7);
            const nominalEnd = addDays(wStart, 6);
            const wEnd = finalDate && nominalEnd > finalDate ? finalDate : nominalEnd;
            startDateStr = format(wStart, 'yyyy-MM-dd');
            endDateStr = format(wEnd, 'yyyy-MM-dd');
            formattedRange = `${format(wStart, 'dd/MM')} - ${format(wEnd, 'dd/MM')}`;
        }

        const weekSessions: ScheduledCycleSession[] = [];
        for (let s = 0; s < sessionsPerWeek; s++) {
            const globalIdx = (w - 1) * sessionsPerWeek + s;
            const routineIdx = globalIdx % N;
            const routineItem = orderedRoutines[routineIdx];
            const rotationNumber = Math.floor(globalIdx / N) + 1;
            const positionInRotation = routineIdx + 1;

            weekSessions.push({
                globalSessionIndex: globalIdx + 1,
                sessionInWeekIndex: s + 1,
                routineId: routineItem.routineId,
                routineName: routineItem.routineName,
                rotationNumber,
                positionInRotation
            });
        }

        weeks.push({
            weekNumber: w,
            startDateStr,
            endDateStr,
            formattedRange,
            sessions: weekSessions
        });
    }

    let summaryText = `${N} ${N === 1 ? 'scheda' : 'schede'} in rotazione • ${sessionsPerWeek} ${sessionsPerWeek === 1 ? 'seduta' : 'sedute'}/sett. • ${effectiveWeeks} sett. (${totalSessions} sedute totali`;
    if (fullRotationsCount > 0) {
        summaryText += ` = ${fullRotationsCount} ${fullRotationsCount === 1 ? 'giro completo' : 'giri completi'}`;
        if (remainderSessions > 0) {
            summaryText += ` + ${remainderSessions} ${remainderSessions === 1 ? 'seduta' : 'sedute'}`;
        }
    }
    summaryText += ')';

    return {
        weeks,
        totalSessions,
        sessionsPerWeek,
        totalRoutines: N,
        fullRotationsCount,
        remainderSessions,
        summaryText
    };
}

export function getNextScheduledRoutine(
    cycle: TrainingCycle | null | undefined,
    routines: WorkoutRoutine[] = [],
    history: WorkoutSession[] = []
): NextScheduledRoutineResult | null {
    if (!cycle || !Array.isArray(cycle.routines) || cycle.routines.length === 0) {
        return null;
    }

    const routineMap = new Map<string, WorkoutRoutine>();
    routines.forEach(r => {
        if (r?.id) routineMap.set(r.id, r);
    });

    const validCycleRoutines = cycle.routines.filter(r => r && r.routineId);
    if (validCycleRoutines.length === 0) return null;

    // The persisted plan may reference a deleted routine: keep its numeric target,
    // but never suggest a routine which no longer exists in the library.
    const availableCycleRoutines = validCycleRoutines.filter(item => routineMap.has(item.routineId));
    if (availableCycleRoutines.length === 0) return null;
    const N = availableCycleRoutines.length;
    const durationWeeks = cycle.durationWeeks;
    if (!isBoundedCycleCount(durationWeeks, MAX_CALCULATED_CYCLE_WEEKS)) return null;
    const counts = getCycleVolumeFrequencies(validCycleRoutines, cycle.sessionsPerWeek);
    if (!counts) return null;
    const sessionsPerWeek = counts.sessionsPerWeek;
    const effectiveWeeks = calculateCycleTimeline(cycle).totalWeeks;
    if (!isBoundedCycleCount(effectiveWeeks, MAX_CALCULATED_CYCLE_WEEKS)) return null;
    const totalSessions = effectiveWeeks * sessionsPerWeek;

    // Suggestions follow the last performed planned routine, not a compulsory
    // order. A cycle ID without a routine ID does not prove a planned session.
    let completedCount = 0;
    let lastRoutineIndex: number | undefined;
    let lastTime = Number.NEGATIVE_INFINITY;
    const routineIndexById = new Map(availableCycleRoutines.map((item, index) => [item.routineId, index]));
    for (const workout of Array.isArray(history) ? history : []) {
        if (workout?.cycleId !== cycle.id || !workout.routineId) continue;
        completedCount++;
        const routineIndex = routineIndexById.get(workout.routineId ?? '');
        if (routineIndex === undefined) continue;
        const recordedTime = [workout.globalEndTime, workout.globalStartTime]
            .find(time => typeof time === 'number' && Number.isFinite(time) && isValid(new Date(time)));
        const parsedDate = typeof workout.date === 'string' ? parseISO(workout.date) : null;
        const time = recordedTime ?? (parsedDate && isValid(parsedDate) ? parsedDate.getTime() : 0);
        // For equal timestamps, the later entry in history still wins.
        if (time >= lastTime) {
            lastTime = time;
            lastRoutineIndex = routineIndex;
        }
    }

    const nextSessionIndex = completedCount + 1;
    const isCycleCompleted = completedCount >= totalSessions;

    const routineIdx = lastRoutineIndex === undefined ? completedCount % N : (lastRoutineIndex + 1) % N;
    const nextItem = availableCycleRoutines[routineIdx];
    const nextRoutine = nextItem ? routineMap.get(nextItem.routineId) : undefined;
    const rotationNumber = Math.floor(completedCount / N) + 1;
    const positionInRotation = routineIdx + 1;

    return {
        nextRoutine,
        nextRoutineId: nextItem?.routineId,
        nextRoutineName: nextRoutine ? nextRoutine.name : 'Scheda',
        nextSessionIndex,
        completedCount,
        totalSessions,
        rotationNumber,
        positionInRotation,
        totalRoutinesInCycle: N,
        isCycleCompleted
    };
}
