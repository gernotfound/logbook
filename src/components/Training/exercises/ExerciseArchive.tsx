import { Copy, Pencil, Trash2 } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import type { useTrainingExercises } from '../../../hooks/useTrainingExercises';
import { ContextMenu } from '../../UI/ContextMenu';
import MuscleModel from '../MuscleModel';

type TrainingExercisesHook = ReturnType<typeof useTrainingExercises>;

interface ExerciseArchiveProps {
    library: TrainingExercisesHook['library'];
    routines: TrainingExercisesHook['routines'];
    editingExId: TrainingExercisesHook['editingExId'];
    isCreating: boolean;
    expandedExId: string | null;
    onExpandedExIdChange: (id: string | null) => void;
    onEditItem: (exercise: any) => void;
    onDuplicate: TrainingExercisesHook['handleDuplicate'];
    onDelete: TrainingExercisesHook['handleDelete'];
}

export function ExerciseArchive({
    library,
    routines,
    editingExId,
    isCreating,
    expandedExId,
    onExpandedExIdChange,
    onEditItem,
    onDuplicate,
    onDelete,
}: ExerciseArchiveProps) {
    return (
        <>
            <h2 className="mt-20">Archivio esercizi ({library.length})</h2>
            <p className="text-muted text-sm">Clicca su un esercizio per vederne i dettagli o sull'icona per modificarlo.</p>
            {library.length === 0 ? (
                <p className="text-muted">Nessun esercizio creato.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Virtuoso
                        useWindowScroll
                        data={library}
                        initialItemCount={Math.min(20, library.length)}
                        components={{ Footer: () => <div style={{ height: '90px' }} /> }}
                        itemContent={(_, exercise) => {
                            if (!exercise) return null;
                            const routineCount = routines.filter(routine => routine.exercises?.some((routineExercise: any) => routineExercise.exId === exercise.id)).length;

                            return (
                                <div
                                    key={exercise.id}
                                    className="card p-15"
                                    style={{ marginBottom: '15px' }}
                                >
                                    <div
                                        className="flex-between cursor-pointer"
                                        style={{ borderLeft: editingExId === exercise.id ? '3px solid var(--primary-color)' : 'none', paddingLeft: editingExId === exercise.id ? '10px' : '0' }}
                                        onClick={() => onExpandedExIdChange(expandedExId === exercise.id ? null : exercise.id)}
                                    >
                                        <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                                            <div className="flex items-center gap-6" style={{ flexWrap: 'wrap' }}>
                                                <div className={`font-bold ${(expandedExId === exercise.id || editingExId === exercise.id) ? 'text-primary' : 'text-white'}`}>{exercise.name}</div>
                                                {routineCount > 0 && (
                                                    <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                        {routineCount === 1 ? 'In 1 scheda' : `In ${routineCount} schede`}
                                                    </span>
                                                )}
                                            </div>
                                            {exercise.notes && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{exercise.notes}</div>}
                                            {(exercise.isBodyweight || (exercise.equipmentWeight !== undefined && exercise.equipmentWeight > 0)) && (
                                                <div className="flex flex-wrap gap-5 mt-4">
                                                    {exercise.isBodyweight && (
                                                        <span className="badge badge-primary" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>
                                                            Corpo libero
                                                        </span>
                                                    )}
                                                    {exercise.equipmentWeight !== undefined && exercise.equipmentWeight > 0 && (
                                                        <span className="badge" style={{ fontSize: '0.75rem', padding: '2px 6px', background: 'rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                                            Attrezzo: {exercise.equipmentWeight} kg
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-10" style={{ flexShrink: 0 }}>
                                            <ContextMenu
                                                items={[
                                                    {
                                                        label: 'Modifica',
                                                        icon: <Pencil size={16} />,
                                                        disabled: isCreating,
                                                        onClick: () => {
                                                            onEditItem(exercise);
                                                            onExpandedExIdChange(exercise.id);
                                                        }
                                                    },
                                                    {
                                                        label: 'Duplica',
                                                        icon: <Copy size={16} />,
                                                        onClick: () => onDuplicate(exercise)
                                                    },
                                                    {
                                                        label: 'Elimina',
                                                        icon: <Trash2 size={16} />,
                                                        variant: 'danger',
                                                        hidden: exercise.isDefault,
                                                        onClick: event => onDelete(exercise.id, event)
                                                    }
                                                ]}
                                            />
                                        </div>
                                    </div>

                                    {expandedExId === exercise.id && (
                                        <div className="mt-15 pt-15 border-t">
                                            <div className="mb-10 text-sm">
                                                <span className="text-muted">Tracciamento: </span>
                                                <strong>{exercise.trackingType === 'time' ? 'Tempo' : exercise.trackingType === 'cardio' ? 'Cardio' : 'Peso e ripetizioni'}</strong>
                                            </div>
                                            {exercise.isBodyweight && (
                                                <div className="mb-10 text-sm">
                                                    <span className="text-muted">Corpo libero: </span>
                                                    <strong className="text-primary">Sì (peso corporeo incluso nel volume)</strong>
                                                </div>
                                            )}
                                            {exercise.equipmentWeight !== undefined && exercise.equipmentWeight > 0 && (
                                                <div className="mb-10 text-sm">
                                                    <span className="text-muted">Peso base attrezzo: </span>
                                                    <strong>{exercise.equipmentWeight} kg</strong>
                                                </div>
                                            )}
                                            {(exercise.muscles || []).length > 0 || (exercise.secondaryMuscles || []).length > 0 ? (
                                                <div className="flex-center w-full">
                                                    <MuscleModel
                                                        selectedMuscles={exercise.muscles as any}
                                                        secondaryMuscles={exercise.secondaryMuscles as any}
                                                    />
                                                </div>
                                            ) : (
                                                <p className="text-muted text-md mb-0">Nessun muscolo specificato.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        }}
                    />
                </div>
            )}
        </>
    );
}
