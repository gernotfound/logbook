import React, { useCallback } from 'react';
import { MessageSquareText } from 'lucide-react';
import { useDialogStore } from '../../../store/useDialogStore';
import SessionSetRow from './SessionSetRow';
import { SessionExerciseHistory, SessionExerciseSetup } from './SessionExercisePanels';
import type { SessionExerciseHistoryEntry } from './SessionExercisePanels';
import { BufferedTextarea } from '../../UI/BufferedInput';
import SessionCardioFields from './SessionCardioFields';
import SessionExerciseToolbar from './SessionExerciseToolbar';
import { BufferedWorkoutScope } from '../../UI/bufferedWorkoutScope';
import { sessionSetHasMeaningfulData } from '../../../lib/workoutSetData';
import { captureSession, isCurrentSession } from '../../../lib/sync/session';
import type { Exercise, SessionExercise, SessionExerciseSet } from '../../../types';

interface SessionExerciseCardProps {
    exItem: SessionExercise;
    exIndex: number;
    totalExercises?: number;
    libDef?: Omit<Partial<Exercise>, 'trackingType'> & { name: string; trackingType?: string };
    pastWorkouts: SessionExerciseHistoryEntry[];
    isHistoryOpen: boolean;
    isSetupOpen: boolean;
    openSpecialMenuId: string | null;
    onMoveExercise?: (index: number, direction: 'up' | 'down') => void;
    onMoveToPosition?: (fromIndex: number, toIndex: number) => void;
    onToggleHistory: (exIndex: number) => void;
    onToggleSetup: (exIndex: number) => void;
    onRemoveExercise: (exIndex: number) => void;
    onUpdateSetupNote: (exId: string, note: string) => void;
    onUpdateSessionNote: (exIndex: number, note: string) => void;
    onUpdateTechnicalStandard: (exIndex: number, value: string) => void;
    onAddSet: (exIndex: number) => void;
    onRemoveSet: (exIndex: number, sIndex: number, setId: string, exerciseId?: string, workoutId?: string | null, expectedSet?: SessionExerciseSet) => void;
    onUpdateSet: (exIndex: number, setId: string, field: string, value: unknown) => void;
    onAddSpecialSet: (exIndex: number, type: string, setId: string) => void;
    onUpdateSpecialSet: (exIndex: number, setId: string, type: 'segments', segmentId: string, field: string, value: unknown) => void;
    onRemoveSpecialSet: (exIndex: number, setId: string, type: 'segments', segmentId: string) => void;
    onUpdateSetTarget: (exIndex: number, setId: string, reps: number | undefined) => void;
    onToggleSpecialMenu: (setId: string) => void;
    onRemoveLastSet?: (exIndex: number) => void;
}

