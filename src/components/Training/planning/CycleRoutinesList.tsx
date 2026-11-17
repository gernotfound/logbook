import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, Trash2 } from 'lucide-react';
import type { Exercise, TrainingCycleRoutineItem, WorkoutRoutine } from '../../../types';

interface CycleRoutinesListProps {
    cycleRoutines: TrainingCycleRoutineItem[];
    routines: WorkoutRoutine[];
    library?: Exercise[];
    onAdd: (routineId: string) => void;
    onMove: (index: number, direction: -1 | 1) => void;
    onRemove: (index: number) => void;
}

const EMPTY_LIBRARY: Exercise[] = [];

export const CycleRoutinesList = memo(function CycleRoutinesList({
    cycleRoutines,
    routines,
    library = EMPTY_LIBRARY,
    onAdd,
    onMove,
    onRemove
}: CycleRoutinesListProps) {
    const [query, setQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [activeRoutineId, setActiveRoutineId] = useState<string | null>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const resultsId = useId();
    const exerciseNames = useMemo(() => new Map(library.map(exercise => [exercise.id, exercise.name])), [library]);
    const routineMap = useMemo(() => new Map(routines.map(routine => [routine.id, routine])), [routines]);
    const selectedIds = useMemo(() => new Set(cycleRoutines.map(item => item.routineId)), [cycleRoutines]);

    const matches = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase('it');
        return routines.filter(routine => {
            if (selectedIds.has(routine.id)) return false;
            if (!normalized) return true;
            const names = (routine.exercises ?? [])
                .map(item => exerciseNames.get(item.exId) ?? '')
                .filter(Boolean);
            return [routine.id, routine.name, ...names]
                .join(' ')
                .toLocaleLowerCase('it')
                .includes(normalized);
        });
    }, [exerciseNames, query, routines, selectedIds]);
    const activeIndex = matches.findIndex(routine => routine.id === activeRoutineId);

    useEffect(() => {
        if (!isSearchOpen || activeIndex < 0) return;
        const activeOption = resultsRef.current?.children[activeIndex];
        if (typeof activeOption?.scrollIntoView === 'function') {
            activeOption.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex, isSearchOpen]);

    const addRoutine = (routineId: string) => {
        if (selectedIds.has(routineId)) return;
        onAdd(routineId);
        setQuery('');
        setActiveRoutineId(null);
        setIsSearchOpen(false);
    };

    return (
        <section className="planning-sequence" aria-labelledby={`${resultsId}-title`}>
            <div className="planning-section-copy">
                <h3 id={`${resultsId}-title`}>Sequenza rotazione schede ({cycleRoutines.length})</h3>
                <p>La sequenza continua da una seduta alla successiva, senza giorni fissi.</p>
            </div>

            <div className="planning-routine-search">
                <label htmlFor={`${resultsId}-input`}>Aggiungi scheda</label>
                <div className="planning-search-field">
                    <Search size={20} aria-hidden="true" />
                    <input
                        id={`${resultsId}-input`}
                        type="search"
                        role="combobox"
                        aria-label="Aggiungi scheda alla sequenza"
                        aria-controls={isSearchOpen ? resultsId : undefined}
                        aria-expanded={isSearchOpen}
                        aria-activedescendant={isSearchOpen && activeIndex >= 0 ? `${resultsId}-option-${activeIndex}` : undefined}
                        aria-autocomplete="list"
                        autoComplete="off"
                        placeholder="Cerca scheda o esercizio"
                        value={query}
                        onFocus={() => setIsSearchOpen(true)}
                        onKeyDown={event => {
                            if (event.key === 'Escape') {
                                setIsSearchOpen(false);
                                setActiveRoutineId(null);
                            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                event.preventDefault();
                                setIsSearchOpen(true);
                                if (matches.length === 0) return;
                                const nextIndex = event.key === 'ArrowDown'
                                    ? (activeIndex + 1) % matches.length
                                    : activeIndex < 0 ? matches.length - 1 : (activeIndex - 1 + matches.length) % matches.length;
                                setActiveRoutineId(matches[nextIndex].id);
                            } else if (event.key === 'Enter') {
                                // The search input must not submit the enclosing cycle form.
                                event.preventDefault();
                                if (isSearchOpen && activeIndex >= 0) addRoutine(matches[activeIndex].id);
                            }
                        }}
                        onChange={event => {
                            const value = event.target.value;
                            const exactRoutine = routineMap.get(value);
                            if (exactRoutine && !selectedIds.has(exactRoutine.id)) {
                                addRoutine(exactRoutine.id);
                                return;
                            }
                            setQuery(value);
                            setActiveRoutineId(null);
                            setIsSearchOpen(true);
                        }}
                    />
                </div>
                <span className="planning-helper">Puoi cercare anche il nome di un esercizio contenuto nella scheda.</span>

                {isSearchOpen ? (
                    <div id={resultsId} ref={resultsRef} className="planning-search-results" role="listbox" aria-label="Risultati schede">
                        {matches.length === 0 ? (
                            <p className="planning-search-empty">
                                {routines.length === 0
                                    ? 'Crea una scheda prima di aggiungerla al ciclo.'
                                    : routines.every(routine => selectedIds.has(routine.id))
                                        ? 'Tutte le schede disponibili sono già nella sequenza.'
                                        : 'Nessuna scheda contiene questa ricerca.'}
                            </p>
                        ) : matches.map((routine, index) => {
                            const names = (routine.exercises ?? [])
                                .map(item => exerciseNames.get(item.exId) ?? '')
                                .filter(Boolean);
                            return (
                                <button
                                    key={routine.id}
                                    id={`${resultsId}-option-${index}`}
                                    type="button"
                                    role="option"
                                    aria-selected={routine.id === activeRoutineId}
                                    tabIndex={-1}
                                    className="planning-search-result"
                                    onMouseEnter={() => setActiveRoutineId(routine.id)}
                                    onClick={() => addRoutine(routine.id)}
                                >
                                    <strong>{routine.name}</strong>
                                    <span>{names.length ? names.join(' · ') : `${routine.exercises?.length ?? 0} esercizi`}</span>
                                </button>
                            );
                        })}
                    </div>
                ) : null}
            </div>

            {cycleRoutines.length === 0 ? (
                <div className="planning-empty-inline">Aggiungi almeno una scheda per costruire la rotazione.</div>
            ) : (
                <div className="planning-sequence-list">
                    {cycleRoutines.map((item, index) => {
                        const routine = routineMap.get(item.routineId);
                        const name = routine?.name ?? 'Scheda non disponibile';
                        return (
                            <div key={`${item.routineId}-${index}`} className="planning-sequence-row">
                                <span className="planning-sequence-index" aria-hidden="true">{String.fromCharCode(65 + (index % 26))}</span>
                                <div className="planning-sequence-name">
                                    <strong>{name}</strong>
                                    <span>Posizione {index + 1} di {cycleRoutines.length} · {routine?.exercises?.length ?? 0} esercizi</span>
                                </div>
                                <div className="planning-sequence-actions">
                                    <button
                                        type="button"
                                        onClick={() => onMove(index, -1)}
                                        disabled={index === 0}
                                        aria-label={`Sposta ${name} verso l'alto`}
                                        title="Sposta su nella sequenza"
                                    >
                                        <ChevronUp size={20} aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onMove(index, 1)}
                                        disabled={index === cycleRoutines.length - 1}
                                        aria-label={`Sposta ${name} verso il basso`}
                                        title="Sposta giù nella sequenza"
                                    >
                                        <ChevronDown size={20} aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        className="danger"
                                        onClick={() => onRemove(index)}
                                        aria-label={`Rimuovi ${name} dalla sequenza`}
                                        title="Rimuovi scheda dalla sequenza"
                                    >
                                        <Trash2 size={20} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
});
