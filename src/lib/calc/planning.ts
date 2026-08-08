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

    let totalWorkoutsPerWeek = 0;
    let totalSetsPerWeek = 0;
    const volumeMap = new Map<string, { label: string; sets: number }>();
    const highlightedMusclesSet = new Set<string>();
    const rawMuscleSets = new Map<string, number>();

    cycle.routines.forEach(item => {
        if (!item || !item.routineId) return;
        const routine = routineMap.get(item.routineId);
        if (!routine) return;

        const freq = Math.max(1, Number(item.frequencyPerWeek) || 1);
        totalWorkoutsPerWeek += freq;

        (routine.exercises || []).forEach(routineEx => {
            if (!routineEx || !routineEx.exId) return;
            const libEx = libraryMap.get(routineEx.exId);
            if (!libEx) return;

            const sets = Math.max(1, Number(routineEx.setsCount) || 3);
            const weeklySetsForEx = sets * freq;
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

    const totalCalculatedSets = Array.from(volumeMap.values()).reduce((sum, v) => sum + v.sets, 0);

    const muscleVolumes: MuscleVolumeDetail[] = Array.from(volumeMap.entries())
        .map(([key, data]) => ({
            key,
            label: data.label,
            sets: data.sets,
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
        totalSetsPerWeek,
        muscleVolumes,
        muscleColors,
        highlightedMuscles: Array.from(highlightedMusclesSet)
    };
}
