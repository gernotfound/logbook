import React from 'react';
import SessionSetRow from './SessionSetRow';

interface SessionExerciseCardProps {
    exItem: any;
    exIndex: number;
    libDef: any;
    pastWorkouts: Array<{ date: string; sets: any[]; note: string }>;
    isHistoryOpen: boolean;
    isSetupOpen: boolean;
    openSpecialMenuId: string | null;
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
}

export const SessionExerciseCard: React.FC<SessionExerciseCardProps> = ({
    exItem,
    exIndex,
    libDef,
    pastWorkouts,
    isHistoryOpen,
    isSetupOpen,
    openSpecialMenuId,
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
    onToggleSpecialMenu
}) => {
    const exName = libDef ? libDef.name : "Esercizio Rimosso";
    const exNotes = libDef ? (libDef.notes || '') : "";
    const lastNote = pastWorkouts.find(p => p.note && p.note.trim() !== '')?.note || '';

    return (
        <div style={{ marginBottom: '25px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                <h3 style={{ color: 'var(--primary-color)', margin: 0 }}>{exName}</h3>
                <div style={{ display: 'flex', gap: '5px' }}>
                    <button 
                        className="btn-small" 
                        style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '8px' }} 
                        onClick={onRemoveExercise}
                    >
                        🗑️
                    </button>
                    <button 
                        className={`btn-small toggle-btn ${isHistoryOpen ? 'active-highlight' : ''}`} 
                        style={isHistoryOpen ? { background: 'var(--primary-color)', color: '#000' } : {}} 
                        onClick={onToggleHistory}
                    >
                        🕒 Storico
                    </button>
                    <button 
                        className={`btn-small toggle-btn ${isSetupOpen ? 'active-highlight' : ''}`} 
                        style={isSetupOpen ? { background: 'var(--primary-color)', color: '#000' } : {}} 
                        onClick={onToggleSetup}
                    >
                        ⚙️ Setup
                    </button>
                </div>
            </div>

            {(exItem.minReps || exItem.maxReps) && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                    Rep min: {exItem.minReps || '-'} | Rep max: {exItem.maxReps || '-'}
                </div>
            )}
            {!(exItem.minReps || exItem.maxReps) && <div style={{ marginBottom: '15px' }}></div>}

            {isHistoryOpen && (
                <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
                    <h5 style={{ marginBottom: '8px', marginTop: 0 }}>Ultimi 2 Allenamenti:</h5>
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
                    <h5 style={{ marginBottom: '8px', marginTop: 0, color: 'var(--text-muted)' }}>Modifica Setup (Globale):</h5>
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

            <button 
                className="btn btn-small" 
                style={{ border: '1px dashed var(--glass-border)', background: 'rgba(255,255,255,0.05)', marginTop: '10px', width: '100%' }} 
                onClick={onAddSet}
            >
                + Aggiungi Serie
            </button>
            
            <textarea 
                placeholder="Note per la prossima volta (dolori, feedback)..." 
                value={exItem.sessionNote || ''}
                onChange={(e: any) => onUpdateSessionNote(e.target.value)}
                style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', color: 'var(--text-main)', borderRadius: '12px', marginTop: '12px', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box' }} 
            />
        </div>
    );
};

export default SessionExerciseCard;
