import React, { useCallback, useEffect, useRef } from 'react';
import { History, Settings2, Trash2 } from 'lucide-react';
import { useDialogStore } from '../../../store/useDialogStore';
import SessionSetRow from './SessionSetRow';
import { BufferedInput, BufferedTextarea } from '../../UI/BufferedInput';

interface SessionExerciseCardProps {
    exItem: any;
    exIndex: number;
    totalExercises?: number;
    libDef: any;
    pastWorkouts: Array<{ date: string; sets: any[]; note: string }>;
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
    onAddSet: (exIndex: number) => void;
    onRemoveSet: (exIndex: number, sIndex: number) => void;
    onUpdateSet: (exIndex: number, setId: string, field: string, value: any) => void;
    onAddSpecialSet: (exIndex: number, type: string, setId: string) => void;
    onUpdateSpecialSet: (exIndex: number, setId: string, type: 'dropsets' | 'isometrics', idx: number, field: string, value: any) => void;
    onRemoveSpecialSet: (exIndex: number, setId: string, type: 'dropsets' | 'isometrics', idx: number) => void;
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
    onMoveToPosition,
    onToggleHistory,
    onToggleSetup,
    onRemoveExercise,
    onUpdateSetupNote,
    onUpdateSessionNote,
    onAddSet,
    onRemoveSet,
    onUpdateSet,
    onAddSpecialSet,
    onUpdateSpecialSet,
    onRemoveSpecialSet,
    onToggleSpecialMenu,
    onRemoveLastSet
}) => {
    const exName = libDef ? libDef.name : 'Esercizio rimosso';
    const exNotes = libDef ? (libDef.notes || '') : '';
    const lastNote = pastWorkouts.find(p => p.note && p.note.trim() !== '')?.note || '';
    const trackingType = libDef?.trackingType;

    const [showPositionMenu, setShowPositionMenu] = React.useState(false);
    const positionMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showPositionMenu) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (positionMenuRef.current && !positionMenuRef.current.contains(event.target as Node)) {
                setShowPositionMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showPositionMenu]);

    const handleRemoveLastSet = useCallback(async () => {
        if (onRemoveLastSet) {
            onRemoveLastSet(exIndex);
            return;
        }

        const sets = exItem.sets || [];
        if (sets.length === 0) return;
        const lastIndex = sets.length - 1;
        const lastSet = sets[lastIndex];

        const checkVal = (value: any) => {
            if (value === undefined || value === null) return false;
            const stringValue = String(value).trim();
            if (stringValue === '' || stringValue === '0') return false;
            const numberValue = Number(stringValue.replace(',', '.'));
            return isNaN(numberValue) ? true : numberValue !== 0;
        };

        const isFilled =
            checkVal(lastSet.kg) ||
            checkVal(lastSet.weight) ||
            checkVal(lastSet.reps) ||
            checkVal(lastSet.time) ||
            checkVal(lastSet.timeInSeconds) ||
            checkVal(lastSet.distance) ||
            checkVal(lastSet.speed) ||
            checkVal(lastSet.incline) ||
            checkVal(lastSet.kcal) ||
            (Array.isArray(lastSet.dropsets) && lastSet.dropsets.some((ds: any) => checkVal(ds.kg) || checkVal(ds.weight) || checkVal(ds.reps))) ||
            (Array.isArray(lastSet.isometrics) && lastSet.isometrics.some((iso: any) => checkVal(iso.kg) || checkVal(iso.weight) || checkVal(iso.time) || checkVal(iso.timeInSeconds)));

        if (isFilled) {
            const confirmed = await useDialogStore.getState().showConfirm(
                'La serie contiene dei dati. Vuoi davvero rimuoverla?'
            );
            if (!confirmed) return;
        }

        onRemoveSet(exIndex, lastIndex);
    }, [exItem.sets, onRemoveSet, onRemoveLastSet, exIndex]);

    const handleCardioChange = (field: 'time' | 'distance', value: string) => {
        const setId = exItem.sets[0]?.id;
        if (!setId) return;

        onUpdateSet(exIndex, setId, field, value);

        const currentSet = exItem.sets[0];
        const newTimeStr = field === 'time' ? value : (currentSet?.time || '');
        const newDistStr = field === 'distance' ? value : (currentSet?.distance || '');
        const timeVal = parseFloat(newTimeStr.replace(',', '.'));
        const distVal = parseFloat(newDistStr.replace(',', '.'));

        if (!isNaN(timeVal) && !isNaN(distVal) && timeVal > 0) {
            const speed = distVal / (timeVal / 60);
            onUpdateSet(exIndex, setId, 'speed', speed.toFixed(2));
        } else if (newTimeStr === '' || newDistStr === '') {
            onUpdateSet(exIndex, setId, 'speed', '');
        }
    };

    const repRange = exItem.minReps || exItem.maxReps
        ? `Range ${exItem.minReps || '–'}–${exItem.maxReps || '–'} reps`
        : null;

    return (
        <section className="workout-exercise" aria-labelledby={`exercise-title-${exItem.id || exIndex}`}>
            <div className="workout-exercise__header">
                <div className="workout-exercise__title-wrap">
                    <h2 id={`exercise-title-${exItem.id || exIndex}`} className="workout-exercise__title">{exName}</h2>
                    {repRange && <div className="workout-exercise__range">{repRange}</div>}
                </div>
            </div>

            <div className="workout-exercise__toolbar" aria-label={`Azioni per ${exName}`}>
                <div className="workout-exercise__position-wrap" ref={positionMenuRef}>
                    <button
                        type="button"
                        className="workout-position-button"
                        onClick={() => setShowPositionMenu(value => !value)}
                        aria-label="Cambia posizione esercizio"
                        aria-expanded={showPositionMenu}
                    >
                        #{exIndex + 1}
                    </button>
                    {showPositionMenu && totalExercises !== undefined && totalExercises > 1 && (
                        <div className="workout-position-menu" role="menu" aria-label="Posizione esercizio">
                            {Array.from({ length: totalExercises }, (_, index) => index).map(targetIdx => (
                                <button
                                    key={targetIdx}
                                    type="button"
                                    role="menuitem"
                                    className={`workout-position-menu__item ${targetIdx === exIndex ? 'active' : ''}`}
                                    onClick={() => {
                                        setShowPositionMenu(false);
                                        if (targetIdx !== exIndex) onMoveToPosition?.(exIndex, targetIdx);
                                    }}
                                >
                                    {targetIdx === exIndex ? `✓ ${targetIdx + 1}ª posizione` : `${targetIdx + 1}ª posizione`}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    className={`workout-tool-button ${isHistoryOpen ? 'active' : ''}`}
                    onClick={() => onToggleHistory(exIndex)}
                >
                    <History aria-hidden="true" /> Storico
                </button>
                <button
                    type="button"
                    className={`workout-tool-button ${isSetupOpen ? 'active' : ''}`}
                    onClick={() => onToggleSetup(exIndex)}
                >
                    <Settings2 aria-hidden="true" /> Setup
                </button>
                <button
                    type="button"
                    className="workout-tool-button danger"
                    onClick={() => onRemoveExercise(exIndex)}
                    aria-label="Rimuovi esercizio dalla sessione"
                >
                    <Trash2 aria-hidden="true" /> Rimuovi
                </button>
            </div>

            {isHistoryOpen && (
                <div className="workout-detail-panel">
                    <h3>Ultimi 2 allenamenti</h3>
                    {pastWorkouts.length === 0 ? (
                        <div className="text-sm text-muted">Nessun dato precedente trovato.</div>
                    ) : (
                        pastWorkouts.map((pastWorkout, index) => (
                            <div key={`${pastWorkout.date}-${index}`} className="workout-history-entry">
                                <div className="workout-history-entry__date">{pastWorkout.date}</div>
                                {pastWorkout.sets.map((set: any, setIndex: number) => {
                                    if (trackingType !== 'time' && trackingType !== 'cardio') {
                                        const hasKg = set.kg !== null && set.kg !== undefined && set.kg !== '';
                                        const hasReps = set.reps !== null && set.reps !== undefined && set.reps !== '';
                                        if (!hasKg && !hasReps) return null;
                                    }

                                    const displayKg = set.kg !== null && set.kg !== undefined && set.kg !== '' ? set.kg : '?';
                                    const displayReps = set.reps !== null && set.reps !== undefined && set.reps !== '' ? set.reps : '?';
                                    const displayTime = set.time !== null && set.time !== undefined && set.time !== '' ? set.time : '?';

                                    return (
                                        <span key={set.id || setIndex} className="workout-history-entry__set">
                                            S{setIndex + 1}: {trackingType === 'time' ? (
                                                <><b>{set.kg ? `${set.kg} kg ` : ''}</b>⏱ <b>{displayTime}</b></>
                                            ) : (
                                                <><b>{displayKg}</b> kg × <b>{displayReps}</b></>
                                            )}
                                        </span>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
            )}

            {isSetupOpen && (
                <div className="workout-detail-panel">
                    <h3>Modifica setup globale</h3>
                    <input
                        id={`setup-${exItem.exId}`}
                        type="text"
                        defaultValue={exNotes}
                        placeholder="Note di setup (es. altezza sedile...)"
                        onBlur={(event) => onUpdateSetupNote(exItem.exId, event.target.value)}
                    />
                </div>
            )}

            {lastNote && (
                <div className="workout-last-note">
                    <b>Nota dalla sessione precedente:</b> {lastNote}
                </div>
            )}

            {trackingType === 'cardio' ? (
                <div className="workout-cardio-panel">
                    <div className="workout-cardio-grid">
                        <div>
                            <label>Durata (min)</label>
                            <BufferedInput
                                type="text"
                                inputMode="decimal"
                                value={exItem.sets[0]?.time || ''}
                                onChange={val => handleCardioChange('time', val)}
                                placeholder="es. 30"
                            />
                        </div>
                        <div>
                            <label>Distanza (km)</label>
                            <BufferedInput
                                type="text"
                                inputMode="decimal"
                                value={exItem.sets[0]?.distance || ''}
                                onChange={val => handleCardioChange('distance', val)}
                                placeholder="es. 5.2"
                            />
                        </div>
                        <div>
                            <label>Velocità media</label>
                            <BufferedInput
                                type="text"
                                inputMode="decimal"
                                value={exItem.sets[0]?.speed || ''}
                                onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'speed', val)}
                                placeholder="es. 10.5"
                            />
                        </div>
                        <div>
                            <label>Inclinazione (%)</label>
                            <BufferedInput
                                type="text"
                                inputMode="decimal"
                                value={exItem.sets[0]?.incline || ''}
                                onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'incline', val)}
                                placeholder="es. 2.0"
                            />
                        </div>
                    </div>
                    <div className="workout-cardio-kcal">
                        <label>Kcal stimate</label>
                        <BufferedInput
                            type="text"
                            inputMode="decimal"
                            value={exItem.sets[0]?.kcal || ''}
                            onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'kcal', val)}
                            placeholder="es. 350"
                        />
                    </div>
                </div>
            ) : (
                <>
                    {(exItem.sets || []).length > 0 && (
                        <div className="workout-set-columns" aria-hidden="true">
                            <span>Serie</span>
                            <span>Kg</span>
                            <span>{trackingType === 'time' ? 'Tempo' : 'Reps'}</span>
                            <span>Extra</span>
                        </div>
                    )}

                    {(exItem.sets || []).map((set: any, setIndex: number) => (
                        <SessionSetRow
                            key={set.id || setIndex}
                            set={set}
                            sIndex={setIndex}
                            exIndex={exIndex}
                            trackingType={trackingType}
                            isOpenMenu={openSpecialMenuId === set.id}
                            onToggleMenu={() => onToggleSpecialMenu(set.id)}
                            onRemoveSet={() => onRemoveSet(exIndex, setIndex)}
                            onUpdateSet={(setId, field, value) => onUpdateSet(exIndex, setId, field, value)}
                            onAddSpecialSet={(type, setId) => onAddSpecialSet(exIndex, type, setId)}
                            onUpdateSpecialSet={(setId, type, specialIndex, field, value) => onUpdateSpecialSet(exIndex, setId, type, specialIndex, field, value)}
                            onRemoveSpecialSet={(setId, type, specialIndex) => onRemoveSpecialSet(exIndex, setId, type, specialIndex)}
                        />
                    ))}

                    <div
                        className="workout-set-actions"
                        style={{ '--workout-actions-display': 'flex' } as React.CSSProperties}
                    >
                        <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={handleRemoveLastSet}
                            disabled={(exItem.sets || []).length === 0}
                            aria-label="Rimuovi serie"
                        >
                            - Rimuovi serie
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => onAddSet(exIndex)}
                            aria-label="Aggiungi serie"
                        >
                            + Aggiungi serie
                        </button>
                    </div>
                </>
            )}

            <BufferedTextarea
                className="workout-notes"
                placeholder="Note per la prossima volta (dolori, feedback)..."
                value={exItem.sessionNote || ''}
                onChange={value => onUpdateSessionNote(exIndex, value)}
            />
        </section>
    );
};

export const SessionExerciseCard = React.memo(SessionExerciseCardInner, (prev, next) => {
    return (
        prev.exItem === next.exItem &&
        prev.libDef === next.libDef &&
        prev.pastWorkouts === next.pastWorkouts &&
        prev.isHistoryOpen === next.isHistoryOpen &&
        prev.isSetupOpen === next.isSetupOpen &&
        prev.openSpecialMenuId === next.openSpecialMenuId &&
        prev.exIndex === next.exIndex &&
        prev.totalExercises === next.totalExercises
    );
});

export default SessionExerciseCard;
