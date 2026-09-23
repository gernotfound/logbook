import { useMemo, useState } from 'react';
import type { TrainingCycleIntent, TrainingCycleProgressionFocus } from '../../../types';
import { MUSCLES, type MuscleDef } from '../../../lib/constants/muscles';
import { CYCLE_FOCUS_LABELS, CYCLE_INTENT_LABELS, getMuscleName } from '../../../lib/trainingCycleStrategy';

interface CycleStrategyFieldsProps {
    intent: TrainingCycleIntent | '' | null;
    progressionFocus: TrainingCycleProgressionFocus | '';
    primaryMuscles: string[];
    secondaryMuscles: string[];
    hasRecordedSessions?: boolean;
    onIntentChange: (intent: TrainingCycleIntent | '') => void;
    onProgressionFocusChange: (focus: TrainingCycleProgressionFocus) => void;
    onAddMuscle: (priority: 'primary' | 'secondary', muscleId: string) => void;
    onRemoveMuscle: (priority: 'primary' | 'secondary', muscleId: string) => void;
}

const PRIORITY_MUSCLES = [...MUSCLES].sort((a, b) => a.name.localeCompare(b.name, 'it'));
const INTENTS: TrainingCycleIntent[] = ['development', 'maintenance', 'deload'];
const FOCUSES: TrainingCycleProgressionFocus[] = ['performance', 'volume', 'density', 'execution'];

function normalizeMuscleSearch(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('it')
        .replace(/[_-]+/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchesMuscleSearch(muscle: MuscleDef, query: string): boolean {
    const normalizedQuery = normalizeMuscleSearch(query);
    if (!normalizedQuery) return true;
    const searchable = normalizeMuscleSearch(`${muscle.name} ${muscle.id}`);
    return normalizedQuery.split(' ').every(token => searchable.includes(token));
}

interface MusclePriorityPickerProps {
    priority: 'primary' | 'secondary';
    ids: string[];
    enabled: boolean;
    onAddMuscle: (priority: 'primary' | 'secondary', muscleId: string) => void;
    onRemoveMuscle: (priority: 'primary' | 'secondary', muscleId: string) => void;
}

function MusclePriorityPicker({
    priority,
    ids,
    enabled,
    onAddMuscle,
    onRemoveMuscle,
}: MusclePriorityPickerProps) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const label = priority === 'primary' ? 'Focus primario' : 'Focus secondario';
    const inputId = `cycle-${priority}-muscle-search`;
    const listId = `cycle-${priority}-muscle-results`;

    const availableMuscles = useMemo(
        () => PRIORITY_MUSCLES.filter(muscle => !ids.includes(muscle.id) && matchesMuscleSearch(muscle, query)),
        [ids, query],
    );

    const selectMuscle = (muscleId: string) => {
        onAddMuscle(priority, muscleId);
        setQuery('');
        setOpen(false);
    };

    return (
        <div>
            <label htmlFor={inputId} className="text-xs text-muted font-bold block mb-4">
                {label} (opzionale)
            </label>
            <div
                className="muscle-priority-picker"
                onBlur={event => {
                    const nextTarget = event.relatedTarget as Node | null;
                    if (!nextTarget || !event.currentTarget.contains(nextTarget)) setOpen(false);
                }}
            >
                <input
                    id={inputId}
                    type="search"
                    role="combobox"
                    aria-label={`Cerca ${label.toLocaleLowerCase('it')}`}
                    aria-autocomplete="list"
                    aria-expanded={enabled && open}
                    aria-controls={listId}
                    autoComplete="off"
                    disabled={!enabled}
                    value={query}
                    onChange={event => {
                        setQuery(event.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    placeholder={enabled ? 'Cerca muscolo (es. deltoide, polpaccio...)' : 'Seleziona prima un obiettivo'}
                    className="muscle-priority-search"
                />
                {enabled && open && (
                    <div id={listId} role="listbox" aria-label={`Risultati ${label.toLocaleLowerCase('it')}`} className="muscle-priority-results">
                        {availableMuscles.length > 0 ? availableMuscles.map(muscle => (
                            <button
                                key={muscle.id}
                                type="button"
                                role="option"
                                aria-selected={false}
                                className="muscle-priority-option"
                                onClick={() => selectMuscle(muscle.id)}
                            >
                                {muscle.name}
                            </button>
                        )) : (
                            <p className="muscle-priority-empty">Nessun muscolo trovato.</p>
                        )}
                    </div>
                )}
            </div>
            {ids.length > 0 && (
                <div className="muscle-priority-selected">
                    {ids.map(id => (
                        <button
                            key={id}
                            type="button"
                            className="badge"
                            onClick={() => onRemoveMuscle(priority, id)}
                            aria-label={`Rimuovi ${getMuscleName(id)} dal focus ${priority === 'primary' ? 'primario' : 'secondario'}`}
                        >
                            {getMuscleName(id)} ×
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

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
    return (
        <section className="mb-15" aria-labelledby="cycle-strategy-title">
            <div className="mb-8">
                <h3 id="cycle-strategy-title" className="m-0 text-sm" style={{ color: 'var(--text-main)' }}>Obiettivo</h3>
                <p className="text-xs text-muted mt-4 mb-0">
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
                    enabled={Boolean(intent)}
                    onAddMuscle={onAddMuscle}
                    onRemoveMuscle={onRemoveMuscle}
                />
                <MusclePriorityPicker
                    priority="secondary"
                    ids={secondaryMuscles}
                    enabled={Boolean(intent)}
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
