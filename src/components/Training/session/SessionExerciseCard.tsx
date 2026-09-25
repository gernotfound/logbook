import React, { useCallback, useEffect, useRef } from 'react';
import { Trash2, Settings, AlertTriangle } from 'lucide-react';
import { useDialogStore } from '../../../store/useDialogStore';
import SessionSetRow from './SessionSetRow';
import { BufferedInput, BufferedTextarea } from '../../UI/BufferedInput';

interface SessionExerciseCardProps {
    exItem: any;
    exIndex: number;
    totalExercises?: number;
    libDef: any;
    pastWorkouts: Array<{ date: string; sets: any[]; note: string }>;
    progressionHint?: {
        previousDate?: string;
        previousReference?: string;
        quality: string;
        comparisonStatus: 'comparable' | 'limited' | 'not_comparable';
        comparisonReasons: string[];
        baselineState?: string;
        baselineVersion?: number;
        contractTarget?: string;
        nextAction?: string;
    };
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
    onRemoveSet: (exIndex: number, sIndex: number) => void;
    onUpdateSet: (exIndex: number, setId: string, field: string, value: any) => void;
    onAddSpecialSet: (exIndex: number, type: string, setId: string) => void;
    onUpdateSpecialSet: (exIndex: number, setId: string, type: 'dropsets' | 'isometrics' | 'segments', idx: number, field: string, value: any) => void;
    onRemoveSpecialSet: (exIndex: number, setId: string, type: 'dropsets' | 'isometrics' | 'segments', idx: number) => void;
    onAddSegment: (exIndex: number, setId: string) => void;
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
    progressionHint,
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
    onAddSegment,
    onUpdateSetTarget,
    onToggleSpecialMenu,
    onRemoveLastSet
}) => {
    const exName = libDef ? libDef.name : "Esercizio rimosso";
    const exNotes = libDef ? (libDef.notes || '') : "";
    const lastNote = pastWorkouts.find(p => p.note && p.note.trim() !== '')?.note || '';

    const [showPositionMenu, setShowPositionMenu] = React.useState(false);
    const positionMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showPositionMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (positionMenuRef.current && !positionMenuRef.current.contains(e.target as Node)) {
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

        const checkVal = (v: any) => {
            if (v === undefined || v === null) return false;
            const s = String(v).trim();
            if (s === '' || s === '0') return false;
            const n = Number(s.replace(',', '.'));
            return isNaN(n) ? true : n !== 0;
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
            lastSet.rir !== undefined ||
            (Array.isArray(lastSet.dropsets) && lastSet.dropsets.some((ds: any) => checkVal(ds.kg) || checkVal(ds.weight) || checkVal(ds.reps))) ||
            (Array.isArray(lastSet.isometrics) && lastSet.isometrics.some((iso: any) => checkVal(iso.kg) || checkVal(iso.weight) || checkVal(iso.time) || checkVal(iso.timeInSeconds)));

        if (isFilled) {
            const confirmed = await useDialogStore.getState().showConfirm(
                "La serie contiene dei dati. Vuoi davvero rimuoverla?"
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

    return (
        <div className="section-divider">
            <div style={{ marginBottom: '10px' }}>
                <h2 style={{color: 'var(--primary-color)', margin: 0}}>{exName}</h2>
                {progressionHint && (
                    <div style={{ marginTop: '6px', padding: '8px 10px', borderRadius: '8px', background: 'var(--surface-light)', border: '1px solid var(--glass-border)', display: 'grid', gap: '4px' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            Confrontabilità: {progressionHint.comparisonStatus === 'comparable' ? 'confrontabile' : progressionHint.comparisonStatus === 'limited' ? 'limitata' : 'non confrontabile'}
                            {progressionHint.baselineVersion ? ` · baseline v${progressionHint.baselineVersion}` : ''}
                            {progressionHint.baselineState ? ` · ${progressionHint.baselineState}` : ''}
                        </span>
                        {progressionHint.previousReference ? (
                            <>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    Ultima esposizione confrontabile · {progressionHint.previousDate || 'data non disponibile'}
                                </span>
                                <strong style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{progressionHint.previousReference}</strong>
                            </>
                        ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nessun riferimento precedente direttamente confrontabile.</span>
                        )}
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{progressionHint.quality}</span>
                        {progressionHint.comparisonReasons.length > 0 && (
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{progressionHint.comparisonReasons.join(' ')}</span>
                        )}
                        {progressionHint.contractTarget && <span style={{ fontSize: '0.78rem' }}><strong>Target:</strong> {progressionHint.contractTarget}</span>}
                        {progressionHint.nextAction && <span style={{ fontSize: '0.78rem' }}><strong>Azione prevista:</strong> {progressionHint.nextAction}</span>}
                    </div>
                )}
            </div>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
                {/* Position dropdown */}
                <div style={{ position: 'relative' }} ref={positionMenuRef}>
                    <button
                        type="button"
                        className="btn-small"
                        style={{ borderRadius: '8px', minWidth: '44px', minHeight: '44px', fontWeight: 'bold', fontSize: '0.85rem', letterSpacing: '0.03em', color: 'var(--text-main)' }}
                        onClick={() => setShowPositionMenu(v => !v)}
                        aria-label="Cambia posizione esercizio"
                    >#{exIndex + 1}</button>
                    {showPositionMenu && totalExercises !== undefined && totalExercises > 1 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: 'var(--surface-color)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '4px', minWidth: '140px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', marginTop: '4px' }}>
                            {Array.from({ length: totalExercises }, (_, i) => i).map(targetIdx => (
                                <button
                                    key={targetIdx}
                                    type="button"
                                    onClick={() => { setShowPositionMenu(false); if (targetIdx !== exIndex) onMoveToPosition?.(exIndex, targetIdx); }}
                                    style={{
                                        display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                                        background: targetIdx === exIndex ? 'rgba(0,229,255,0.15)' : 'transparent',
                                        border: 'none', color: targetIdx === exIndex ? 'var(--primary-color)' : 'var(--text-main)',
                                        cursor: targetIdx === exIndex ? 'default' : 'pointer', fontSize: '0.85rem', borderRadius: '6px'
                                    }}
                                >{targetIdx === exIndex ? `✓ ${targetIdx + 1}ª posizione` : `${targetIdx + 1}ª posizione`}</button>
                            ))}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    className="btn-small"
                    style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '8px' }}
                    onClick={() => onRemoveExercise(exIndex)}
                    aria-label="Rimuovi esercizio dalla sessione"
                >
                    <Trash2 size={16} aria-hidden="true" />

                </button>
                <button
                    type="button"
                    className={`btn-small toggle-btn ${isHistoryOpen ? 'active-highlight' : ''}`}
                    style={isHistoryOpen ? { background: 'var(--primary-color)', color: 'var(--on-primary)' } : {}}
                    onClick={() => onToggleHistory(exIndex)}
                >
                    🕒 Storico
                </button>
                <button
                    type="button"
                    className={`btn-small toggle-btn ${isSetupOpen ? 'active-highlight' : ''}`}
                    style={isSetupOpen ? { background: 'var(--primary-color)', color: 'var(--on-primary)' } : {}}
                    onClick={() => onToggleSetup(exIndex)}
                >
                    <Settings size={16} aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} /> Setup
                </button>
            </div>

            {(exItem.minReps || exItem.maxReps) && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                    Rep min: {exItem.minReps || '-'} | Rep max: {exItem.maxReps || '-'}
                </div>
            )}
            {!(exItem.minReps || exItem.maxReps) && <div style={{ marginBottom: '15px' }}></div>}

            {isHistoryOpen && (
                <div style={{ padding: '12px', background: 'var(--surface-light)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                    <h3 style={{marginBottom: '8px', marginTop: 0}}>Ultimi 2 allenamenti:</h3>
                    {pastWorkouts.length === 0 ? (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nessun dato precedente trovato.</div>
                    ) : (
                        pastWorkouts.map((pw, idx) => (
                            <div key={idx} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px dashed var(--glass-border)' }}>
                                <strong style={{ fontSize: '0.85rem', color: 'var(--primary-color)' }}>{pw.date}</strong><br />
                                {pw.sets.map((s: any, sIdx: number) => {
                                    // Salta la serie se entrambi i campi sono assenti (weight_reps)
                                    if (libDef?.trackingType !== 'time' && libDef?.trackingType !== 'cardio') {
                                        const hasKg = s.kg !== null && s.kg !== undefined && s.kg !== '';
                                        const hasReps = s.reps !== null && s.reps !== undefined && s.reps !== '';
                                        if (!hasKg && !hasReps) return null;
                                    }
                                    
                                    const displayKg = s.kg !== null && s.kg !== undefined && s.kg !== '' ? s.kg : '?';
                                    const displayReps = s.reps !== null && s.reps !== undefined && s.reps !== '' ? s.reps : '?';
                                    const displayTime = s.time !== null && s.time !== undefined && s.time !== '' ? s.time : '?';
                                    const displayRir = Number.isInteger(s.rir) && s.rir >= 0 && s.rir <= 10 ? s.rir : undefined;

                                    return (
                                        <span key={sIdx} style={{ fontSize: '0.85rem', marginRight: '15px', display: 'inline-block' }}>
                                            S{sIdx + 1}: {libDef?.trackingType === 'time' ? (
                                                <><b>{s.kg ? s.kg + 'kg ' : ''}</b>⏱️ <b>{displayTime}</b></>
                                            ) : (
                                                <><b>{displayKg}</b> kg × <b>{displayReps}</b>{displayRir !== undefined && <> · <b>{displayRir} RIR</b></>}</>
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
                <div style={{ padding: '12px', background: 'var(--surface-light)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                    <h3 style={{marginBottom: '8px', marginTop: 0, color: 'var(--text-muted)'}}>Setup e standard tecnico</h3>
                    <label className="text-xs text-muted" htmlFor={`technical-standard-${exItem.exId}`}>Standard tecnico di questa sessione</label>
                    <BufferedInput
                        id={`technical-standard-${exItem.exId}`}
                        type="text"
                        value={exItem.technicalStandard || ''}
                        placeholder="Es. stesso macchinario, ROM completo, fermo 1 s"
                        onChange={value => onUpdateTechnicalStandard(exIndex, value)}
                        style={{ margin: '4px 0 10px', width: '100%', fontSize: '16px' }}
                    />
                    <p className="text-xs text-muted" style={{ margin: '0 0 10px' }}>
                        Se cambia rispetto allo storico, LogBook limita il confronto diretto senza modificare il programma.
                    </p>
                    <label className="text-xs text-muted" htmlFor={`setup-${exItem.exId}`}>Nota setup libreria (globale)</label>
                    <input
                        id={`setup-${exItem.exId}`}
                        type="text"
                        defaultValue={exNotes}
                        placeholder="Es. altezza sedile abituale"
                        onBlur={(e) => onUpdateSetupNote(exItem.exId, e.target.value)}
                        style={{ margin: '4px 0 0', width: '100%', fontSize: '16px' }}
                    />
                </div>
            )}

            {lastNote && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px', borderLeft: '3px solid var(--danger-color)', fontSize: '0.85rem', marginBottom: '15px', color: '#fca5a5' }}>
                    <AlertTriangle size={16} aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px', color: 'var(--warning-color)' }} /> <b>Note scorsa volta:</b> {lastNote}
                </div>
            )}

            {libDef?.trackingType === 'cardio' ? (
                <div style={{ background: 'var(--surface-light)', padding: '15px', borderRadius: '12px', border: '1px solid var(--glass-border)', marginTop: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                        <div>
                            <label className="text-muted text-xs mb-4 block">Durata (min)</label>
                            <BufferedInput 
                                type="text" 
                                inputMode="decimal"
                                value={exItem.sets[0]?.time || ''} 
                                onChange={val => handleCardioChange('time', val)}
                                placeholder="es. 30"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block">Distanza (km)</label>
                            <BufferedInput 
                                type="text" 
                                inputMode="decimal"
                                value={exItem.sets[0]?.distance || ''} 
                                onChange={val => handleCardioChange('distance', val)}
                                placeholder="es. 5.2"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block">Velocità media</label>
                            <BufferedInput 
                                type="text" 
                                inputMode="decimal"
                                value={exItem.sets[0]?.speed || ''} 
                                onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'speed', val)}
                                placeholder="es. 10.5"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block">Inclinazione (%)</label>
                            <BufferedInput 
                                type="text" 
                                inputMode="decimal"
                                value={exItem.sets[0]?.incline || ''} 
                                onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'incline', val)}
                                placeholder="es. 2.0"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-muted text-xs mb-4 block">Kcal stimate</label>
                        <BufferedInput 
                            type="text" 
                            inputMode="decimal"
                            value={exItem.sets[0]?.kcal || ''} 
                            onChange={val => onUpdateSet(exIndex, exItem.sets[0]?.id, 'kcal', val)}
                            placeholder="es. 350"
                            className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                            style={{ fontSize: '16px', boxSizing: 'border-box' }}
                        />
                    </div>
                </div>
            ) : (
                <>
                    {(exItem.sets || []).map((s: any, sIndex: number) => (
                        <SessionSetRow
                            key={s.id || sIndex}
                            set={s}
                            sIndex={sIndex}
                            exIndex={exIndex}
                            trackingType={libDef?.trackingType}
                            isOpenMenu={openSpecialMenuId === s.id}
                            onToggleMenu={() => onToggleSpecialMenu(s.id)}
                            onRemoveSet={() => onRemoveSet(exIndex, sIndex)}
                            onUpdateSet={(setId, field, val) => onUpdateSet(exIndex, setId, field, val)}
                            onAddSpecialSet={(type, setId) => onAddSpecialSet(exIndex, type, setId)}
                            onUpdateSpecialSet={(setId, type, dsIdx, field, val) => onUpdateSpecialSet(exIndex, setId, type, dsIdx, field, val)}
                            onRemoveSpecialSet={(setId, type, dsIdx) => onRemoveSpecialSet(exIndex, setId, type, dsIdx)}
                            onAddSegment={(setId) => onAddSegment(exIndex, setId)}
                            onUpdateSetTarget={(setId, reps) => onUpdateSetTarget(exIndex, setId, reps)}
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

            <BufferedTextarea
                placeholder="Note per la prossima volta (dolori, feedback)..."
                value={exItem.sessionNote || ''}
                onChange={val => onUpdateSessionNote(exIndex, val)}
                style={{ width: '100%', padding: '12px', background: 'var(--surface-light)', border: '1px solid var(--glass-border)', color: 'var(--text-main)', borderRadius: '12px', marginTop: '12px', fontSize: '16px', resize: 'vertical', boxSizing: 'border-box' }}
            />
        </div>
    );
};

// React.memo con comparatore personalizzato:
// Si ri-renderizza SOLO quando cambiano i dati reali (exItem, libDef, stato pannelli).
// Le callback inline di TrainingSession vengono ignorate — questo evita che ogni
// battitura in un esercizio ri-renderizzi TUTTI gli altri esercizi della sessione.
export const SessionExerciseCard = React.memo(SessionExerciseCardInner, (prev, next) => {
    return (
        prev.exItem === next.exItem &&
        prev.libDef === next.libDef &&
        prev.pastWorkouts === next.pastWorkouts &&
        prev.progressionHint?.previousDate === next.progressionHint?.previousDate &&
        prev.progressionHint?.previousReference === next.progressionHint?.previousReference &&
        prev.progressionHint?.quality === next.progressionHint?.quality &&
        prev.isHistoryOpen === next.isHistoryOpen &&
        prev.isSetupOpen === next.isSetupOpen &&
        prev.openSpecialMenuId === next.openSpecialMenuId &&
        prev.exIndex === next.exIndex &&
        prev.totalExercises === next.totalExercises
    );
});

export default SessionExerciseCard;
