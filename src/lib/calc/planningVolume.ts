import { GROUP_MAP } from '../constants/muscles';
import { roundToTenth } from '../utils/rounding';
import { getCycleVolumeFrequencies, isRepresentableCycleVolume } from './cycleLimits';
import type { TrainingCycle, WorkoutRoutine, Exercise } from '../../types';
import type { CycleVolumeResult } from './planning';

export function getDetailedMuscleCategory(mId: string): { key: string; label: string } {
    if (!mId) return { key: 'other', label: 'Altro' };
    const low = mId.toLowerCase();

    if (low.includes('pett') || low.includes('chest')) return { key: 'chest', label: 'Petto' };
    if (low.includes('trap')) return { key: 'traps', label: 'Trapezi' };
    if (low.includes('lomb') || low.includes('lower_back') || low.includes('lower-back')) return { key: 'core', label: 'Addome e Core' };
    if (low === 'lats' || low.startsWith('lats_') || low.includes('dors') || low.includes('schien') || low.includes('back') || low.includes('rhomboid')) {
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
    if (low.includes('avambr') || low.includes('forearm') || low.includes('hand_flexors')) return { key: 'forearms', label: 'Avambracci' };
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

            const sets = Number(routineEx.setsCount);
            if (!Number.isSafeInteger(sets) || sets < 1) { invalidVolume = true; return; }
            const weeklySetsForEx = sets * effectiveFreq;
            if (!isRepresentableCycleVolume(weeklySetsForEx)) { invalidVolume = true; return; }
            totalSetsPerWeek += weeklySetsForEx;

            // Process primary muscles only (as chosen by user)
            // Repeated muscle IDs represent one primary target, including on the heatmap.
            const primaryMuscles = new Set(Array.isArray(libEx.muscles) ? libEx.muscles : []);
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
    if (invalidVolume || !isRepresentableCycleVolume(totalSetsPerWeek)
        || allVolumeValues.some(value => !isRepresentableCycleVolume(value))
        || [...rawMuscleSets.values()].some(value => !isRepresentableCycleVolume(value))) {
        return { totalWorkoutsPerWeek: 0, totalSetsPerWeek: 0, muscleVolumes: [], muscleColors: {}, highlightedMuscles: [] };
    }
    const roundedTotalSets = Math.round(totalSetsPerWeek);
    const totalCalculatedSets = allVolumeValues.reduce((sum, value) => sum + value, 0);
    if (!isRepresentableCycleVolume(totalCalculatedSets)) {
        return { totalWorkoutsPerWeek: 0, totalSetsPerWeek: 0, muscleVolumes: [], muscleColors: {}, highlightedMuscles: [] };
    }

    const muscleVolumes: CycleVolumeResult['muscleVolumes'] = Array.from(volumeMap.entries())
        .map(([key, data]) => ({
            key,
            label: data.label,
            sets: roundToTenth(data.sets),
            percentage: totalCalculatedSets > 0 ? Math.round((data.sets / totalCalculatedSets) * 100) : 0
        }))
        .sort((a, b) => b.sets - a.sets);

    // Canonical groups can overlap anatomically (e.g. chest and chest_upper).
    // Keep the strongest signal on each path: summing duplicates broad/narrow
    // targets, while last-write-wins makes the colors depend on routine order.
    const pathSets = new Map<string, number>();
    rawMuscleSets.forEach((sets, mId) => {
        const paths = GROUP_MAP[mId] ?? [mId];
        for (const path of new Set([...paths, mId])) {
            pathSets.set(path, Math.max(pathSets.get(path) ?? 0, sets));
        }
    });

    const muscleColors: Record<string, string> = {};
    const maxMuscleSets = Math.max(1, ...Array.from(rawMuscleSets.values()));
    pathSets.forEach((sets, path) => {
        const ratio = sets / maxMuscleSets;
        muscleColors[path] = ratio >= 0.75 ? '#0ea5e9'
            : ratio >= 0.4 ? '#38bdf8' : '#7dd3fc';
    });

    return {
        totalWorkoutsPerWeek,
        totalSetsPerWeek: roundedTotalSets,
        muscleVolumes,
        muscleColors,
        highlightedMuscles: Array.from(highlightedMusclesSet)
    };
}
