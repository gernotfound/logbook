import { useMemo, useState, type MouseEvent } from 'react';
import { Plus } from 'lucide-react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useTrainingExercises } from '../../hooks/useTrainingExercises';
import { z } from '../../lib/zod';
import { ExerciseArchive } from './exercises/ExerciseArchive';
import { ExerciseEditorForm } from './exercises/ExerciseEditorForm';

const TrainingExercises = () => {
    const [isCreating, setIsCreating] = useLocalStorage<boolean>('logbook_creating_exercise', false, z.boolean());
    const [isSaving, setIsSaving] = useState(false);
    const [selectedExId, setSelectedExId] = useState<string | null>(null);
    const hook = useTrainingExercises();
    const { editingExId, library, routines } = hook;

    const editingExercise = useMemo(
        () => library.find(exercise => exercise.id === editingExId),
        [library, editingExId]
    );

    const handleCreate = () => {
        setSelectedExId(null);
        setIsCreating(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleEditItem = (exercise: any) => {
        setIsCreating(false);
        setSelectedExId(exercise.id);
        hook.handleEditClick(exercise);
    };

    const handleCancel = () => {
        hook.handleCancelEdit();
        setIsCreating(false);
    };

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            const success = await hook.handleSaveExercise();
            if (success) {
                setIsCreating(false);
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleRestore = async () => {
        if (!editingExId) return;
        await hook.handleRestoreExercise(editingExId);
    };

    const handleDelete = async (id: string, event: MouseEvent) => {
        const deleted = await hook.handleDelete(id, event);
        if (deleted) setSelectedExId(null);
    };

    const editorOpen = isCreating || Boolean(editingExId);

    return (
        <div className="training-sub-view active exercise-library">
            <header className="exercise-library-header">
                <h2>Esercizi</h2>
                {!editorOpen && (
                    <button
                        type="button"
                        className="btn btn-primary exercise-create-button"
                        onClick={handleCreate}
                        aria-label="Crea esercizio"
                    >
                        <Plus size={18} aria-hidden="true" />
                        <span>Crea</span>
                    </button>
                )}
            </header>

            {editorOpen ? (
                <ExerciseEditorForm
                    hook={hook}
                    isSaving={isSaving}
                    editingExercise={editingExercise}
                    onCancel={handleCancel}
                    onSave={handleSave}
                    onRestore={handleRestore}
                />
            ) : (
                <ExerciseArchive
                    library={library}
                    routines={routines}
                    selectedExId={selectedExId}
                    onSelectedExIdChange={setSelectedExId}
                    onEditItem={handleEditItem}
                    onDuplicate={hook.handleDuplicate}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
};

export default TrainingExercises;
