import { format, isValid, parseISO, addDays, startOfDay, differenceInCalendarDays } from 'date-fns';
import { GROUP_MAP } from '../constants/muscles';
import { getCycleVolumeFrequencies, isBoundedCycleCount, MAX_CALCULATED_CYCLE_WEEKS, MAX_CYCLE_SESSIONS_PER_WEEK } from './cycleLimits';
import type { TrainingCycle, WorkoutRoutine, Exercise, WorkoutSession } from '../../types';

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
    let totalWeeks = cycle?.durationWeeks ?? 4;
    if (!isBoundedCycleCount(totalWeeks, MAX_CALCULATED_CYCLE_WEEKS)) {
        return {
            formattedStartDate: '', formattedEndDate: '',
            formattedRange: 'Parametri del ciclo non validi',
            currentWeek: 0, totalWeeks: 0, isStarted: false, isEnded: false,
            progressPercent: 0, statusLabel: 'Parametri del ciclo da correggere',
        };
    }

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

    let parsedStart: Date | null = null;
    try {
        parsedStart = typeof cycle.startDate === 'string' && !cycle.startDate.includes('T')
            ? parseISO(cycle.startDate)
            : new Date(cycle.startDate);
    } catch {
        // An invalid persisted date must not be misrepresented as starting today.
    }
    if (!parsedStart || !isValid(parsedStart)) {
        return {
            formattedStartDate: '', formattedEndDate: '',
            formattedRange: 'Data di inizio del ciclo non valida',
            currentWeek: 0, totalWeeks: 0, isStarted: false, isEnded: false,
            progressPercent: 0, statusLabel: 'Parametri del ciclo da correggere',
        };
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
    let end = addDays(start, totalWeeks * 7 - 1);
    if (cycle.endDate) {
        try {
            const parsedEnd = typeof cycle.endDate === 'string' && !cycle.endDate.includes('T')
                ? parseISO(cycle.endDate)
                : new Date(cycle.endDate);
            if (isValid(parsedEnd) && differenceInCalendarDays(parsedEnd, start) >= 0) {
                end = startOfDay(parsedEnd);
            }
        } catch {
            // fallback to computed end
        }
    }
    const now = startOfDay(today);

    const formattedStartDate = format(start, 'dd/MM/yyyy');
    const formattedEndDate = format(end, 'dd/MM/yyyy');
    const formattedRange = `dal ${formattedStartDate} al ${formattedEndDate}`;

    const diffDays = differenceInCalendarDays(now, start);
    const totalDays = differenceInCalendarDays(end, start) + 1;
    totalWeeks = Math.ceil(totalDays / 7);

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

    // Suggestions follow the last actually performed planned routine, not a
    // mandatory quota or sequence. Older sessions lacking routineId retain
    // the original count-based fallback.
    const cycleHistory = Array.isArray(history) ? history.filter(w => w?.cycleId === cycle.id) : [];
    const completedCount = cycleHistory.length;
    let lastRoutineIndex: number | undefined;
    let lastTime = Number.NEGATIVE_INFINITY;
    let lastArrayIndex = -1;
    cycleHistory.forEach((workout, index) => {
        const routineIndex = availableCycleRoutines.findIndex(item => item.routineId === workout.routineId);
        if (routineIndex < 0) return;
        const recordedTime = [workout.globalEndTime, workout.endTime, workout.globalStartTime]
            .find(time => typeof time === 'number' && Number.isFinite(time));
        const parsedDate = typeof workout.date === 'string' ? parseISO(workout.date) : null;
        const time = recordedTime ?? (parsedDate && isValid(parsedDate) ? parsedDate.getTime() : 0);
        if (time > lastTime || (time === lastTime && index > lastArrayIndex)) {
            lastTime = time;
            lastArrayIndex = index;
            lastRoutineIndex = routineIndex;
        }
    });

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

    // Do not redistribute a missing routine's share onto other routines.
    const counts = getCycleVolumeFrequencies(cycle.routines, cycle.sessionsPerWeek);
    if (!counts) return {
        totalWorkoutsPerWeek: 0, totalSetsPerWeek: 0,
        muscleVolumes: [], muscleColors: {}, highlightedMuscles: [],
    };
    const sessionsPerWeek = counts.sessionsPerWeek;

    const totalWorkoutsPerWeek = sessionsPerWeek;
    let totalSetsPerWeek = 0;
    let invalidVolume = false;
    const volumeMap = new Map<string, { label: string; sets: number }>();
    const highlightedMusclesSet = new Set<string>();
    const rawMuscleSets = new Map<string, number>();

    cycle.routines.forEach((item, index) => {
        const routine = routineMap.get(item.routineId);
        if (!routine) return;

        const effectiveFreq = counts.frequencies[index];

        (routine.exercises || []).forEach(routineEx => {
            if (!routineEx || !routineEx.exId) return;
            const libEx = libraryMap.get(routineEx.exId);
            if (!libEx) return;

            const sets = Number(routineEx.setsCount || 3);
            if (!Number.isSafeInteger(sets) || sets < 1) { invalidVolume = true; return; }
            const weeklySetsForEx = sets * effectiveFreq;
            if (!Number.isFinite(weeklySetsForEx)) { invalidVolume = true; return; }
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

    const allVolumeValues = [...volumeMap.values()].map(value => value.sets);
    if (invalidVolume || !Number.isFinite(totalSetsPerWeek)
        || allVolumeValues.some(value => !Number.isFinite(value))
        || [...rawMuscleSets.values()].some(value => !Number.isFinite(value))) {
        return { totalWorkoutsPerWeek: 0, totalSetsPerWeek: 0, muscleVolumes: [], muscleColors: {}, highlightedMuscles: [] };
    }
    const roundedTotalSets = Math.round(totalSetsPerWeek);
    const totalCalculatedSets = allVolumeValues.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(totalCalculatedSets)) {
        return { totalWorkoutsPerWeek: 0, totalSetsPerWeek: 0, muscleVolumes: [], muscleColors: {}, highlightedMuscles: [] };
    }

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
