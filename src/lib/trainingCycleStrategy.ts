import { MUSCLES } from './constants/muscles';
import type { TrainingCycleStrategy } from '../types';

export const CYCLE_INTENT_LABELS: Record<TrainingCycleStrategy['intent'], string> = {
    development: 'Sviluppo',
    maintenance: 'Mantenimento',
    deload: 'Deload',
};

export const CYCLE_FOCUS_LABELS: Record<NonNullable<TrainingCycleStrategy['progressionFocus']>, string> = {
    performance: 'Performance',
    volume: 'Volume',
    density: 'Densità',
    execution: 'Esecuzione',
};

const MUSCLE_NAMES = new Map(MUSCLES.map(muscle => [muscle.id, muscle.name]));

export function getMuscleName(muscleId: string): string {
    return MUSCLE_NAMES.get(muscleId) ?? muscleId;
}

export function getCycleStrategyLabel(strategy?: TrainingCycleStrategy): string {
    if (!strategy) return 'Obiettivo non specificato';
    const intent = CYCLE_INTENT_LABELS[strategy.intent];
    if (strategy.intent === 'development' && strategy.progressionFocus) {
        return `${intent} · Focus ${CYCLE_FOCUS_LABELS[strategy.progressionFocus].toLowerCase()}`;
    }
    return intent;
}
