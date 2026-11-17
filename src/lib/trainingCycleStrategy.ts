import { MUSCLES } from './constants/muscles';
import type { TrainingCycleIntent, TrainingCycleStrategy } from '../types';

export const CYCLE_INTENT_LABELS: Record<TrainingCycleIntent, string> = {
    development: 'Sviluppo',
    maintenance: 'Mantenimento',
    deload: 'Deload',
};

export const CYCLE_FOCUS_LABELS: Record<NonNullable<TrainingCycleStrategy['progressionFocus']>, string> = {
    performance: 'Performance',
    volume: 'Volume',
    density: 'Densit\u00e0',
    execution: 'Esecuzione',
};

const MUSCLE_NAMES = new Map(MUSCLES.map(muscle => [muscle.id, muscle.name]));

export function getMuscleName(muscleId: string): string {
    return MUSCLE_NAMES.get(muscleId) ?? muscleId;
}

export function getCycleStrategyLabel(strategy?: TrainingCycleStrategy): string {
    if (!strategy?.intent) return 'Obiettivo non specificato';
    const intent = CYCLE_INTENT_LABELS[strategy.intent];
    if (strategy.intent === 'development' && strategy.progressionFocus) {
        return `${intent} \u00b7 Focus ${CYCLE_FOCUS_LABELS[strategy.progressionFocus].toLowerCase()}`;
    }
    return intent;
}
