import { RotateCcw, Save } from 'lucide-react';
import type { useTrainingExercises } from '../../../hooks/useTrainingExercises';
import { ExerciseMuscleSelector } from './ExerciseMuscleSelector';

type TrainingExercisesHook = ReturnType<typeof useTrainingExercises>;
type ExerciseEditorHook = Pick<TrainingExercisesHook,
    | 'editingExId'
    | 'exName'
    | 'setExName'
    | 'exNotes'
    | 'setExNotes'
    | 'muscleSearch'
    | 'setMuscleSearch'
    | 'selectedMuscles'
    | 'secondaryMuscles'
    | 'selectionMode'
    | 'setSelectionMode'
    | 'isDuplicateName'
    | 'filteredMuscles'
    | 'trackingType'
    | 'setTrackingType'
    | 'isBodyweight'
    | 'setIsBodyweight'
    | 'equipmentWeight'
    | 'setEquipmentWeight'
    | 'toggleMuscle'
    | 'handleToggleMuscleById'
    | 'removeMuscleById'
>;

interface ExerciseEditorFormProps {
    hook: ExerciseEditorHook;
    isSaving: boolean;
    editingExercise: any;
    onCancel: () => void;
    onSave: () => void | Promise<void>;
    onRestore: () => void | Promise<void>;
}

export function ExerciseEditorForm({
    hook,
    isSaving,
    editingExercise,
    onCancel,
    onSave,
    onRestore,
}: ExerciseEditorFormProps) {
    const {
        editingExId,
        exName,
        setExName,
        exNotes,
        setExNotes,
        muscleSearch,
        setMuscleSearch,
        selectedMuscles,
        secondaryMuscles,
        selectionMode,
        setSelectionMode,
        isDuplicateName,
        filteredMuscles,
        trackingType,
        setTrackingType,
        isBodyweight,
        setIsBodyweight,
        equipmentWeight,
        setEquipmentWeight,
        toggleMuscle,
        handleToggleMuscleById,
        removeMuscleById,
    } = hook;

    return (
        <section
            id="exercise-creation-form"
            className="exercise-editor"
            aria-label={editingExId ? 'Modifica esercizio' : 'Crea esercizio'}
        >
            <div className="exercise-editor-head">
                <h2>{editingExId ? 'Modifica esercizio' : 'Nuovo esercizio'}</h2>
                <button
                    type="button"
                    className="btn exercise-editor-close"
                    onClick={onCancel}
                    disabled={isSaving}
                >
                    Chiudi
                </button>
            </div>

            <div className="exercise-field">
                <label htmlFor="exercise-name">Nome esercizio</label>
                <input
                    id="exercise-name"
                    type="text"
                    value={exName}
                    aria-invalid={isDuplicateName || undefined}
                    onChange={event => setExName(event.target.value)}
                />
                {isDuplicateName && (
                    <p className="exercise-field-error" role="alert">
                        Esiste già un esercizio con questo nome nell’archivio.
                    </p>
                )}
            </div>

            <div className="exercise-field">
                <label htmlFor="exercise-notes">Note di setup</label>
                <input
                    id="exercise-notes"
                    type="text"
                    value={exNotes}
                    placeholder="Opzionale"
                    onChange={event => setExNotes(event.target.value)}
                />
            </div>

            <fieldset className="exercise-tracking-field">
                <legend>Tipo di tracciamento</legend>
                <div className="exercise-tracking-options">
                    <button
                        type="button"
                        className={`exercise-tracking-option ${trackingType === 'weight_reps' ? 'active' : ''}`}
                        aria-pressed={trackingType === 'weight_reps'}
                        onClick={() => setTrackingType('weight_reps')}
                    >
                        Peso e ripetizioni
                    </button>
                    <button
                        type="button"
                        className={`exercise-tracking-option ${trackingType === 'time' ? 'active' : ''}`}
                        aria-pressed={trackingType === 'time'}
                        onClick={() => setTrackingType('time')}
                    >
                        Tempo
                    </button>
                    <button
                        type="button"
                        className={`exercise-tracking-option ${trackingType === 'cardio' ? 'active' : ''}`}
                        aria-pressed={trackingType === 'cardio'}
                        onClick={() => setTrackingType('cardio')}
                    >
                        Cardio
                    </button>
                </div>
            </fieldset>

            {trackingType === 'weight_reps' && (
                <div className="exercise-editor-settings">
                    <label className="exercise-setting-row" htmlFor="ex-bodyweight">
                        <span className="exercise-setting-copy">
                            <strong>Esercizio a corpo libero</strong>
                            <span>Include il peso corporeo nel volume</span>
                        </span>
                        <span className="exercise-switch">
                            <input
                                id="ex-bodyweight"
                                type="checkbox"
                                checked={isBodyweight}
                                onChange={event => setIsBodyweight(event.target.checked)}
                            />
                            <span className="exercise-switch-track" aria-hidden="true" />
                        </span>
                    </label>

                    <div className="exercise-setting-row">
                        <span className="exercise-setting-copy">
                            <strong>Peso attrezzo</strong>
                            <span>Peso fisso dell’attrezzo</span>
                        </span>
                        <label className="exercise-weight-input" htmlFor="ex-equipment-weight">
                            <span className="sr-only">Peso attrezzo, espresso in kg</span>
                            <input
                                id="ex-equipment-weight"
                                type="number"
                                inputMode="decimal"
                                step="0.5"
                                min="0"
                                placeholder="0"
                                value={equipmentWeight}
                                onChange={event => setEquipmentWeight(event.target.value)}
                                onFocus={event => event.target.select()}
                            />
                            <span aria-hidden="true">kg</span>
                        </label>
                    </div>
                </div>
            )}

            <ExerciseMuscleSelector
                muscleSearch={muscleSearch}
                setMuscleSearch={setMuscleSearch}
                selectedMuscles={selectedMuscles}
                secondaryMuscles={secondaryMuscles}
                selectionMode={selectionMode}
                setSelectionMode={setSelectionMode}
                filteredMuscles={filteredMuscles}
                toggleMuscle={toggleMuscle}
                handleToggleMuscleById={handleToggleMuscleById}
                removeMuscleById={removeMuscleById}
            />

            <div className="exercise-editor-actions">
                <button
                    type="button"
                    className="btn"
                    onClick={onCancel}
                    disabled={isSaving}
                >
                    Annulla
                </button>
                <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isSaving}
                    onClick={onSave}
                >
                    <Save size={17} aria-hidden="true" />
                    {isSaving ? 'Salvataggio…' : 'Salva'}
                </button>
            </div>

            {editingExId && editingExercise?.isDefault && (
                <button
                    type="button"
                    className="btn exercise-restore-button"
                    onClick={onRestore}
                    disabled={isSaving}
                >
                    <RotateCcw size={17} aria-hidden="true" />
                    Ripristina originale
                </button>
            )}
        </section>
    );
}
