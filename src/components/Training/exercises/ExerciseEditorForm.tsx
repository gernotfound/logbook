import { Pencil, Plus, Save } from 'lucide-react';
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
    } = hook;

    return (
        <div id="exercise-creation-form" className={editingExId ? 'border-primary' : 'border-glass p-15 rounded-12 mb-20'}>
            <h2 className={editingExId ? 'text-primary' : 'text-white'} style={{marginBottom: '15px'}}>
                {editingExId ? <><Pencil size={18} aria-hidden="true" /> Modifica esercizio</> : <><Plus size={18} aria-hidden="true" /> Crea nuovo esercizio</>}
            </h2>

            <div className="flex-col gap-10 mt-15 mb-20">
                <div>
                    <input
                        type="text"
                        aria-label="Nome esercizio"
                        placeholder="Nome esercizio (es. Panca piana con bilanciere)"
                        value={exName}
                        style={isDuplicateName ? { borderColor: 'var(--danger-color)' } : undefined}
                        onChange={event => setExName(event.target.value)}
                    />
                    {isDuplicateName && (
                        <div style={{ color: 'var(--danger-color)', fontSize: '0.85rem', marginTop: '6px' }}>
                            ⚠️ Esiste già un esercizio con questo nome nell'archivio.
                        </div>
                    )}
                </div>
                <input
                    type="text"
                    aria-label="Note di setup"
                    placeholder="Note di setup (opzionale, es. Inclinazione 30°)"
                    value={exNotes}
                    onChange={event => setExNotes(event.target.value)}
                />
            </div>

            <div className="mb-20">
                <label className="text-muted text-sm mb-8 block font-medium">Tipo di tracciamento</label>
                <div className="tracking-type-group" style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap' }}>
                    <button
                        type="button"
                        className={`tracking-card-option ${trackingType === 'weight_reps' ? 'active' : ''}`}
                        onClick={() => setTrackingType('weight_reps')}
                        style={{ padding: '10px 4px', fontSize: '0.85rem' }}
                    >
                        <span>Peso e rip.</span>
                    </button>
                    <button
                        type="button"
                        className={`tracking-card-option ${trackingType === 'time' ? 'active' : ''}`}
                        onClick={() => setTrackingType('time')}
                        style={{ padding: '10px 4px', fontSize: '0.85rem' }}
                    >
                        <span>Tempo</span>
                    </button>
                    <button
                        type="button"
                        className={`tracking-card-option ${trackingType === 'cardio' ? 'active' : ''}`}
                        onClick={() => setTrackingType('cardio')}
                        style={{ padding: '10px 4px', fontSize: '0.85rem' }}
                    >
                        <span>Cardio</span>
                    </button>
                </div>
            </div>

            {trackingType === 'weight_reps' && (
                <div className="mb-20" style={{ marginTop: '30px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderTop: '1px solid var(--glass-border)', borderBottom: '1px solid var(--glass-border)' }}>
                        <label className="text-white text-sm font-medium m-0 cursor-pointer" htmlFor="ex-bodyweight">
                            Esercizio a corpo libero
                        </label>
                        <input
                            id="ex-bodyweight"
                            type="checkbox"
                            checked={isBodyweight}
                            onChange={event => setIsBodyweight(event.target.checked)}
                            style={{ width: '22px', height: '22px', cursor: 'pointer', accentColor: 'var(--primary-color)', margin: 0 }}
                        />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--glass-border)' }}>
                        <label className="text-white text-sm font-medium m-0" htmlFor="ex-equipment-weight">
                            Peso attrezzo
                        </label>
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
                            style={{ width: '70px', textAlign: 'center', padding: '8px', margin: 0, fontSize: '16px', borderRadius: '8px', background: 'var(--surface-light)', border: '1px solid var(--glass-border)', color: 'var(--text-main)' }}
                        />
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
            />

            <div className="flex gap-10 mt-20" style={{ width: '100%', minWidth: 0 }}>
                <button
                    type="button"
                    className="btn flex-1 mb-0"
                    style={{ background: 'var(--surface-light)', whiteSpace: 'nowrap', margin: 0 }}
                    onClick={onCancel}
                    disabled={isSaving}
                >
                    Annulla
                </button>
                <button
                    type="button"
                    className="btn btn-primary flex-1 mb-0"
                    style={{ whiteSpace: 'nowrap', margin: 0 }}
                    disabled={isSaving}
                    onClick={onSave}
                >
                    {isSaving ? 'Salvataggio...' : (editingExId ? <><Save size={16} aria-hidden="true" /> Salva modifiche</> : 'Crea esercizio')}
                </button>
            </div>

            {editingExId && editingExercise?.isDefault && (
                <div className="mt-10">
                    <button
                        type="button"
                        className="btn w-full mb-0"
                        style={{ background: 'var(--danger-soft)', color: 'var(--danger-color)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                        onClick={onRestore}
                    >
                        <span aria-hidden="true">🔄</span> Ripristina all'originale
                    </button>
                </div>
            )}
        </div>
    );
}
