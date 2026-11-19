import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MUSCLES, type MuscleDef } from '../../../lib/constants/muscles';
import { getMuscleName } from '../../../lib/trainingCycleStrategy';

const PRIORITY_MUSCLES = [...MUSCLES].sort((a, b) => a.name.localeCompare(b.name, 'it'));

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

export function MusclePriorityPicker({
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
