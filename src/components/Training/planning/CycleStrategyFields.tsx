import type { TrainingCycleIntent, TrainingCycleProgressionFocus } from '../../../types';
import { MUSCLES } from '../../../lib/constants/muscles';
import { CYCLE_FOCUS_LABELS, CYCLE_INTENT_LABELS, getMuscleName } from '../../../lib/trainingCycleStrategy';

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

const PRIORITY_MUSCLES = MUSCLES.filter(muscle =>
    !muscle.id.endsWith('_left') && !muscle.id.endsWith('_right')
).sort((a, b) => a.name.localeCompare(b.name, 'it'));

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
    const renderPriority = (priority: 'primary' | 'secondary', ids: string[]) => {
        const availableMuscles = PRIORITY_MUSCLES.filter(muscle => !ids.includes(muscle.id));
        return (
        <div>
            <label htmlFor={`cycle-${priority}-muscle`} className="text-xs text-muted font-bold block mb-4">
                {priority === 'primary' ? 'Focus primario' : 'Focus secondario'} (opzionale)
            </label>
            <select
                id={`cycle-${priority}-muscle`}
                aria-label={priority === 'primary' ? 'Aggiungi focus primario' : 'Aggiungi focus secondario'}
                value=""
                onChange={event => onAddMuscle(priority, event.target.value)}
                disabled={!intent}
                style={{ width: '100%', fontSize: '16px', minHeight: '44px', boxSizing: 'border-box' }}
            >
                <option value="">{intent ? '+ Aggiungi muscolo' : 'Seleziona prima un obiettivo'}</option>
                {availableMuscles.map(muscle => (
                    <option key={muscle.id} value={muscle.id}>{muscle.name}</option>
                ))}
            </select>
            {ids.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {ids.map(id => (
                        <button
                            key={id}
                            type="button"
                            className="badge"
                            onClick={() => onRemoveMuscle(priority, id)}
                            aria-label={`Rimuovi ${getMuscleName(id)} dal focus ${priority === 'primary' ? 'primario' : 'secondario'}`}
                            style={{ minHeight: '44px', cursor: 'pointer', color: 'var(--text-main)', border: '1px solid var(--glass-border)' }}
                        >
                            {getMuscleName(id)} ×
                        </button>
                    ))}
                </div>
            )}
        </div>
        );
    };

    return (
        <section className="mb-15" aria-labelledby="cycle-strategy-title">
            <div className="mb-8">
                <h3 id="cycle-strategy-title" className="m-0 text-sm" style={{ color: 'var(--text-main)' }}>Obiettivo</h3>
                <p className="text-xs text-muted mt-4 mb-0">
                    Descrive l'intenzione del ciclo. Non modifica automaticamente schede, serie o frequenza.
                </p>
            </div>
            <div role="group" aria-label="Intento del ciclo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
                {INTENTS.map(value => (
                    <button
                        key={value}
                        type="button"
                        className={intent === value ? 'btn btn-primary' : 'btn btn-secondary'}
                        aria-pressed={intent === value}
                        onClick={() => onIntentChange(value)}
                        style={{ marginBottom: 0, minHeight: '44px' }}
                    >
                        {CYCLE_INTENT_LABELS[value]}
                    </button>
                ))}
                {intent && (
                    <button
                        type="button"
                        className="btn btn-secondary"
                        aria-pressed={false}
                        onClick={() => onIntentChange('')}
                        style={{ marginBottom: 0, minHeight: '44px' }}
                    >
                        Non specificato
                    </button>
                )}
            </div>

            {intent === 'development' && (
                <div className="mt-15">
                    <span className="text-xs text-muted font-bold block mb-6">Cosa vuoi far progredire principalmente?</span>
                    <div role="group" aria-label="Focus principale della progressione" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
                        {FOCUSES.map(value => (
                            <button
                                key={value}
                                type="button"
                                className={progressionFocus === value ? 'btn btn-primary' : 'btn btn-secondary'}
                                aria-pressed={progressionFocus === value}
                                onClick={() => onProgressionFocusChange(value)}
                                style={{ marginBottom: 0, minHeight: '44px' }}
                            >
                                {CYCLE_FOCUS_LABELS[value]}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-15" style={{ display: 'grid', gap: '12px' }}>
                <div>
                    <span className="text-xs text-muted font-bold block mb-4">Priorità muscolari</span>
                    <p className="text-xs text-muted mt-0 mb-8">Sono intenzioni dichiarate e non cambiano automaticamente la programmazione.</p>
                </div>
                {renderPriority('primary', primaryMuscles)}
                {renderPriority('secondary', secondaryMuscles)}
            </div>
            {hasRecordedSessions && (
                <p className="text-xs text-muted mt-12 mb-0" role="note">
                    Questo ciclo ha già sessioni registrate. Le modifiche all'obiettivo valgono per le sessioni future; le sessioni già registrate non vengono riscritte e conservano l'eventuale contesto salvato al loro avvio.
                </p>
            )}
        </section>
    );
}
