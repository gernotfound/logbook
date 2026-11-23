import { RotateCcw } from 'lucide-react';
import type { MuscleSelectionMode } from '../../../hooks/trainingExercises/exerciseMuscleEditor';
import type { MuscleDef } from '../../../lib/constants/muscles';
import type { ExerciseTrackingType } from '../../../lib/exerciseEditorDraft';
import type { Exercise } from '../../../types';
import { ExerciseMuscleSelector } from './ExerciseMuscleSelector';

interface ExerciseEditorView {
    editingExId: string | null;
    exName: string;
    setExName: (name: string) => void;
    exNotes: string;
    setExNotes: (notes: string) => void;
    muscleSearch: string;
    setMuscleSearch: (query: string) => void;
    selectedMuscles: MuscleDef[];
    secondaryMuscles: MuscleDef[];
    selectionMode: MuscleSelectionMode;
    setSelectionMode: (mode: MuscleSelectionMode) => void;
    isDuplicateName: boolean;
    filteredMuscles: MuscleDef[];
    trackingType: ExerciseTrackingType;
    setTrackingType: (type: ExerciseTrackingType) => void;
    isBodyweight: boolean;
    setIsBodyweight: (value: boolean) => void;
    equipmentWeight: string;
    setEquipmentWeight: (weight: string) => void;
    toggleMuscle: (muscle: MuscleDef) => void;
    handleToggleMuscleById: (id: string) => void;
    removeMuscleById: (id: string) => void;
}

interface ExerciseEditorFormProps {
    hook: ExerciseEditorView;
    isSaving: boolean;
    editingExercise?: Exercise;
    onCancel: () => void;
    onClose?: () => void;
    onSave: () => void | Promise<void>;
    onRestore?: () => void | Promise<void>;
    preview?: boolean;
}

export function ExerciseEditorForm({
    hook,
    isSaving,
    editingExercise,
    onCancel,
    onClose,
    onSave,
    onRestore,
    preview = false,
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
            aria-label={preview ? 'Valori della bozza esercizio' : editingExId ? 'Modifica esercizio' : 'Crea esercizio'}
        >
            <div className="exercise-editor-head">
                <h2>{preview ? 'Anteprima bozza' : editingExId ? 'Modifica esercizio' : 'Nuovo esercizio'}</h2>
                {!preview && <button
                    type="button"
                    className="btn exercise-editor-close"
                    onClick={onClose ?? onCancel}
                    disabled={isSaving}
                >
                    Chiudi
                </button>}
            </div>

            <div className="exercise-field">
                <label htmlFor="exercise-name">Nome esercizio</label>
                <input
                    id="exercise-name"
                    type="text"
                    value={exName}
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                        disabled={isSaving}
                        onClick={() => setTrackingType('weight_reps')}
                    >
                        Peso e ripetizioni
                    </button>
                    <button
                        type="button"
                        className={`exercise-tracking-option ${trackingType === 'time' ? 'active' : ''}`}
                        aria-pressed={trackingType === 'time'}
                        disabled={isSaving}
                        onClick={() => setTrackingType('time')}
                    >
                        Tempo
                    </button>
                    <button
                        type="button"
                        className={`exercise-tracking-option ${trackingType === 'cardio' ? 'active' : ''}`}
                        aria-pressed={trackingType === 'cardio'}
                        disabled={isSaving}
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
                                disabled={isSaving}
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
                                disabled={isSaving}
                                onChange={event => setEquipmentWeight(event.target.value)}
                                onFocus={event => event.target.select()}
                            />
                            <span aria-hidden="true">kg</span>
                        </label>
                    </div>
                </div>
            )}

            <ExerciseMuscleSelector
                disabled={isSaving}
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

            {!preview && <div className="exercise-editor-actions">
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
                    {isSaving ? 'Salvataggio…' : 'Salva'}
                </button>
            </div>}

            {editingExId && editingExercise?.isDefault && onRestore && (
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
