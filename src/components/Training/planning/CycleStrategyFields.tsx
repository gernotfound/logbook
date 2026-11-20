import { useId } from 'react';
import type { TrainingCycleIntent, TrainingCycleProgressionFocus } from '../../../types';
import { CYCLE_FOCUS_LABELS, CYCLE_INTENT_LABELS } from '../../../lib/trainingCycleStrategy';
import { MusclePriorityPicker } from './MusclePriorityPicker';

interface CycleStrategyFieldsProps {
    intent: TrainingCycleIntent | '';
    progressionFocus: TrainingCycleProgressionFocus | '';
    primaryMuscles: string[];
    secondaryMuscles: string[];
    hasRecordedSessions?: boolean;
    onIntentChange: (intent: TrainingCycleIntent | '') => void;
    onProgressionFocusChange: (focus: TrainingCycleProgressionFocus) => void;
    onAddMuscle: (priority: 'primary' | 'secondary', muscleId: string) => void;
    onRemoveMuscle: (priority: 'primary' | 'secondary', muscleId: string) => void;
}

const INTENTS: TrainingCycleIntent[] = ['development', 'maintenance', 'deload'];
const FOCUSES: TrainingCycleProgressionFocus[] = ['performance', 'volume', 'density', 'execution'];

export function CycleStrategyFields({
    intent,
    progressionFocus,
    primaryMuscles,
    secondaryMuscles,
    hasRecordedSessions = false,
    onIntentChange,
    onProgressionFocusChange,
    onAddMuscle,
    onRemoveMuscle,
}: CycleStrategyFieldsProps) {
    const titleId = useId();

    return (
        <section className="mb-15" aria-labelledby={titleId}>
            <div className="mb-8">
                <h3 id={titleId} className="m-0 text-sm" style={{ color: 'var(--text-main)' }}>Obiettivo</h3>
                <p className="text-base text-muted mt-4 mb-0">
                    Descrive l'intenzione del ciclo. Non modifica automaticamente schede, serie o frequenza.
                </p>
            </div>
            <div role="group" aria-label="Intento del ciclo" className="cycle-intent-grid">
                {INTENTS.map(value => (
                    <button
                        key={value}
                        type="button"
                        className={intent === value ? 'btn btn-primary' : 'btn btn-secondary'}
                        aria-pressed={intent === value}
                        onClick={() => onIntentChange(value)}
                    >
                        {CYCLE_INTENT_LABELS[value]}
                    </button>
                ))}
                <button
                    type="button"
                    className={intent === '' ? 'btn btn-primary' : 'btn btn-secondary'}
                    aria-pressed={intent === ''}
                    onClick={() => onIntentChange('')}
                >
                    Non specificato
                </button>
            </div>

            {intent === 'development' && (
                <div className="mt-15">
                    <span className="text-xs text-muted font-bold block mb-6">Cosa vuoi far progredire principalmente?</span>
                    <div role="group" aria-label="Focus principale della progressione" className="cycle-intent-grid">
                        {FOCUSES.map(value => (
                            <button
                                key={value}
                                type="button"
                                className={progressionFocus === value ? 'btn btn-primary' : 'btn btn-secondary'}
                                aria-pressed={progressionFocus === value}
                                onClick={() => onProgressionFocusChange(value)}
                            >
                                {CYCLE_FOCUS_LABELS[value]}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-15 cycle-muscle-priorities">
                <div>
                    <span className="text-xs text-muted font-bold block mb-4">Priorità muscolari</span>
                    <p className="text-xs text-muted mt-0 mb-8">
                        Sono intenzioni dichiarate e non cambiano automaticamente la programmazione.
                    </p>
                </div>
                <MusclePriorityPicker
                    priority="primary"
                    ids={primaryMuscles}
                    onAddMuscle={onAddMuscle}
                    onRemoveMuscle={onRemoveMuscle}
                />
                <MusclePriorityPicker
                    priority="secondary"
                    ids={secondaryMuscles}
                    onAddMuscle={onAddMuscle}
                    onRemoveMuscle={onRemoveMuscle}
                />
            </div>
            {hasRecordedSessions && (
                <p className="text-xs text-muted mt-12 mb-0" role="note">
                    Questo ciclo ha già sessioni registrate. Le modifiche all'obiettivo valgono per le sessioni future; le sessioni già registrate non vengono riscritte e conservano l'eventuale contesto salvato al loro avvio.
                </p>
            )}
        </section>
    );
}
