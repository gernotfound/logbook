import { format, isValid, parseISO, addDays, startOfDay, differenceInCalendarDays } from 'date-fns';
import { GROUP_MAP } from '../constants/muscles';
import type { TrainingCycle, WorkoutRoutine, Exercise } from '../../types';

export interface MuscleVolumeDetail {
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

export function calculateCycleTimeline(
    cycle: TrainingCycle | null | undefined,
    currentDate: Date | string = new Date()
): CycleTimelineInfo {
    const totalWeeks = Math.max(1, Number(cycle?.durationWeeks) || 4);

    if (!cycle?.startDate) {
        return {
            formattedStartDate: '',
            formattedEndDate: '',
            formattedRange: `${totalWeeks} settimane`,
            currentWeek: 1,
            totalWeeks,
            isStarted: true,
            isEnded: false,
            progressPercent: 0,
            statusLabel: `${totalWeeks} settimane`
        };
    }

    let parsedStart: Date;
    try {
        parsedStart = typeof cycle.startDate === 'string' && !cycle.startDate.includes('T')
            ? parseISO(cycle.startDate)
            : new Date(cycle.startDate);
        if (!isValid(parsedStart)) {
            parsedStart = new Date();
        }
    } catch {
        parsedStart = new Date();
    }

    let today: Date;
    try {
        today = typeof currentDate === 'string'
            ? (!currentDate.includes('T') ? parseISO(currentDate) : new Date(currentDate))
            : currentDate;
        if (!isValid(today)) {
            today = new Date();
        }
    } catch {
        today = new Date();
    }

    const start = startOfDay(parsedStart);
    const end = addDays(start, totalWeeks * 7 - 1);
    const now = startOfDay(today);

    const formattedStartDate = format(start, 'dd/MM/yyyy');
    const formattedEndDate = format(end, 'dd/MM/yyyy');
    const formattedRange = `dal ${formattedStartDate} al ${formattedEndDate}`;

    const diffDays = differenceInCalendarDays(now, start);
    const totalDays = totalWeeks * 7;

    if (diffDays < 0) {
        const daysToStart = Math.abs(diffDays);
        return {
            startDate: format(start, 'yyyy-MM-dd'),
            endDate: format(end, 'yyyy-MM-dd'),
            formattedStartDate,
            formattedEndDate,
            formattedRange,
            currentWeek: 0,
            totalWeeks,
            isStarted: false,
            isEnded: false,
            progressPercent: 0,
            statusLabel: daysToStart === 1 ? 'Inizia domani' : `Inizia tra ${daysToStart} giorni`,
            daysRemaining: daysToStart
        };
    }

    if (diffDays >= totalDays) {
        return {
            startDate: format(start, 'yyyy-MM-dd'),
            endDate: format(end, 'yyyy-MM-dd'),
            formattedStartDate,
            formattedEndDate,
            formattedRange,
            currentWeek: totalWeeks,
            totalWeeks,
            isStarted: true,
            isEnded: true,
            progressPercent: 100,
            statusLabel: 'Ciclo completato',
            daysRemaining: 0
        };
    }

    const currentWeek = Math.min(totalWeeks, Math.floor(diffDays / 7) + 1);
    const progressPercent = Math.min(100, Math.max(1, Math.round(((diffDays + 1) / totalDays) * 100)));
    const daysRemaining = totalDays - (diffDays + 1);

    return {
        startDate: format(start, 'yyyy-MM-dd'),
        endDate: format(end, 'yyyy-MM-dd'),
        formattedStartDate,
        formattedEndDate,
        formattedRange,
        currentWeek,
        totalWeeks,
        isStarted: true,
        isEnded: false,
        progressPercent,
        statusLabel: `Settimana ${currentWeek} di ${totalWeeks}`,
        daysRemaining
    };
}

export function getDetailedMuscleCategory(mId: string): { key: string; label: string } {
    if (!mId) return { key: 'other', label: 'Altro' };
    const low = mId.toLowerCase();

    if (low.includes('pett') || low.includes('chest')) return { key: 'chest', label: 'Petto' };
    if (low.includes('trap')) return { key: 'traps', label: 'Trapezi' };
    if (low.includes('lat') || low.includes('dors') || low.includes('schien') || low.includes('back') || low.includes('rhomboid')) {
        return { key: 'back', label: 'Dorso' };
    }
    if (low.includes('delt') || low.includes('spall') || low.includes('shoulder')) return { key: 'shoulders', label: 'Spalle' };
    if (low.includes('quad')) return { key: 'quads', label: 'Quadricipiti' };
    if (low.includes('femoral') || low.includes('hamstring')) return { key: 'hamstrings', label: 'Femorali' };
    if (low.includes('glute') || low.includes('abductor')) return { key: 'glutes', label: 'Glutei' };
    if (low.includes('adductor') || low.includes('addutt')) return { key: 'adductors', label: 'Adduttori' };
    if (low.includes('bicip') || low.includes('biceps') || low.includes('brachial')) return { key: 'biceps', label: 'Bicipiti' };
    if (low.includes('tricip') || low.includes('triceps')) return { key: 'triceps', label: 'Tricipiti' };
    if (low.includes('polp') || low.includes('calv')) return { key: 'calves', label: 'Polpacci' };
    if (low.includes('avambr') || low.includes('forearm')) return { key: 'forearms', label: 'Avambracci' };
    if (low.includes('addom') || low.includes('abs') || low.includes('core') || low.includes('obliq')) return { key: 'core', label: 'Addome e Core' };
    if (low.includes('leg') || low.includes('gamb')) return { key: 'legs', label: 'Gambe (generale)' };

    return { key: 'other', label: 'Altro' };
}

export interface ScheduledCycleSession {
    globalSessionIndex: number; // 1, 2, 3...
    sessionInWeekIndex: number; // 1, 2, ...
    routineId: string;
    routineName: string;
    rotationNumber: number; // 1, 2, ... (Giro della sequenza)
    positionInRotation: number; // 1, 2, ... N
}

export interface WeeklyCycleSchedule {
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
    routines: WorkoutRoutine[] = []
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
                routineName: found ? found.name : 'Scheda'
            };
        });

    const N = orderedRoutines.length;
    if (N === 0) return emptyResult;

    const durationWeeks = Math.max(1, Number(cycle.durationWeeks) || 4);
    
    let sessionsPerWeek = Number(cycle.sessionsPerWeek);
    if (!sessionsPerWeek || sessionsPerWeek < 1) {
        const sumFreq = cycle.routines.reduce((sum, r) => sum + (Number(r.frequencyPerWeek) || 1), 0);
        sessionsPerWeek = sumFreq > 0 ? sumFreq : N;
    }

    const totalSessions = durationWeeks * sessionsPerWeek;
    const fullRotationsCount = Math.floor(totalSessions / N);
    const remainderSessions = totalSessions % N;

    let baseStartDate: Date | null = null;
    if (cycle.startDate) {
        try {
            const parsed = typeof cycle.startDate === 'string' && !cycle.startDate.includes('T')
                ? parseISO(cycle.startDate)
                : new Date(cycle.startDate);
            if (isValid(parsed)) {
                baseStartDate = startOfDay(parsed);
            }
        } catch {
            baseStartDate = null;
        }
    }

    const weeks: WeeklyCycleSchedule[] = [];

    for (let w = 1; w <= durationWeeks; w++) {
        let startDateStr: string | undefined;
        let endDateStr: string | undefined;
        let formattedRange: string | undefined;

        if (baseStartDate) {
            const wStart = addDays(baseStartDate, (w - 1) * 7);
            const wEnd = addDays(wStart, 6);
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

    let summaryText = `${N} ${N === 1 ? 'scheda' : 'schede'} in rotazione • ${sessionsPerWeek} ${sessionsPerWeek === 1 ? 'seduta' : 'sedute'}/sett. • ${durationWeeks} sett. (${totalSessions} sedute totali`;
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

    const cycleRoutineIds = new Set(validCycleRoutines.map(r => r.routineId));
    const N = validCycleRoutines.length;
    const durationWeeks = Math.max(1, Number(cycle.durationWeeks) || 4);
    let sessionsPerWeek = Number(cycle.sessionsPerWeek);
    if (!sessionsPerWeek || sessionsPerWeek < 1) {
        const sumFreq = validCycleRoutines.reduce((sum, r) => sum + (Number(r.frequencyPerWeek) || 1), 0);
        sessionsPerWeek = sumFreq > 0 ? sumFreq : N;
    }
    const totalSessions = durationWeeks * sessionsPerWeek;

    // Filter history for completed sessions that belong to this cycle
    let completedCount = 0;
    if (Array.isArray(history) && history.length > 0) {
        completedCount = history.filter(w => {
            if (!w) return false;
            // Explicit cycleId match (if tagged with a cycle, must match this cycle.id)
            if (w.cycleId) {
                return w.cycleId === cycle.id;
            }
            // If cycle has a startDate, match routines of this cycle completed on or after startDate (legacy fallback)
            if (cycle.startDate && w.date && w.date >= cycle.startDate && w.routineId && cycleRoutineIds.has(w.routineId)) {
                return true;
            }
            return false;
        }).length;
    }

    const nextSessionIndex = completedCount + 1;
    const isCycleCompleted = completedCount >= totalSessions;

    const routineIdx = completedCount % N;
    const nextItem = validCycleRoutines[routineIdx];
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

export function calculateCycleVolume(
    cycle: TrainingCycle | null | undefined,
    routines: WorkoutRoutine[] = [],
    library: Exercise[] = []
): CycleVolumeResult {
    const routineMap = new Map<string, WorkoutRoutine>();
    routines.forEach(r => {
        if (r?.id) routineMap.set(r.id, r);
    });

    const libraryMap = new Map<string, Exercise>();
    library.forEach(e => {
        if (e?.id) libraryMap.set(e.id, e);
    });

    if (!cycle || !Array.isArray(cycle.routines) || cycle.routines.length === 0) {
        return {
            totalWorkoutsPerWeek: 0,
            totalSetsPerWeek: 0,
            muscleVolumes: [],
            muscleColors: {},
            highlightedMuscles: []
        };
    }

    const validRoutines = cycle.routines.filter(item => item && item.routineId && routineMap.has(item.routineId));
    if (validRoutines.length === 0) {
        return {
            totalWorkoutsPerWeek: 0,
            totalSetsPerWeek: 0,
            muscleVolumes: [],
            muscleColors: {},
            highlightedMuscles: []
        };
    }

    const validSumFreq = validRoutines.reduce((sum, r) => sum + (Number(r.frequencyPerWeek) || 1), 0);
    const sessionsPerWeek = cycle.sessionsPerWeek !== undefined ? Number(cycle.sessionsPerWeek) : validSumFreq;
    const scaleRatio = cycle.sessionsPerWeek !== undefined ? (sessionsPerWeek / (validSumFreq > 0 ? validSumFreq : 1)) : 1;

    let totalWorkoutsPerWeek = sessionsPerWeek;
    let totalSetsPerWeek = 0;
    const volumeMap = new Map<string, { label: string; sets: number }>();
    const highlightedMusclesSet = new Set<string>();
    const rawMuscleSets = new Map<string, number>();

    validRoutines.forEach(item => {
        const routine = routineMap.get(item.routineId);
        if (!routine) return;

        const effectiveFreq = Math.max(0.01, (Number(item.frequencyPerWeek) || 1) * scaleRatio);

        (routine.exercises || []).forEach(routineEx => {
            if (!routineEx || !routineEx.exId) return;
            const libEx = libraryMap.get(routineEx.exId);
            if (!libEx) return;

            const sets = Math.max(1, Number(routineEx.setsCount) || 3);
            const weeklySetsForEx = sets * effectiveFreq;
            totalSetsPerWeek += weeklySetsForEx;

            // Process primary muscles only (as chosen by user)
            const primaryMuscles = Array.isArray(libEx.muscles) ? libEx.muscles : [];
            const uniqueCategoriesInEx = new Set<string>();

            primaryMuscles.forEach(mId => {
                if (!mId || typeof mId !== 'string') return;
                highlightedMusclesSet.add(mId);
                rawMuscleSets.set(mId, (rawMuscleSets.get(mId) || 0) + weeklySetsForEx);

                const { key, label } = getDetailedMuscleCategory(mId);
                uniqueCategoriesInEx.add(key);
                if (!volumeMap.has(key)) {
                    volumeMap.set(key, { label, sets: 0 });
                }
            });

            // Distribute sets once per macro category per exercise to avoid double counting
            uniqueCategoriesInEx.forEach(key => {
                const current = volumeMap.get(key);
                if (current) {
                    current.sets += weeklySetsForEx;
                }
            });
        });
    });

    const roundedTotalSets = Math.round(totalSetsPerWeek);
    const totalCalculatedSets = Array.from(volumeMap.values()).reduce((sum, v) => sum + v.sets, 0);

    const muscleVolumes: MuscleVolumeDetail[] = Array.from(volumeMap.entries())
        .map(([key, data]) => ({
            key,
            label: data.label,
            sets: Math.round(data.sets * 10) / 10,
            percentage: totalCalculatedSets > 0 ? Math.round((data.sets / totalCalculatedSets) * 100) : 0
        }))
        .sort((a, b) => b.sets - a.sets);

    // Calculate glowing colors for MuscleModel heatmap
    const muscleColors: Record<string, string> = {};
    const maxMuscleSets = Math.max(1, ...Array.from(rawMuscleSets.values()));

    rawMuscleSets.forEach((sets, mId) => {
        const ratio = sets / maxMuscleSets;
        let color = '#38bdf8'; // Base light sky
        if (ratio >= 0.75) {
            color = '#0ea5e9'; // High intensity cyan
        } else if (ratio >= 0.4) {
            color = '#38bdf8'; // Medium intensity
        } else {
            color = '#7dd3fc'; // Low intensity
        }

        const atomicPaths = GROUP_MAP[mId] || [mId];
        atomicPaths.forEach(path => {
            muscleColors[path] = color;
        });
        muscleColors[mId] = color;
    });

    return {
        totalWorkoutsPerWeek,
        totalSetsPerWeek: roundedTotalSets,
        muscleVolumes,
        muscleColors,
        highlightedMuscles: Array.from(highlightedMusclesSet)
    };
}
