import { useMemo, useState } from 'react';
import {
    Activity,
    ChevronLeft,
    ChevronRight,
    Copy,
    Dumbbell,
    Pencil,
    Search,
    Timer,
    Trash2,
    X,
} from 'lucide-react';
import type { useTrainingExercises } from '../../../hooks/useTrainingExercises';
import { Logic } from '../../../lib/logic';
import MuscleModel from '../MuscleModel';

type TrainingExercisesHook = ReturnType<typeof useTrainingExercises>;
type ExerciseItem = TrainingExercisesHook['library'][number];

interface ExerciseArchiveProps {
    library: TrainingExercisesHook['library'];
    routines: TrainingExercisesHook['routines'];
    selectedExId: string | null;
    onSelectedExIdChange: (id: string | null) => void;
    onEditItem: (exercise: ExerciseItem) => void;
    onDuplicate: TrainingExercisesHook['handleDuplicate'];
    onDelete: (id: string, event: React.MouseEvent) => void | Promise<void>;
}

function normalizeSearch(value: string): string {
    return value
        .toLocaleLowerCase('it')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function trackingLabel(exercise: ExerciseItem): string {
    if (exercise.trackingType === 'time') return 'Tempo';
    if (exercise.trackingType === 'cardio') return 'Cardio';
    return 'Peso e ripetizioni';
}

function TrackingIcon({ exercise }: { exercise: ExerciseItem }) {
    if (exercise.trackingType === 'cardio') return <Activity size={18} aria-hidden="true" />;
    if (exercise.trackingType === 'time') return <Timer size={18} aria-hidden="true" />;
    return <Dumbbell size={18} aria-hidden="true" />;
}

function muscleName(id: string): string {
    return Logic.getMuscleName(id) || id;
}

function muscleList(ids?: string[]): string {
    if (!ids?.length) return 'Nessuno';
    return ids.map(muscleName).join(', ');
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

    const routineCounts = useMemo(() => {
        const counts = new Map<string, number>();
        routines.forEach(routine => {
            const exerciseIds = new Set((routine.exercises || []).map((exercise: any) => exercise.exId));
            exerciseIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
        });
        return counts;
    }, [routines]);

    const filteredLibrary = useMemo(() => {
        const normalized = normalizeSearch(query);
        if (!normalized) return library;

        const terms = normalized.split(/\s+/).filter(Boolean);
        return library.filter(exercise => {
            const searchable = normalizeSearch([
                exercise.name,
                ...(exercise.muscles || []).map(muscleName),
                ...(exercise.secondaryMuscles || []).map(muscleName),
                trackingLabel(exercise),
                exercise.isDefault ? 'Catalogo' : 'Personale',
                exercise.notes || '',
            ].join(' '));
            return terms.every(term => searchable.includes(term));
        });
    }, [library, query]);

    const selectedExercise = useMemo(
        () => library.find(exercise => exercise.id === selectedExId) || null,
        [library, selectedExId]
    );

    if (selectedExercise) {
        const routineCount = routineCounts.get(selectedExercise.id) || 0;
        return (
            <section className="exercise-detail-page" aria-label="Dettaglio esercizio">
                <div className="exercise-detail-top">
                    <button
                        className="exercise-icon-button"
                        type="button"
                        aria-label="Torna all’elenco"
                        onClick={() => onSelectedExIdChange(null)}
                    >
                        <ChevronLeft size={20} aria-hidden="true" />
                    </button>
                    <h3>{selectedExercise.name}</h3>
                </div>

                <div className="exercise-detail-muscle-map">
                    <MuscleModel
                        selectedMuscles={selectedExercise.muscles || []}
                        secondaryMuscles={selectedExercise.secondaryMuscles || []}
                    />
                </div>

                <div className="exercise-detail-facts">
                    <div className="exercise-detail-fact">
                        <span>Muscoli primari</span>
                        <strong>{muscleList(selectedExercise.muscles)}</strong>
                    </div>
                    <div className="exercise-detail-fact">
                        <span>Muscoli secondari</span>
                        <strong>{muscleList(selectedExercise.secondaryMuscles)}</strong>
                    </div>
                    <div className="exercise-detail-fact">
                        <span>Tracciamento</span>
                        <strong>{trackingLabel(selectedExercise)}</strong>
                    </div>
                    <div className="exercise-detail-fact">
                        <span>Utilizzo</span>
                        <strong>{routineCount} {routineCount === 1 ? 'scheda' : 'schede'}</strong>
                    </div>
                    <div className="exercise-detail-fact">
                        <span>Origine</span>
                        <strong>{selectedExercise.isDefault ? 'Catalogo' : 'Personale'}</strong>
                    </div>
                </div>

                <div className="exercise-detail-notes">
                    <span>Note</span>
                    <p>{selectedExercise.notes?.trim() || 'Nessuna nota.'}</p>
                </div>

                <div className="exercise-detail-actions">
                    <button
                        className="btn exercise-action-button"
                        type="button"
                        onClick={() => onEditItem(selectedExercise)}
                    >
                        <Pencil size={17} aria-hidden="true" />
                        Modifica
                    </button>
                    <button
                        className="btn exercise-action-button"
                        type="button"
                        onClick={() => onDuplicate(selectedExercise)}
                    >
                        <Copy size={17} aria-hidden="true" />
                        Duplica
                    </button>
                    {!selectedExercise.isDefault && (
                        <button
                            className="btn exercise-action-button exercise-action-danger"
                            type="button"
                            onClick={event => onDelete(selectedExercise.id, event)}
                        >
                            <Trash2 size={17} aria-hidden="true" />
                            Elimina
                        </button>
                    )}
                </div>
            </section>
        );
    }

    return (
        <section className="exercise-library-list" aria-label="Libreria esercizi">
            <div className="exercise-search-wrap">
                <Search size={18} aria-hidden="true" />
                <input
                    className="exercise-search-input"
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Cerca esercizio"
                    aria-label="Cerca esercizio"
                />
                {query && (
                    <button
                        className="exercise-search-clear"
                        type="button"
                        aria-label="Cancella ricerca"
                        onClick={() => setQuery('')}
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
                <div className="exercise-compact-list">
                    {filteredLibrary.map(exercise => {
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
                                <span className="exercise-compact-icon">
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
            )}
        </section>
    );
}
