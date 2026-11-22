import { useMemo, type MouseEvent } from 'react';
import { Search, X } from 'lucide-react';
import type { Exercise, WorkoutRoutine } from '../../../types';
import { RoutineCard } from './RoutineCard';

interface RoutineLibraryListProps {
    routines: WorkoutRoutine[];
    library: Exercise[];
    libraryById?: ReadonlyMap<string, Exercise>;
    expandedRoutineId: string | null;
    onToggleExpand: (id: string) => void;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    onEdit?: (routine: WorkoutRoutine) => void;
    onDuplicate?: (routine: WorkoutRoutine, event: MouseEvent) => void;
    onDelete?: (id: string, event: MouseEvent) => void;
}

export function RoutineLibraryList({
    routines, library, libraryById, expandedRoutineId,
    onToggleExpand, searchQuery, onSearchQueryChange,
    onEdit, onDuplicate, onDelete,
}: RoutineLibraryListProps) {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('it');
    const filteredRoutines = useMemo(
        () => routines.filter(routine => (
            !normalizedQuery || routine.name.toLocaleLowerCase('it').includes(normalizedQuery)
        )),
        [normalizedQuery, routines],
    );
    const indexedLibrary = useMemo(
        () => libraryById ?? new Map(library.map(item => [item.id, item] as const)),
        [library, libraryById],
    );

    return (
        <>
            <div className="routine-library-search">
                <Search size={18} aria-hidden="true" />
                <input
                    type="search"
                    value={searchQuery}
                    onChange={event => onSearchQueryChange(event.target.value)}
                    placeholder="Cerca scheda per nome"
                    aria-label="Cerca scheda per nome"
                />
                {searchQuery && (
                    <button
                        type="button"
                        className="routine-search-clear"
                        onClick={() => onSearchQueryChange('')}
                        aria-label="Cancella ricerca"
                    >
                        <X size={18} aria-hidden="true" />
                    </button>
                )}
            </div>

            <div className="routine-section-head">
                <h3>Libreria schede</h3>
                <span>{filteredRoutines.length} {filteredRoutines.length === 1 ? 'scheda' : 'schede'}</span>
            </div>

            {routines.length === 0 ? (
                <div className="routine-empty-state">Nessuna scheda creata.</div>
            ) : filteredRoutines.length === 0 ? (
                <div className="routine-empty-state">Nessuna scheda trovata.</div>
            ) : (
                <div className="routine-library-list" aria-live="polite">
                    {filteredRoutines.map(routine => (
                        <RoutineCard
                            key={routine.id}
                            routine={routine}
                            isExpanded={expandedRoutineId === routine.id}
                            library={library}
                            libraryById={indexedLibrary}
                            onToggleExpand={onToggleExpand}
                            onEdit={onEdit}
                            onDuplicate={onDuplicate}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}
        </>
    );
}
