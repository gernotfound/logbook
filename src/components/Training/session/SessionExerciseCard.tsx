import React, { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, ChevronDown, Clock3, History, Minus, Plus, Settings2, Trash2 } from 'lucide-react';
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
    onMoveExercise: _onMoveExercise,
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
            const normalized = String(value).trim();
            if (normalized === '' || normalized === '0') return false;
            const number = Number(normalized.replace(',', '.'));
            return isNaN(number) ? true : number !== 0;
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
            const confirmed = await useDialogStore.getState().showConfirm('La serie contiene dei dati. Vuoi davvero rimuoverla?');
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

    return (
        <article className="section-divider workout-exercise-card">
            <header className="workout-exercise-card__header">
                <div className="workout-exercise-card__title-wrap">
                    <span className="workout-exercise-card__eyebrow">Esercizio {exIndex + 1}</span>
                    <h2>{exName}</h2>
                    {(exItem.minReps || exItem.maxReps) && (
                        <span className="workout-exercise-card__range">
                            Range reps {exItem.minReps || '–'}–{exItem.maxReps || '–'}
                        </span>
                    )}
                </div>

                <div className="workout-exercise-card__position" ref={positionMenuRef}>
                    <button
                        type="button"
                        className="exercise-position-trigger"
                        onClick={() => setShowPositionMenu(value => !value)}
                        aria-expanded={showPositionMenu}
                        aria-label="Cambia posizione esercizio"
                    >
                        #{exIndex + 1}<ChevronDown size={14} aria-hidden="true" />
                    </button>
                    {showPositionMenu && totalExercises !== undefined && totalExercises > 1 && (
                        <div className="exercise-position-menu" role="menu">
                            {Array.from({ length: totalExercises }, (_, index) => index).map(targetIdx => (
                                <button
                                    key={targetIdx}
                                    type="button"
                                    className={targetIdx === exIndex ? 'is-current' : ''}
                                    onClick={() => {
                                        setShowPositionMenu(false);
                                        if (targetIdx !== exIndex) onMoveToPosition?.(exIndex, targetIdx);
                                    }}
                                >
                                    {targetIdx === exIndex ? 'Attuale · ' : ''}{targetIdx + 1}ª posizione
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </header>

            <div className="workout-exercise-card__toolbar">
                <button type="button" className={`exercise-tool ${isHistoryOpen ? 'is-active' : ''}`} onClick={() => onToggleHistory(exIndex)}>
                    <History size={16} aria-hidden="true" /> Storico
                </button>
                <button type="button" className={`exercise-tool ${isSetupOpen ? 'is-active' : ''}`} onClick={() => onToggleSetup(exIndex)}>
                    <Settings2 size={16} aria-hidden="true" /> Setup
                </button>
                <button type="button" className="exercise-tool exercise-tool--danger" onClick={() => onRemoveExercise(exIndex)} aria-label="Rimuovi esercizio dalla sessione">
                    <Trash2 size={16} aria-hidden="true" /> Rimuovi
                </button>
            </div>

            {isHistoryOpen && (
                <section className="exercise-detail-panel">
                    <div className="exercise-detail-panel__heading">
                        <Clock3 size={16} aria-hidden="true" />
                        <h3>Ultimi 2 allenamenti</h3>
                    </div>
                    {pastWorkouts.length === 0 ? (
                        <p className="exercise-detail-panel__empty">Nessun dato precedente trovato.</p>
                    ) : (
                        <div className="exercise-history-list">
                            {pastWorkouts.map((pastWorkout, idx) => (
                                <div key={idx} className="exercise-history-item">
                                    <strong>{pastWorkout.date}</strong>
                                    <div className="exercise-history-item__sets">
                                        {pastWorkout.sets.map((set: any, setIndex: number) => {
                                            if (libDef?.trackingType !== 'time' && libDef?.trackingType !== 'cardio') {
                                                const hasKg = set.kg !== null && set.kg !== undefined && set.kg !== '';
                                                const hasReps = set.reps !== null && set.reps !== undefined && set.reps !== '';
                                                if (!hasKg && !hasReps) return null;
                                            }
                                            const displayKg = set.kg !== null && set.kg !== undefined && set.kg !== '' ? set.kg : '?';
                                            const displayReps = set.reps !== null && set.reps !== undefined && set.reps !== '' ? set.reps : '?';
                                            const displayTime = set.time !== null && set.time !== undefined && set.time !== '' ? set.time : '?';
                                            return (
                                                <span key={setIndex}>
                                                    S{setIndex + 1} · {libDef?.trackingType === 'time'
                                                        ? `${set.kg ? `${set.kg} kg · ` : ''}${displayTime}`
                                                        : `${displayKg} kg × ${displayReps}`}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {isSetupOpen && (
                <section className="exercise-detail-panel">
                    <div className="exercise-detail-panel__heading">
                        <Settings2 size={16} aria-hidden="true" />
                        <h3>Setup globale</h3>
                    </div>
                    <input
                        id={`setup-${exItem.exId}`}
                        type="text"
                        defaultValue={exNotes}
                        placeholder="Altezza sedile, grip, posizione..."
                        onBlur={event => onUpdateSetupNote(exItem.exId, event.target.value)}
                    />
                </section>
            )}

            {lastNote && (
                <div className="exercise-last-note">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <div><strong>Nota dalla scorsa volta</strong><span>{lastNote}</span></div>
                </div>
            )}

            {libDef?.trackingType === 'cardio' ? (
                <div className="cardio-set-panel">
                    <div className="cardio-set-panel__grid">
                        <label className="field-stack">
                            <span className="field-label">Durata (min)</span>
                            <BufferedInput type="text" inputMode="decimal" value={exItem.sets[0]?.time || ''} onChange={val => handleCardioChange('time', val)} placeholder="30" />
                        </label>
                        <label className="field-stack">
                            <span className="field-label">Distanza (km)</span>
                            <BufferedInput type="text" inputMode="decimal" value={exItem.sets[0]?.distance || ''} onChange={val => handleCardioChange('distance', val)} placeholder="5.2" />
                        </label>
                        <label className="field-stack">
                            <span className="field-label">Velocità media</span>
                            <BufferedInput type="text" inputMode="decimal" value={exItem.sets[0]?.speed || ''} onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'speed', val)} placeholder="10.5" />
                        </label>
                        <label className="field-stack">
                            <span className="field-label">Inclinazione (%)</span>
                            <BufferedInput type="text" inputMode="decimal" value={exItem.sets[0]?.incline || ''} onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'incline', val)} placeholder="2.0" />
                        </label>
                    </div>
                    <label className="field-stack">
                        <span className="field-label">Kcal stimate</span>
                        <BufferedInput type="text" inputMode="decimal" value={exItem.sets[0]?.kcal || ''} onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'kcal', val)} placeholder="350" />
                    </label>
                </div>
            ) : (
                <>
                    <div className="workout-set-list">
                        {(exItem.sets || []).map((set: any, setIndex: number) => (
                            <SessionSetRow
                                key={set.id || setIndex}
                                set={set}
                                sIndex={setIndex}
                                exIndex={exIndex}
                                trackingType={libDef?.trackingType}
                                isOpenMenu={openSpecialMenuId === set.id}
                                onToggleMenu={() => onToggleSpecialMenu(set.id)}
                                onRemoveSet={() => onRemoveSet(exIndex, setIndex)}
                                onUpdateSet={(setId, field, val) => onUpdateSet(exIndex, setId, field, val)}
                                onAddSpecialSet={(type, setId) => onAddSpecialSet(exIndex, type, setId)}
                                onUpdateSpecialSet={(setId, type, specialIndex, field, val) => onUpdateSpecialSet(exIndex, setId, type, specialIndex, field, val)}
                                onRemoveSpecialSet={(setId, type, specialIndex) => onRemoveSpecialSet(exIndex, setId, type, specialIndex)}
                            />
                        ))}
                    </div>
                    <div className="workout-set-actions">
                        <button type="button" className="btn btn-secondary btn-small" onClick={handleRemoveLastSet} disabled={(exItem.sets || []).length === 0} aria-label="Rimuovi serie">
                            <Minus size={16} aria-hidden="true" /> Rimuovi serie
                        </button>
                        <button type="button" className="btn btn-small" onClick={() => onAddSet(exIndex)} aria-label="Aggiungi serie">
                            <Plus size={16} aria-hidden="true" /> Aggiungi serie
                        </button>
                    </div>
                </>
            )}

            <BufferedTextarea
                className="workout-exercise-note"
                placeholder="Note per la prossima volta: dolori, feedback, setup..."
                value={exItem.sessionNote || ''}
                onChange={val => onUpdateSessionNote(exIndex, val)}
            />
        </article>
    );
};

export const SessionExerciseCard = React.memo(SessionExerciseCardInner, (prev, next) => (
    prev.exItem === next.exItem &&
    prev.libDef === next.libDef &&
    prev.pastWorkouts === next.pastWorkouts &&
    prev.isHistoryOpen === next.isHistoryOpen &&
    prev.isSetupOpen === next.isSetupOpen &&
    prev.openSpecialMenuId === next.openSpecialMenuId &&
    prev.exIndex === next.exIndex &&
    prev.totalExercises === next.totalExercises
));

export default SessionExerciseCard;
