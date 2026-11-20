import type { SessionExerciseSet, SetTechnique, WorkoutSession } from '../../types';
import type { ProgressionExerciseRef } from './progression';

export const bench: ProgressionExerciseRef = {
    id: 'bench',
    name: 'Panca piana',
    trackingType: 'weight_reps',
    isBodyweight: false,
    equipmentWeight: 0,
    muscles: ['chest'],
    secondaryMuscles: ['triceps'],
};

export const pullup: ProgressionExerciseRef = {
    id: 'pullup',
    name: 'Trazioni',
    trackingType: 'weight_reps',
    isBodyweight: true,
    equipmentWeight: 0,
    muscles: ['lats'],
    secondaryMuscles: ['biceps'],
};

const legExtension: ProgressionExerciseRef = {
    id: 'leg-extension',
    name: 'Leg extension',
    trackingType: 'weight_reps',
    isBodyweight: false,
    equipmentWeight: 0,
    muscles: ['quadriceps'],
    secondaryMuscles: [],
};

export const plank: ProgressionExerciseRef = {
    id: 'plank',
    name: 'Plank',
    trackingType: 'time',
    isBodyweight: false,
    equipmentWeight: 0,
    muscles: ['abs'],
    secondaryMuscles: [],
};

export const library = new Map<string, ProgressionExerciseRef>([
    [plank.id, plank],
    [bench.id, bench],
    [pullup.id, pullup],
    [legExtension.id, legExtension],
]);

export function set(
    kg: number | string,
    reps: number | string,
    rir?: number,
    extra: Partial<SessionExerciseSet> = {},
): SessionExerciseSet {
    return {
        id: extra.id || `s-${kg}-${reps}-${rir ?? 'x'}`,
        kg: String(kg),
        reps: String(reps),
        ...(rir !== undefined ? { rir } : {}),
        ...extra,
    };
}

export function timedSet(time?: string, extra: Partial<SessionExerciseSet> = {}): SessionExerciseSet {
    return {
        id: `time-${time ?? 'missing'}`,
        kg: '',
        reps: '',
        technique: 'straight',
        ...(time !== undefined ? { time } : {}),
        ...extra,
    };
}

export function workout(options: {
    id: string;
    date: string;
    routineId?: string;
    cycleId?: string;
    intent?: 'development' | 'maintenance' | 'deload';
    focus?: 'performance' | 'volume' | 'density' | 'execution';
    exId?: string;
    sets?: SessionExerciseSet[];
    exercises?: WorkoutSession['exercises'];
    duration?: string;
    primaryMuscles?: string[];
    secondaryMuscles?: string[];
}): WorkoutSession {
    const strategy = options.intent || options.focus || options.primaryMuscles || options.secondaryMuscles
        ? {
            ...(options.intent ? { intent: options.intent } : {}),
            ...(options.focus ? { progressionFocus: options.focus } : {}),
            ...(options.primaryMuscles ? { primaryMuscles: options.primaryMuscles } : {}),
            ...(options.secondaryMuscles ? { secondaryMuscles: options.secondaryMuscles } : {}),
        }
        : undefined;
    return {
        id: options.id,
        date: options.date,
        routineId: options.routineId,
        routineName: options.routineId || 'Sessione',
        cycleId: options.cycleId,
        ...(strategy ? { cycleStrategy: strategy } : {}),
        ...(options.duration ? { globalDurationStr: options.duration } : {}),
        exercises: options.exercises || [{
            exId: options.exId || 'bench',
            sessionNote: '',
            sets: options.sets || [],
        }],
    };
}

export function advancedSet(
    technique: Exclude<SetTechnique, 'straight'>,
    rir = 2,
    restBeforeSeconds = 20,
): SessionExerciseSet {
    return set(100, 8, rir, {
        technique,
        target: technique === 'rep_match' || technique === 'diminishing'
            ? { type: 'reps', reps: 8 }
            : undefined,
        segments: [{
            id: `seg-${technique}`,
            kg: technique === 'cluster' ? '100' : '90',
            reps: '3',
            restBeforeSeconds,
        }],
    });
}
