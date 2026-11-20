import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
    Activity,
    ChevronRight,
    Dumbbell,
    Search,
    Timer,
    X,
} from 'lucide-react';
import type { useTrainingExercises } from '../../../hooks/useTrainingExercises';
import { ExerciseDetail } from './ExerciseDetail';
import { muscleName, normalizeSearch, trackingLabel } from './exerciseArchivePresentation';

type TrainingExercisesHook = ReturnType<typeof useTrainingExercises>;
type ExerciseItem = TrainingExercisesHook['library'][number];
const ARCHIVE_PAGE_SIZE = 50;

interface ExerciseArchiveProps {
    library: TrainingExercisesHook['library'];
    routines: TrainingExercisesHook['routines'];
    selectedExId: string | null;
    onSelectedExIdChange: (id: string | null) => void;
    onEditItem: (exercise: ExerciseItem) => void;
    onDuplicate: TrainingExercisesHook['handleDuplicate'];
    onDelete: (id: string, event: MouseEvent) => void | Promise<void>;
}

function TrackingIcon({ exercise }: { exercise: ExerciseItem }) {
    if (exercise.trackingType === 'cardio') return <Activity size={18} aria-hidden="true" />;
    if (exercise.trackingType === 'time') return <Timer size={18} aria-hidden="true" />;
    return <Dumbbell size={18} aria-hidden="true" />;
}

export function ExerciseArchive({
    library,
    routines,
    selectedExId,
    onSelectedExIdChange,
    onEditItem,
    onDuplicate,
    onDelete,
}: ExerciseArchiveProps) {
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(() => ({ query: '', source: library, count: ARCHIVE_PAGE_SIZE }));
    const updateQuery = (value: string) => {
        setQuery(value);
        setPage({ query: value, source: library, count: ARCHIVE_PAGE_SIZE });
    };
    const routineCounts = useMemo(() => {
        const counts = new Map<string, number>();
        routines.forEach(routine => {
            const exerciseIds = new Set<string>(
                (routine.exercises || [])
                    .map(exercise => exercise.exId)
                    .filter((id: unknown): id is string => typeof id === 'string')
            );
            exerciseIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
        });
        return counts;
    }, [routines]);

    const searchableLibrary = useMemo(() => library.map(exercise => ({
        exercise,
        searchable: normalizeSearch([
            exercise.name,
            ...(exercise.muscles || []).map(muscleName),
            ...(exercise.secondaryMuscles || []).map(muscleName),
            trackingLabel(exercise),
            exercise.isDefault ? 'Catalogo' : 'Personale',
            exercise.notes || '',
        ].join(' ')),
    })), [library]);

    const filteredLibrary = useMemo(() => {
        const normalized = normalizeSearch(query);
        if (!normalized) return library;

        const terms = normalized.split(/\s+/).filter(Boolean);
        return searchableLibrary
            .filter(({ searchable }) => terms.every(term => searchable.includes(term)))
            .map(({ exercise }) => exercise);
    }, [library, searchableLibrary, query]);

    const visibleCount = page.query === query && page.source === library ? page.count : ARCHIVE_PAGE_SIZE;
    const visibleLibrary = filteredLibrary.slice(0, visibleCount);

    const selectedExercise = useMemo(
        () => library.find(exercise => exercise.id === selectedExId) || null,
        [library, selectedExId]
    );

    useEffect(() => {
        // An ID selected in a previous library snapshot must not reopen an
        // unrelated detail view if an item with that ID appears later.
        if (selectedExId !== null && !selectedExercise) onSelectedExIdChange(null);
    }, [selectedExId, selectedExercise, onSelectedExIdChange]);

    if (selectedExercise) {
        return (
            <ExerciseDetail
                exercise={selectedExercise}
                routineCount={routineCounts.get(selectedExercise.id) || 0}
                onBack={() => onSelectedExIdChange(null)}
                onEditItem={onEditItem}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
            />
        );
    }

    return (
        <section className="exercise-library-list" aria-label="Libreria esercizi">
            <div className="exercise-search-wrap">
                <Search size={18} aria-hidden="true" />
                <input
                    className="exercise-search-input"
                    type="text"
                    inputMode="search"
                    role="searchbox"
                    value={query}
                    onChange={event => updateQuery(event.target.value)}
                    placeholder="Cerca esercizio"
                    aria-label="Cerca esercizio"
                />
                {query && (
                    <button
                        className="exercise-search-clear"
                        type="button"
                        aria-label="Cancella ricerca"
                        onClick={() => updateQuery('')}
                    >
                        <X size={18} aria-hidden="true" />
                    </button>
                )}
            </div>

            <div className="exercise-section-head">
                <h3>La tua libreria</h3>
                <span>{filteredLibrary.length} {filteredLibrary.length === 1 ? 'esercizio' : 'esercizi'}</span>
            </div>

            {filteredLibrary.length === 0 ? (
                <div className="exercise-empty-state">
                    {library.length === 0 ? 'Nessun esercizio disponibile.' : 'Nessun esercizio trovato.'}
                </div>
            ) : (
                <>
                <div className="exercise-compact-list">
                    {visibleLibrary.map(exercise => {
                        const routineCount = routineCounts.get(exercise.id) || 0;
                        const primaryMuscle = exercise.muscles?.[0]
                            ? muscleName(exercise.muscles[0])
                            : 'Nessun muscolo';

                        return (
                            <button
                                key={exercise.id}
                                className="exercise-compact-row"
                                type="button"
                                onClick={() => onSelectedExIdChange(exercise.id)}
                                aria-label={`Apri dettaglio di ${exercise.name}`}
                            >
                                <span className={`exercise-compact-icon ${exercise.trackingType === 'cardio' ? 'cardio' : ''}`}>
                                    <TrackingIcon exercise={exercise} />
                                </span>
                                <span className="exercise-compact-copy">
                                    <span className="exercise-compact-name">{exercise.name}</span>
                                    <span className="exercise-compact-meta">
                                        {primaryMuscle} · {routineCount} {routineCount === 1 ? 'scheda' : 'schede'}
                                    </span>
                                </span>
                                <ChevronRight className="exercise-compact-chevron" size={18} aria-hidden="true" />
                            </button>
                        );
                    })}
                </div>
                {visibleLibrary.length < filteredLibrary.length && (
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setPage({ query, source: library, count: visibleCount + ARCHIVE_PAGE_SIZE })}
                        aria-label={`Mostra altri esercizi (${filteredLibrary.length - visibleLibrary.length} rimanenti)`}
                    >
                        Mostra altri esercizi
                    </button>
                )}
                </>
            )}
        </section>
    );
}
