import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TrainingCycleIntent, TrainingCycleProgressionFocus } from '../../../types';
import { MUSCLES, type MuscleDef } from '../../../lib/constants/muscles';
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
    onAddMuscle: (priority: 'primary' | 'secondary', muscleId: string) => void;
    onRemoveMuscle: (priority: 'primary' | 'secondary', muscleId: string) => void;
}

function MusclePriorityPicker({
    priority,
    ids,
    onAddMuscle,
    onRemoveMuscle,
}: MusclePriorityPickerProps) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [activeMuscleId, setActiveMuscleId] = useState<string | null>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const id = useId();
    const label = priority === 'primary' ? 'Focus primario' : 'Focus secondario';
    const inputId = `${id}-input`;
    const listId = `${id}-results`;

    const availableMuscles = useMemo(
        () => PRIORITY_MUSCLES.filter(muscle => !ids.includes(muscle.id) && matchesMuscleSearch(muscle, query)),
        [ids, query],
    );

    const activeIndex = availableMuscles.findIndex(muscle => muscle.id === activeMuscleId);

    useEffect(() => {
        if (!open || activeIndex < 0) return;
        const option = resultsRef.current?.children[activeIndex];
        if (typeof option?.scrollIntoView === 'function') {
            option.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex, open]);

    const selectMuscle = (muscleId: string) => {
        if (ids.includes(muscleId)) return;
        onAddMuscle(priority, muscleId);
        setQuery('');
        setActiveMuscleId(null);
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
                    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                        setOpen(false);
                        setActiveMuscleId(null);
                    }
                }}
            >
                <input
                    id={inputId}
                    type="search"
                    role="combobox"
                    aria-label={`Cerca ${label.toLocaleLowerCase('it')}`}
                    aria-autocomplete="list"
                    aria-expanded={open}
                    aria-controls={open ? listId : undefined}
                    aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
                    autoComplete="off"
                    value={query}
                    onChange={event => {
                        setQuery(event.target.value);
                        setActiveMuscleId(null);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={event => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            setOpen(false);
                            setActiveMuscleId(null);
                        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            setOpen(true);
                            if (availableMuscles.length === 0) return;
                            const nextIndex = event.key === 'ArrowDown'
                                ? (activeIndex + 1) % availableMuscles.length
                                : activeIndex < 0 ? availableMuscles.length - 1
                                    : (activeIndex - 1 + availableMuscles.length) % availableMuscles.length;
                            setActiveMuscleId(availableMuscles[nextIndex].id);
                        } else if (event.key === 'Enter') {
                            // A search action must never submit the enclosing cycle editor.
                            event.preventDefault();
                            if (open && activeIndex >= 0) selectMuscle(availableMuscles[activeIndex].id);
                        }
                    }}
                    placeholder="Cerca muscolo (es. deltoide, polpaccio...)"
                    className="muscle-priority-search"
                />
                {open && (
                    <div id={listId} ref={resultsRef} role="listbox" aria-label={`Risultati ${label.toLocaleLowerCase('it')}`} className="muscle-priority-results">
                        {availableMuscles.length > 0 ? availableMuscles.map((muscle, index) => (
                            <button
                                key={muscle.id}
                                id={`${listId}-option-${index}`}
                                type="button"
                                role="option"
                                aria-selected={muscle.id === activeMuscleId}
                                tabIndex={-1}
                                onMouseEnter={() => setActiveMuscleId(muscle.id)}
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
