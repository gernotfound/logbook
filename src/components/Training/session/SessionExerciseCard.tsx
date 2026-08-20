import React, { useCallback, useMemo } from 'react';
import { useDialogStore } from '../../../store/useDialogStore';
import { Logic } from '../../../lib/logic';
import SessionSetRow from './SessionSetRow';

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
    onToggleHistory: () => void;
    onToggleSetup: () => void;
    onRemoveExercise: () => void;
    onUpdateSetupNote: (note: string) => void;
    onUpdateSessionNote: (note: string) => void;
    onAddSet: () => void;
    onRemoveSet: (sIndex: number) => void;
    onUpdateSet: (setId: string, field: string, value: any) => void;
    onAddSpecialSet: (type: string, setId: string) => void;
    onUpdateSpecialSet: (setId: string, type: 'dropsets' | 'isometrics', idx: number, field: string, value: any) => void;
    onRemoveSpecialSet: (setId: string, type: 'dropsets' | 'isometrics', idx: number) => void;
    onToggleSpecialMenu: (setId: string) => void;
    onRemoveLastSet?: () => void;
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
    onMoveExercise,
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
    const exName = libDef ? libDef.name : "Esercizio rimosso";
    const exNotes = libDef ? (libDef.notes || '') : "";
    const lastNote = pastWorkouts.find(p => p.note && p.note.trim() !== '')?.note || '';

    const primaryMuscles = useMemo<{ id: string; name: string }[]>(() => {
        if (!libDef || !Array.isArray(libDef.muscles)) return [];
        return libDef.muscles.map((mId: string) => {
            const found = Logic.MUSCLES.find(m => m.id === mId);
            return found || { id: mId, name: mId };
        });
    }, [libDef]);

    const secondaryMuscles = useMemo<{ id: string; name: string }[]>(() => {
        if (!libDef || !Array.isArray(libDef.secondaryMuscles)) return [];
        return libDef.secondaryMuscles.map((mId: string) => {
            const found = Logic.MUSCLES.find(m => m.id === mId);
            return found || { id: mId, name: mId };
        });
    }, [libDef]);

    const handleRemoveLastSet = useCallback(async () => {
        if (onRemoveLastSet) {
            onRemoveLastSet();
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
            (Array.isArray(lastSet.dropsets) && lastSet.dropsets.some((ds: any) => checkVal(ds.kg) || checkVal(ds.weight) || checkVal(ds.reps))) ||
            (Array.isArray(lastSet.isometrics) && lastSet.isometrics.some((iso: any) => checkVal(iso.kg) || checkVal(iso.weight) || checkVal(iso.time) || checkVal(iso.timeInSeconds)));

        if (isFilled) {
            const confirmed = await useDialogStore.getState().showConfirm(
                "La serie contiene dei dati. Vuoi davvero rimuoverla?"
            );
            if (!confirmed) return;
        }

        onRemoveSet(lastIndex);
    }, [exItem.sets, onRemoveSet, onRemoveLastSet]);

    const handleCardioChange = (field: 'time' | 'distance', value: string) => {
        const setId = exItem.sets[0]?.id;
        if (!setId) return;
        
        onUpdateSet(setId, field, value);

        const currentSet = exItem.sets[0];
        const newTimeStr = field === 'time' ? value : (currentSet?.time || '');
        const newDistStr = field === 'distance' ? value : (currentSet?.distance || '');
        
        const timeVal = parseFloat(newTimeStr.replace(',', '.'));
        const distVal = parseFloat(newDistStr.replace(',', '.'));
        
        if (!isNaN(timeVal) && !isNaN(distVal) && timeVal > 0) {
            const speed = distVal / (timeVal / 60);
            onUpdateSet(setId, 'speed', speed.toFixed(2));
        } else if (newTimeStr === '' || newDistStr === '') {
            onUpdateSet(setId, 'speed', '');
        }
    };

    return (
        <div style={{ marginBottom: '25px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                <h2 style={{ color: 'var(--primary-color)', margin: 0, fontSize: '1.15rem' }}>{exName}</h2>
                <div style={{ display: 'flex', gap: '5px' }}>
                    <button
                        type="button"
                        className="btn-small"
                        style={{
                            borderRadius: '8px',
                            minWidth: '36px',
                            minHeight: '36px',
                            opacity: exIndex === 0 ? 0.3 : 1,
                            cursor: exIndex === 0 ? 'not-allowed' : 'pointer'
                        }}
                        disabled={exIndex === 0}
                        onClick={() => onMoveExercise?.(exIndex, 'up')}
                        aria-label="Sposta esercizio su"
                    >
                        ⬆️
                    </button>
                    <button
                        type="button"
                        className="btn-small"
                        style={{
                            borderRadius: '8px',
                            minWidth: '36px',
                            minHeight: '36px',
                            opacity: (totalExercises !== undefined && exIndex >= totalExercises - 1) ? 0.3 : 1,
                            cursor: (totalExercises !== undefined && exIndex >= totalExercises - 1) ? 'not-allowed' : 'pointer'
                        }}
                        disabled={totalExercises !== undefined && exIndex >= totalExercises - 1}
                        onClick={() => onMoveExercise?.(exIndex, 'down')}
                        aria-label="Sposta esercizio giù"
                    >
                        ⬇️
                    </button>
                    <button
                        type="button"
                        className="btn-small"
                        style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '8px' }}
                        onClick={onRemoveExercise}
                        aria-label="Rimuovi esercizio dalla sessione"
                    >
                        🗑️
                    </button>
                    <button
                        type="button"
                        className={`btn-small toggle-btn ${isHistoryOpen ? 'active-highlight' : ''}`}
                        style={isHistoryOpen ? { background: 'var(--primary-color)', color: '#000' } : {}}
                        onClick={onToggleHistory}
                    >
                        🕒 Storico
                    </button>
                    <button
                        type="button"
                        className={`btn-small toggle-btn ${isSetupOpen ? 'active-highlight' : ''}`}
                        style={isSetupOpen ? { background: 'var(--primary-color)', color: '#000' } : {}}
                        onClick={onToggleSetup}
                    >
                        ⚙️ Setup
                    </button>
                </div>
            </div>

            {(primaryMuscles.length > 0 || secondaryMuscles.length > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px', marginBottom: '8px' }}>
                    {primaryMuscles.map(m => (
                        <span key={m.id} className="badge badge-primary">
                            {m.name}
                        </span>
                    ))}
                    {secondaryMuscles.map(m => (
                        <span
                            key={m.id}
                            className="badge"
                            style={{
                                background: 'var(--secondary-color, rgba(0, 229, 255, 0.3))',
                                color: '#fff',
                                border: '1px solid var(--secondary-color, #4db6ac)'
                            }}
                        >
                            {m.name}
                        </span>
                    ))}
                </div>
            )}

            {(exItem.minReps || exItem.maxReps) && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                    Rep min: {exItem.minReps || '-'} | Rep max: {exItem.maxReps || '-'}
                </div>
            )}
            {!(exItem.minReps || exItem.maxReps) && <div style={{ marginBottom: '15px' }}></div>}

            {isHistoryOpen && (
                <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                    <h3 style={{ marginBottom: '8px', marginTop: 0, fontSize: '0.85rem' }}>Ultimi 2 allenamenti:</h3>
                    {pastWorkouts.length === 0 ? (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nessun dato precedente trovato.</div>
                    ) : (
                        pastWorkouts.map((pw, idx) => (
                            <div key={idx} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px dashed var(--glass-border)' }}>
                                <strong style={{ fontSize: '0.85rem', color: 'var(--primary-color)' }}>{pw.date}</strong><br />
                                {pw.sets.map((s: any, sIdx: number) => (
                                    <span key={sIdx} style={{ fontSize: '0.85rem', marginRight: '15px', display: 'inline-block' }}>
                                        S{sIdx + 1}: {libDef?.trackingType === 'time' ? (
                                            <><b>{s.kg ? s.kg + 'kg ' : ''}</b>⏱️ <b>{s.time || '?'}</b></>
                                        ) : (
                                            <><b>{s.kg || '?'}</b> kg × <b>{s.reps || '?'}</b></>
                                        )}
                                    </span>
                                ))}
                                {pw.note && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>{pw.note}</div>}
                            </div>
                        ))
                    )}
                </div>
            )}

            {isSetupOpen && (
                <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                    <h3 style={{ marginBottom: '8px', marginTop: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Modifica setup (globale):</h3>
                    <input
                        id={`setup-${exItem.exId}`}
                        type="text"
                        defaultValue={exNotes}
                        placeholder="Note di setup (es. altezza sedile...)"
                        onBlur={(e) => onUpdateSetupNote(e.target.value)}
                        style={{ margin: 0, width: '100%' }}
                    />
                </div>
            )}

            {lastNote && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px', borderLeft: '3px solid var(--danger-color)', fontSize: '0.85rem', marginBottom: '15px', color: '#fca5a5' }}>
                    ⚠️ <b>Note scorsa volta:</b> {lastNote}
                </div>
            )}

            {libDef?.trackingType === 'cardio' ? (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px', border: '1px solid var(--glass-border)', marginTop: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                        <div>
                            <label className="text-muted text-xs mb-4 block">Durata (min)</label>
                            <input 
                                type="text" 
                                inputMode="decimal"
                                value={exItem.sets[0]?.time || ''} 
                                onChange={e => handleCardioChange('time', e.target.value)}
                                placeholder="es. 30"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block">Distanza (km)</label>
                            <input 
                                type="text" 
                                inputMode="decimal"
                                value={exItem.sets[0]?.distance || ''} 
                                onChange={e => handleCardioChange('distance', e.target.value)}
                                placeholder="es. 5.2"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block">Velocità media</label>
                            <input 
                                type="text" 
                                inputMode="decimal"
                                value={exItem.sets[0]?.speed || ''} 
                                onChange={e => onUpdateSet(exItem.sets[0]?.id, 'speed', e.target.value)}
                                placeholder="es. 10.5"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block">Inclinazione (%)</label>
                            <input 
                                type="text" 
                                inputMode="decimal"
                                value={exItem.sets[0]?.incline || ''} 
                                onChange={e => onUpdateSet(exItem.sets[0]?.id, 'incline', e.target.value)}
                                placeholder="es. 2.0"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-muted text-xs mb-4 block">Kcal stimate</label>
                        <input 
                            type="text" 
                            inputMode="decimal"
                            value={exItem.sets[0]?.kcal || ''} 
                            onChange={e => onUpdateSet(exItem.sets[0]?.id, 'kcal', e.target.value)}
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
                            onRemoveSet={onRemoveSet}
                            onUpdateSet={(field, val) => onUpdateSet(s.id, field, val)}
                            onAddSpecialSet={(type) => onAddSpecialSet(type, s.id)}
                            onUpdateSpecialSet={(type, dsIdx, field, val) => onUpdateSpecialSet(s.id, type, dsIdx, field, val)}
                            onRemoveSpecialSet={(type, dsIdx) => onRemoveSpecialSet(s.id, type, dsIdx)}
                        />
                    ))}

                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            style={{ flex: 1, minWidth: 0, border: '1px dashed var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', marginBottom: 0 }}
                            onClick={handleRemoveLastSet}
                            disabled={(exItem.sets || []).length === 0}
                            aria-label="Rimuovi serie"
                        >
                            - Rimuovi serie
                        </button>
                        <button
                            type="button"
                            className="btn btn-small"
                            style={{ flex: 1, minWidth: 0, border: '1px dashed var(--glass-border)', background: 'rgba(255,255,255,0.05)', marginBottom: 0 }}
                            onClick={onAddSet}
                            aria-label="Aggiungi serie"
                        >
                            + Aggiungi serie
                        </button>
                    </div>
                </>
            )}

            <textarea
                placeholder="Note per la prossima volta (dolori, feedback)..."
                value={exItem.sessionNote || ''}
                onChange={(e: any) => onUpdateSessionNote(e.target.value)}
                style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', color: 'var(--text-main)', borderRadius: '12px', marginTop: '12px', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box' }}
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
        prev.isHistoryOpen === next.isHistoryOpen &&
        prev.isSetupOpen === next.isSetupOpen &&
        prev.openSpecialMenuId === next.openSpecialMenuId &&
        prev.exIndex === next.exIndex &&
        prev.totalExercises === next.totalExercises
    );
});

export default SessionExerciseCard;
