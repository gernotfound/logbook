import React from 'react';
import MuscleModel from '../MuscleModel';
import { ExerciseLibraryItem, Routine, RoutineExercise } from '../../../types';
import { Logic } from '../../../lib/logic';
import { ContextMenu, ContextMenuItem } from '../../UI/ContextMenu';
import { ChevronDown, ClipboardList, Copy, Pencil, Trash2 } from 'lucide-react';

interface RoutineCardProps {
    routine: Routine;
    isExpanded: boolean;
    library: ExerciseLibraryItem[];
    onToggleExpand: (id: string) => void;
    onEdit: (routine: Routine) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onDuplicate: (routine: Routine, e: React.MouseEvent) => void;
    isCreating?: boolean;
}

const formatExerciseTarget = (exercise: RoutineExercise, libraryItem?: ExerciseLibraryItem) => {
    const parsedSets = Number.parseInt(String(exercise.setsCount ?? 3), 10);
    const sets = Number.isFinite(parsedSets) && parsedSets > 0 ? parsedSets : 3;

    if (libraryItem?.trackingType === 'cardio') return `${sets} serie · cardio`;
    if (libraryItem?.trackingType === 'time') return `${sets} serie · a tempo`;

    const minReps = exercise.minReps;
    const maxReps = exercise.maxReps;
    if (minReps && maxReps) return `${sets} × ${minReps}–${maxReps}`;
    if (minReps || maxReps) return `${sets} × ${minReps || maxReps}`;
    return `${sets} serie`;
};

export const RoutineCard: React.FC<RoutineCardProps> = ({
    routine,
    isExpanded,
    library,
    onToggleExpand,
    onEdit,
    onDuplicate,
    onDelete,
    isCreating
}) => {
    const primaryMuscles = new Set<string>();
    const secondaryMuscles = new Set<string>();

    (routine.exercises || []).forEach(exercise => {
        const libraryItem = library.find(item => item.id === exercise.exId);
        libraryItem?.muscles?.forEach(muscleId => primaryMuscles.add(muscleId));
        libraryItem?.secondaryMuscles?.forEach(muscleId => secondaryMuscles.add(muscleId));
    });

    primaryMuscles.forEach(muscleId => secondaryMuscles.delete(muscleId));

    const primaryMuscleIds = Array.from(primaryMuscles);
    const secondaryMuscleIds = Array.from(secondaryMuscles);
    const primaryMuscleNames = primaryMuscleIds.map(muscleId => Logic.getMuscleName(muscleId));
    const secondaryMuscleNames = secondaryMuscleIds.map(muscleId => Logic.getMuscleName(muscleId));
    const focusSummary = primaryMuscleNames.length > 0
        ? `${primaryMuscleNames.slice(0, 2).join(', ')}${primaryMuscleNames.length > 2 ? ` +${primaryMuscleNames.length - 2}` : ''}`
        : '';

    const menuItems: ContextMenuItem[] = [
        {
            id: 'edit-routine',
            label: 'Modifica',
            icon: <Pencil size={16} />,
            disabled: isCreating,
            onClick: () => onEdit(routine)
        },
        {
            id: 'duplicate-routine',
            label: 'Duplica',
            icon: <Copy size={16} />,
            onClick: (event) => onDuplicate(routine, event)
        },
        {
            id: 'delete-routine',
            label: 'Elimina',
            icon: <Trash2 size={16} />,
            variant: 'danger',
            onClick: (event) => onDelete(routine.id, event)
        }
    ];

    const detailsId = `routine-details-${routine.id}`;

    return (
        <article className={`routine-library-card${isExpanded ? ' is-expanded' : ''}`}>
            <div className="routine-card-head">
                <button
                    type="button"
                    className="routine-card-toggle"
                    onClick={() => onToggleExpand(routine.id)}
                    aria-expanded={isExpanded}
                    aria-controls={detailsId}
                    aria-label={`${isExpanded ? 'Chiudi' : 'Apri'} scheda ${routine.name}`}
                >
                    <span className="routine-card-icon" aria-hidden="true">
                        <ClipboardList size={20} />
                    </span>
                    <span className="routine-card-copy">
                        <strong className="routine-card-name">{routine.name}</strong>
                        <span className="routine-card-meta">
                            {(routine.exercises || []).length} esercizi
                            {focusSummary ? ` · ${focusSummary}` : ''}
                        </span>
                        <span className="routine-card-count-assistive" aria-hidden="true">
                            {(routine.exercises || []).length} esercizi
                        </span>
                    </span>
                    <ChevronDown className="routine-card-chevron" size={20} aria-hidden="true" />
                </button>
                <ContextMenu
                    items={menuItems}
                    className="routine-card-menu"
                />
            </div>

            {isExpanded && (
                <div id={detailsId} className="routine-card-expanded">
                    <div className="routine-expanded-section">
                        <div className="routine-expanded-heading">
                            <h4>Programma</h4>
                            <span>Serie × ripetizioni</span>
                        </div>

                        {(routine.exercises || []).length === 0 ? (
                            <div className="routine-empty-state">Nessun esercizio presente.</div>
                        ) : (
                            <div className="routine-sequence">
                                {(routine.exercises || []).map((exercise: RoutineExercise, index: number) => {
                                    const libraryItem = library.find(item => item.id === exercise.exId);
                                    return (
                                        <div key={`${exercise.exId}-${index}`} className="routine-sequence-item">
                                            <span className="routine-sequence-index" aria-hidden="true">{index + 1}</span>
                                            <span className="routine-sequence-copy">
                                                <strong>{libraryItem?.name || 'Esercizio rimosso'}</strong>
                                                {exercise.defaultTechnique === 'dropset' && (
                                                    <span className="routine-sequence-badge warning">Dropset</span>
                                                )}
                                                {exercise.defaultTechnique === 'isometrics' && (
                                                    <span className="routine-sequence-badge accent">Isometria</span>
                                                )}
                                            </span>
                                            <span className="routine-sequence-target">
                                                {formatExerciseTarget(exercise, libraryItem)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <section className="routine-muscle-panel" aria-label={`Mappa muscolare di ${routine.name}`}>
                        <div className="routine-muscle-map">
                            <MuscleModel
                                selectedMuscles={primaryMuscleIds}
                                secondaryMuscles={secondaryMuscleIds}
                                showLegend={false}
                            />
                        </div>
                        <details className="routine-muscle-details">
                            <summary className="disclosure-summary routine-muscle-summary">
                                <span>Muscoli coinvolti</span>
                                <ChevronDown size={18} aria-hidden="true" />
                            </summary>
                            <div className="routine-muscle-copy">
                                <p><strong>Primari:</strong> {primaryMuscleNames.length > 0 ? primaryMuscleNames.join(', ') : 'Nessuno'}</p>
                                <p><strong>Secondari:</strong> {secondaryMuscleNames.length > 0 ? secondaryMuscleNames.join(', ') : 'Nessuno'}</p>
                            </div>
                        </details>
                    </section>
                </div>
            )}
        </article>
    );
};
