import { Search, X } from 'lucide-react';
import type { useTrainingExercises } from '../../../hooks/useTrainingExercises';
import MuscleModel from '../MuscleModel';

type TrainingExercisesHook = ReturnType<typeof useTrainingExercises>;

interface ExerciseMuscleSelectorProps {
    muscleSearch: TrainingExercisesHook['muscleSearch'];
    setMuscleSearch: TrainingExercisesHook['setMuscleSearch'];
    selectedMuscles: TrainingExercisesHook['selectedMuscles'];
    secondaryMuscles: TrainingExercisesHook['secondaryMuscles'];
    selectionMode: TrainingExercisesHook['selectionMode'];
    setSelectionMode: TrainingExercisesHook['setSelectionMode'];
    filteredMuscles: TrainingExercisesHook['filteredMuscles'];
    toggleMuscle: TrainingExercisesHook['toggleMuscle'];
    handleToggleMuscleById: TrainingExercisesHook['handleToggleMuscleById'];
    removeMuscleById: TrainingExercisesHook['removeMuscleById'];
}

export function ExerciseMuscleSelector({
    muscleSearch,
    setMuscleSearch,
    selectedMuscles,
    secondaryMuscles,
    selectionMode,
    setSelectionMode,
    filteredMuscles,
    toggleMuscle,
    handleToggleMuscleById,
    removeMuscleById,
}: ExerciseMuscleSelectorProps) {
    const selectedMuscleIds = selectedMuscles.map(muscle => muscle.id);
    const secondaryMuscleIds = secondaryMuscles.map(muscle => muscle.id);
    const hasSearch = Boolean(muscleSearch.trim());

    return (
        <section className="exercise-muscle-selector" aria-labelledby="exercise-muscle-title">
            <h3 id="exercise-muscle-title">Muscoli coinvolti</h3>

            <div className="exercise-muscle-mode" aria-label="Tipo di muscolo">
                <button
                    type="button"
                    className={`exercise-muscle-mode-button primary ${selectionMode === 'primary' ? 'active' : ''}`}
                    aria-pressed={selectionMode === 'primary'}
                    onClick={() => setSelectionMode('primary')}
                >
                    Primari
                </button>
                <button
                    type="button"
                    className={`exercise-muscle-mode-button secondary ${selectionMode === 'secondary' ? 'active' : ''}`}
                    aria-pressed={selectionMode === 'secondary'}
                    onClick={() => setSelectionMode('secondary')}
                >
                    Secondari
                </button>
            </div>

            <div className="exercise-muscle-search-area">
                <label htmlFor="exercise-muscle-search">Seleziona muscoli dall’elenco</label>
                <div className="exercise-muscle-search-wrap">
                    <Search size={18} aria-hidden="true" />
                    <input
                        id="exercise-muscle-search"
                        type="search"
                        placeholder="Cerca muscolo"
                        value={muscleSearch}
                        onChange={event => setMuscleSearch(event.target.value)}
                    />
                    {muscleSearch && (
                        <button
                            type="button"
                            className="exercise-muscle-search-clear"
                            onClick={() => setMuscleSearch('')}
                            aria-label="Cancella ricerca muscolo"
                        >
                            <X size={18} aria-hidden="true" />
                        </button>
                    )}
                </div>

                {hasSearch && (
                    <div className="exercise-muscle-results" aria-live="polite">
                        {filteredMuscles.length === 0 ? (
                            <div className="exercise-muscle-empty">Nessun muscolo trovato.</div>
                        ) : (
                            filteredMuscles.map(muscle => {
                                const isPrimary = selectedMuscleIds.includes(muscle.id);
                                const isSecondary = secondaryMuscleIds.includes(muscle.id);
                                const statusClass = isPrimary ? 'is-primary' : isSecondary ? 'is-secondary' : '';

                                return (
                                    <button
                                        key={muscle.id}
                                        type="button"
                                        className={`exercise-muscle-option ${statusClass}`}
                                        aria-pressed={isPrimary || isSecondary}
                                        onClick={() => toggleMuscle(muscle)}
                                    >
                                        <span>{muscle.name}</span>
                                        {(isPrimary || isSecondary) && (
                                            <small>{isPrimary ? 'Primario' : 'Secondario'}</small>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            <div className="exercise-muscle-model">
                <MuscleModel
                    selectedMuscles={selectedMuscleIds}
                    secondaryMuscles={secondaryMuscleIds}
                    interactive
                    onToggleMuscle={handleToggleMuscleById}
                    showLegend={false}
                    showTextSelection={false}
                />
            </div>

            <div className="exercise-muscle-legend" aria-label="Legenda muscoli">
                <span><i className="primary" aria-hidden="true" />Primari</span>
                <span><i className="secondary" aria-hidden="true" />Secondari</span>
            </div>

            <div className="exercise-selected-muscles" aria-label="Muscoli selezionati">
                {selectedMuscles.map(muscle => (
                    <button
                        key={`primary-${muscle.id}`}
                        type="button"
                        className="exercise-muscle-tag primary"
                        onClick={() => removeMuscleById(muscle.id)}
                        aria-label={`Rimuovi ${muscle.name} dai muscoli primari`}
                    >
                        <span>{muscle.name}</span>
                        <X size={14} aria-hidden="true" />
                    </button>
                ))}
                {secondaryMuscles.map(muscle => (
                    <button
                        key={`secondary-${muscle.id}`}
                        type="button"
                        className="exercise-muscle-tag secondary"
                        onClick={() => removeMuscleById(muscle.id)}
                        aria-label={`Rimuovi ${muscle.name} dai muscoli secondari`}
                    >
                        <span>{muscle.name}</span>
                        <X size={14} aria-hidden="true" />
                    </button>
                ))}
                {selectedMuscles.length === 0 && secondaryMuscles.length === 0 && (
                    <span className="exercise-selected-empty">Nessun muscolo selezionato</span>
                )}
            </div>
        </section>
    );
}
