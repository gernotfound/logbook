import type { Exercise, TrainingCycle, WorkoutRoutine } from '../../../types';

export interface CycleMacroVolumeItem {
    key: string;
    label: string;
    sets: number;
}

function getMacroArea(muscleId: string): { key: string; label: string } {
    const value = muscleId.toLocaleLowerCase('it');
    if (value.includes('pett') || value.includes('chest')) return { key: 'chest', label: 'Petto' };
    if (value.includes('trap') || value.includes('lat') || value.includes('dors') || value.includes('schien') || value.includes('back') || value.includes('rhomboid')) {
        return { key: 'back', label: 'Dorso' };
    }
    if (value.includes('delt') || value.includes('spall') || value.includes('shoulder')) return { key: 'shoulders', label: 'Spalle' };
    if (value.includes('bicip') || value.includes('biceps') || value.includes('brachial') || value.includes('tricip') || value.includes('triceps') || value.includes('avambr') || value.includes('forearm')) {
        return { key: 'arms', label: 'Braccia' };
    }
    if (value.includes('quad')) return { key: 'quads', label: 'Quadricipiti' };
    if (value.includes('femoral') || value.includes('hamstring')) return { key: 'hamstrings', label: 'Femorali' };
    if (value.includes('glute')) return { key: 'glutes', label: 'Glutei' };
    if (value.includes('addom') || value.includes('abs') || value.includes('core') || value.includes('obliq') || value.includes('lomb') || value.includes('lower-back')) {
        return { key: 'core', label: 'Core' };
    }
    if (value.includes('adductor') || value.includes('addutt')) return { key: 'adductors', label: 'Adduttori' };
    if (value.includes('polp') || value.includes('calv')) return { key: 'calves', label: 'Polpacci' };
    return { key: 'other', label: 'Altro' };
}

export function calculateCycleMacroVolume(
    cycle: TrainingCycle | null | undefined,
    routines: WorkoutRoutine[],
    library: Exercise[]
): CycleMacroVolumeItem[] {
    if (!cycle?.routines?.length) return [];

    const routineMap = new Map(routines.map(routine => [routine.id, routine]));
    const exerciseMap = new Map(library.map(exercise => [exercise.id, exercise]));
    const validItems = cycle.routines.filter(item => routineMap.has(item.routineId));
    if (validItems.length === 0) return [];

    const frequencySum = validItems.reduce((sum, item) => sum + (Number(item.frequencyPerWeek) || 1), 0);
    const sessionsPerWeek = cycle.sessionsPerWeek ?? frequencySum;
    const scaleRatio = sessionsPerWeek / Math.max(1, frequencySum);
    const totals = new Map<string, CycleMacroVolumeItem>();

    for (const item of validItems) {
        const routine = routineMap.get(item.routineId);
        if (!routine) continue;
        const effectiveFrequency = Math.max(0.01, (Number(item.frequencyPerWeek) || 1) * scaleRatio);

        for (const routineExercise of routine.exercises ?? []) {
            const exercise = exerciseMap.get(routineExercise.exId);
            if (!exercise) continue;
            const weeklySets = Math.max(1, Number(routineExercise.setsCount) || 3) * effectiveFrequency;
            const uniqueAreas = new Map<string, { key: string; label: string }>();

            for (const muscleId of exercise.muscles ?? []) {
                if (!muscleId) continue;
                const area = getMacroArea(muscleId);
                uniqueAreas.set(area.key, area);
            }

            for (const area of uniqueAreas.values()) {
                const previous = totals.get(area.key)?.sets ?? 0;
                totals.set(area.key, { ...area, sets: previous + weeklySets });
            }
        }
    }

    return Array.from(totals.values())
        .map(item => ({ ...item, sets: Math.round(item.sets * 10) / 10 }))
        .sort((a, b) => b.sets - a.sets || a.label.localeCompare(b.label, 'it'));
}