const SessionExerciseCardInner: React.FC<SessionExerciseCardProps> = ({
    exItem,
    exIndex,
    totalExercises,
    libDef,
    pastWorkouts,
    isHistoryOpen,
    isSetupOpen,
    openSpecialMenuId,
    onMoveExercise: _onMoveExercise,
    onMoveToPosition,
    onToggleHistory,
    onToggleSetup,
    onRemoveExercise,
    onUpdateSetupNote,
    onUpdateSessionNote,
    onUpdateTechnicalStandard,
    onAddSet,
    onRemoveSet,
    onUpdateSet,
    onAddSpecialSet,
    onUpdateSpecialSet,
    onRemoveSpecialSet,
    onUpdateSetTarget,
    onToggleSpecialMenu,
    onRemoveLastSet
}) => {
    const exName = libDef ? libDef.name : "Esercizio rimosso";
    const exNotes = libDef ? (libDef.notes || '') : "";
    // A catalog exercise can occur multiple times in the same workout.
    // Runtime session instances have their own ID; the fallback mirrors the
    // existing accordion key for older in-memory snapshots lacking one.
    const exerciseInstanceId = exItem.id || `${exItem.exId}_${exIndex}`;
    const workoutId = React.useContext(BufferedWorkoutScope);
    const lastNote = pastWorkouts[0]?.note?.trim() || '';

    const [isNextNoteOpen, setIsNextNoteOpen] = React.useState(Boolean(exItem.sessionNote?.trim()));

    const handleRemoveLastSet = useCallback(async () => {
        if (onRemoveLastSet) {
            onRemoveLastSet(exIndex);
            return;
        }

        const sets = exItem.sets || [];
        if (sets.length === 0) return;
        const lastIndex = sets.length - 1;
        const lastSet = sets[lastIndex];

        const isFilled = sessionSetHasMeaningfulData(lastSet);

        if (isFilled) {
            const session = captureSession();
            const confirmed = await useDialogStore.getState().showConfirm(
                "La serie contiene dei dati. Vuoi davvero rimuoverla?"
            );
            if (!confirmed || !isCurrentSession(session)) return;
        }

        if (!lastSet.id) return;
        onRemoveSet(exIndex, lastIndex, lastSet.id, exItem.id, workoutId, lastSet);
    }, [exItem.sets, exItem.id, onRemoveSet, onRemoveLastSet, exIndex, workoutId]);

    return (
        <div className="section-divider session-exercise-card-content">
            <div style={{ marginBottom: '10px' }}>
                <h2 style={{color: 'var(--primary-color)', margin: 0}}>{exName}</h2>
            </div>
            <SessionExerciseToolbar
                exIndex={exIndex}
                totalExercises={totalExercises}
                isHistoryOpen={isHistoryOpen}
                isSetupOpen={isSetupOpen}
                onMoveToPosition={onMoveToPosition}
                onRemoveExercise={onRemoveExercise}
                onToggleHistory={onToggleHistory}
                onToggleSetup={onToggleSetup}
            />

            {isHistoryOpen && <SessionExerciseHistory exIndex={exIndex} pastWorkouts={pastWorkouts} trackingType={libDef?.trackingType} />}

            {isSetupOpen && <SessionExerciseSetup exItem={exItem} exIndex={exIndex} exNotes={exNotes} exerciseInstanceId={exerciseInstanceId}
                onUpdateTechnicalStandard={onUpdateTechnicalStandard} onUpdateSetupNote={onUpdateSetupNote} />}

            {lastNote && (
                <div className="session-previous-note">
                    <MessageSquareText size={18} aria-hidden="true" />
                    <span><b>Nota dall’ultima sessione:</b> {lastNote}</span>
                </div>
            )}

            {libDef?.trackingType === 'cardio' ? (
                exItem.sets?.[0]?.id ? <SessionCardioFields
                    key={exItem.sets[0].id}
                    set={exItem.sets[0]}
                    exerciseInstanceId={exerciseInstanceId}
                    exIndex={exIndex}
                    onUpdateSet={onUpdateSet}
                /> : <p role="alert">Serie cardio senza identificativo: dati di recupero non modificabili.</p>
            ) : (
                <>
                    {(exItem.sets || []).map((s, sIndex: number) => (
                        <SessionSetRow
                            key={s.id || sIndex}
                            set={s}
                            sIndex={sIndex}
                            exIndex={exIndex}
                            exerciseInstanceId={exerciseInstanceId}
                            trackingType={libDef?.trackingType}
                            isOpenMenu={openSpecialMenuId === s.id}
                            onToggleMenu={onToggleSpecialMenu}
                            onRemoveSet={onRemoveSet}
                            onUpdateSet={onUpdateSet}
                            onAddSpecialSet={onAddSpecialSet}
                            onUpdateSpecialSet={onUpdateSpecialSet}
                            onRemoveSpecialSet={onRemoveSpecialSet}
                            onUpdateSetTarget={onUpdateSetTarget}
                        />
                    ))}

                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            style={{ flex: 1, minWidth: 0, border: '1px dashed var(--glass-border)', background: 'var(--surface-light)', color: 'var(--text-muted)', marginBottom: 0 }}
                            onClick={handleRemoveLastSet}
                            disabled={(exItem.sets || []).length === 0}
                            aria-label="Rimuovi serie"
                        >
                            - Rimuovi serie
                        </button>
                        <button
                            type="button"
                            className="btn btn-small"
                            style={{ flex: 1, minWidth: 0, border: '1px dashed var(--glass-border)', background: 'var(--surface-light)', marginBottom: 0 }}
                            onClick={() => onAddSet(exIndex)}
                            aria-label="Aggiungi serie"
                        >
                            + Aggiungi serie
                        </button>
                    </div>
                </>
            )}

            <button
                type="button"
                className="session-next-note-toggle"
                onClick={() => setIsNextNoteOpen(open => !open)}
                aria-expanded={isNextNoteOpen}
            >
                <span>{exItem.sessionNote?.trim() ? 'Modifica nota per la prossima volta' : 'Aggiungi nota per la prossima volta'}</span>
                <span aria-hidden="true">{isNextNoteOpen ? '−' : '+'}</span>
            </button>
            <BufferedTextarea
                id={`session-note-${exerciseInstanceId}`}
                placeholder="Note per la prossima volta (dolori, feedback)..."
                value={exItem.sessionNote || ''}
                onChange={val => onUpdateSessionNote(exIndex, val)}
                className="session-next-note-editor"
                style={{
                    width: '100%',
                    fontSize: '16px',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    display: isNextNoteOpen ? 'block' : 'none',
                }}
            />
        </div>
    );
};

// Action props originate from stable useCallback handlers in ActiveWorkoutSession.
// Shallow comparison also invalidates memo when the parent replaces a callback.
export const SessionExerciseCard = React.memo(SessionExerciseCardInner);

export default SessionExerciseCard;
