import { Logic } from '../../../lib/logic';
import type { Exercise } from '../../../types';

type ExerciseItem = Exercise;

export function normalizeSearch(value: string): string {
    return value
        .toLocaleLowerCase('it')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

export function trackingLabel(exercise: ExerciseItem): string {
    if (exercise.trackingType === 'time') return 'Tempo';
    if (exercise.trackingType === 'cardio') return 'Cardio';
    return 'Peso e ripetizioni';
}

export function muscleName(id: string): string {
    return Logic.getMuscleName(id) || id;
}

export function muscleList(ids?: string[]): string {
    if (!ids?.length) return 'Nessuno';
    return ids.map(muscleName).join(', ');
}

