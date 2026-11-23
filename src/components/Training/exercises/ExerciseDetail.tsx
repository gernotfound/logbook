import { useRef, useState, type MouseEvent } from 'react';
import { ChevronLeft, Copy, Pencil, Trash2 } from 'lucide-react';
import type { Exercise } from '../../../types';
import MuscleModel from '../MuscleModel';
import { muscleList, trackingLabel } from './exerciseArchivePresentation';

interface ExerciseDetailProps {
    exercise: Exercise;
    routineCount: number;
    onBack: () => void;
    onEditItem?: (exercise: Exercise) => void;
    onDuplicate: (exercise: Exercise) => Promise<void>;
    onDelete?: (id: string, event: MouseEvent) => void | Promise<void>;
}

export function ExerciseDetail({
    exercise, routineCount, onBack, onEditItem, onDuplicate, onDelete,
}: ExerciseDetailProps) {
    const [detailActionPending, setDetailActionPending] = useState(false);
    const detailActionPendingRef = useRef(false);

    const runDetailAction = async (action: () => void | Promise<void>) => {
        // The ref closes the repeat-click window before React commits disabled controls.
        if (detailActionPendingRef.current) return;
        detailActionPendingRef.current = true;
        setDetailActionPending(true);
        try {
            await action();
        } catch (error) {
            console.error('Azione sulla libreria esercizi non completata:', error);
        } finally {
            detailActionPendingRef.current = false;
            setDetailActionPending(false);
        }
    };

    return (
        <section className="exercise-detail-page" aria-label="Dettaglio esercizio">
            <div className="exercise-detail-top">
                <button
                    className="exercise-icon-button"
                    type="button"
                    aria-label="Torna all’elenco"
                    disabled={detailActionPending}
                    onClick={() => onBack()}
                >
                    <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <h3>{exercise.name}</h3>
            </div>

            <section className="exercise-detail-muscle-section" aria-label="Muscoli coinvolti">
                <strong className="exercise-detail-muscle-title">Muscoli coinvolti</strong>
                <div className="exercise-detail-muscle-map">
                    <MuscleModel
                        selectedMuscles={exercise.muscles || []}
                        secondaryMuscles={exercise.secondaryMuscles || []}
                        showLegend={false}
                        showTextSelection={false}
                    />
                </div>
                <div className="exercise-detail-muscle-legend">
                    <span>
                        <i className="primary" aria-hidden="true" />
                        Primari: {muscleList(exercise.muscles)}
                    </span>
                    <span>
                        <i className="secondary" aria-hidden="true" />
                        Secondari: {muscleList(exercise.secondaryMuscles)}
                    </span>
                </div>
            </section>

            <div className="exercise-detail-facts">
                <div className="exercise-detail-fact">
                    <span>Tracciamento</span>
                    <strong>{trackingLabel(exercise)}</strong>
                </div>
                <div className="exercise-detail-fact">
                    <span>Muscoli</span>
                    <strong>
                        {muscleList(exercise.muscles)}
                        {exercise.secondaryMuscles?.length
                            ? ` + ${muscleList(exercise.secondaryMuscles)}`
                            : ''}
                    </strong>
                </div>
                <div className="exercise-detail-fact">
                    <span>Utilizzo</span>
                    <strong>{routineCount} {routineCount === 1 ? 'scheda' : 'schede'}</strong>
                </div>
                <div className="exercise-detail-fact">
                    <span>Origine</span>
                    <strong>{exercise.isDefault ? 'Catalogo' : 'Personale'}</strong>
                </div>
            </div>

            <div className="exercise-detail-notes">
                <span>Note</span>
                <p>{exercise.notes?.trim() || 'Nessuna nota.'}</p>
            </div>

            <div className="exercise-detail-actions">
                {onEditItem && (
                    <button
                        className="btn exercise-action-button"
                        type="button"
                        disabled={detailActionPending}
                        onClick={() => onEditItem(exercise)}
                    >
                        <Pencil size={17} aria-hidden="true" />
                        Modifica
                    </button>
                )}
                <button
                    className="btn exercise-action-button"
                    type="button"
                    disabled={detailActionPending}
                    onClick={() => { void runDetailAction(() => onDuplicate(exercise)); }}
                >
                    <Copy size={17} aria-hidden="true" />
                    Duplica
                </button>
                {!exercise.isDefault && onDelete && (
                    <button
                        className="btn exercise-action-button exercise-action-danger"
                        type="button"
                        disabled={detailActionPending}
                        onClick={event => { void runDetailAction(() => onDelete(exercise.id, event)); }}
                    >
                        <Trash2 size={17} aria-hidden="true" />
                        Elimina
                    </button>
                )}
            </div>
        </section>
    );
}
