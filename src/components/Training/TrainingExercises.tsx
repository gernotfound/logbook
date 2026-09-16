import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useTrainingExercises } from '../../hooks/useTrainingExercises';
import { z } from '../../lib/zod';
import { ExerciseArchive } from './exercises/ExerciseArchive';
import { ExerciseEditorForm } from './exercises/ExerciseEditorForm';

const TrainingExercises = () => {
    const [isCreating, setIsCreating] = useLocalStorage<boolean>('logbook_creating_exercise', false, z.boolean());
    const [isSaving, setIsSaving] = useState(false);
    const [expandedExId, setExpandedExId] = useState<string | null>(null);
    const hook = useTrainingExercises();
    const { editingExId, library, routines } = hook;

    const editingExercise = useMemo(
        () => library.find(exercise => exercise.id === editingExId),
        [library, editingExId]
    );

    const handleEditItem = (exercise: any) => {
        setIsCreating(false);
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

    return (
        <div className="training-sub-view active">
            {!editingExId && (
                <div className="mb-20">
                    <button
                        type="button"
                        className="btn btn-primary w-full flex-center"
                        style={{ gap: '8px' }}
                        onClick={() => {
                            if (isCreating) {
                                handleCancel();
                            } else {
                                setIsCreating(true);
                            }
                        }}
                        aria-expanded={isCreating}
                        aria-controls="exercise-creation-form"
                        disabled={isSaving}
                    >
                        {isCreating ? <Minus size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
                        Crea esercizio
                    </button>
                </div>
            )}

            {(isCreating || editingExId) && (
                <ExerciseEditorForm
                    hook={hook}
                    isSaving={isSaving}
                    editingExercise={editingExercise}
                    onCancel={handleCancel}
                    onSave={handleSave}
                    onRestore={handleRestore}
                />
            )}

            <ExerciseArchive
                library={library}
                routines={routines}
                editingExId={editingExId}
                isCreating={isCreating}
                expandedExId={expandedExId}
                onExpandedExIdChange={setExpandedExId}
                onEditItem={handleEditItem}
                onDuplicate={hook.handleDuplicate}
                onDelete={hook.handleDelete}
            />
        </div>
    );
};

export default TrainingExercises;
