import React from 'react';

interface SessionSetRowProps {
    set: any;
    sIndex: number;
    exIndex: number;
    trackingType?: string;
    isOpenMenu: boolean;
    onToggleMenu: () => void;
    onRemoveSet: (sIndex: number) => void;
    onUpdateSet: (field: string, value: any) => void;
    onAddSpecialSet: (type: string) => void;
    onUpdateSpecialSet: (type: 'dropsets' | 'isometrics', idx: number, field: string, value: any) => void;
    onRemoveSpecialSet: (type: 'dropsets' | 'isometrics', idx: number) => void;
}

export const SessionSetRow: React.FC<SessionSetRowProps> = ({
    set: s,
    sIndex,
    trackingType,
    isOpenMenu,
    onToggleMenu,
    onRemoveSet,
    onUpdateSet,
    onAddSpecialSet,
    onUpdateSpecialSet,
    onRemoveSpecialSet
}) => {
    return (
        <React.Fragment>
            <div className="set-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '75px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>S{sIndex + 1}</span>
                    <button 
                        className="btn-icon" 
                        style={{ color: 'var(--danger-color)', fontSize: '0.9rem' }} 
                        onClick={() => onRemoveSet(sIndex)}
                        aria-label={`Rimuovi serie ${sIndex + 1}`}
                    >
                        🗑️
                    </button>
                </div>
                <div style={{ display: 'flex', gap: '5px', flex: 1, position: 'relative' }}>
                    {trackingType === 'time' ? (
                        <>
                            <input 
                                id={`kg-${s.id}`} 
                                type="number" 
                                step="0.25" 
                                placeholder="Kg (opz)" 
                                value={s.kg} 
                                onChange={e => onUpdateSet('kg', e.target.value)} 
                                onFocus={e => e.target.select()}
                                style={{ margin: 0, flex: 1 }} 
                            />
                            <input 
                                id={`time-${s.id}`} 
                                type="text" 
                                placeholder="Tempo (es. 60s)" 
                                value={s.time || ''} 
                                onChange={e => onUpdateSet('time', e.target.value)} 
                                onFocus={e => e.target.select()}
                                style={{ margin: 0, flex: 2 }} 
                            />
                        </>
                    ) : (
                        <>
                            <input 
                                id={`kg-${s.id}`} 
                                type="number" 
                                step="0.25" 
                                placeholder="Kg" 
                                value={s.kg} 
                                onChange={e => onUpdateSet('kg', e.target.value)} 
                                onFocus={e => e.target.select()}
                                style={{ margin: 0, flex: 1 }} 
                            />
                            <input 
                                id={`reps-${s.id}`} 
                                type="number" 
                                placeholder="Reps" 
                                value={s.reps} 
                                onChange={e => onUpdateSet('reps', e.target.value)} 
                                onFocus={e => e.target.select()}
                                style={{ margin: 0, flex: 1 }} 
                            />
                        </>
                    )}
                    <button 
                        className="btn-icon" 
                        style={{ background: 'var(--primary-color)', borderRadius: '50%', width: '36px', height: '36px', color: '#fff', flexShrink: 0 }} 
                        onClick={onToggleMenu}
                        aria-label="Aggiungi Dropset o Isometria"
                    >
                        +
                    </button>
                    
                    {isOpenMenu && (
                        <>
                            <div 
                                style={{ position: 'fixed', inset: 0, zIndex: 45 }} 
                                onClick={onToggleMenu} 
                            />
                            <div 
                                className="special-menu" 
                                style={{ 
                                    position: 'absolute', 
                                    right: 0, 
                                    top: '40px', 
                                    background: 'var(--surface-color)', 
                                    padding: '10px', 
                                    borderRadius: '8px', 
                                    zIndex: 50, 
                                    minWidth: '140px',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.8)', 
                                    border: '1px solid var(--glass-border)' 
                                }}
                            >
                                <button className="btn btn-small" style={{ display: 'block', width: '100%', marginBottom: '6px' }} onClick={() => onAddSpecialSet('dropset')}>+ Dropset</button>
                                <button className="btn btn-small" style={{ display: 'block', width: '100%' }} onClick={() => onAddSpecialSet('isometry')}>+ Isometria</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {(s.dropsets || []).map((ds: any, dsIdx: number) => (
                <div key={ds.id || dsIdx} style={{ marginLeft: '20px', borderLeft: '2px solid var(--warning-color)', paddingLeft: '10px', display: 'flex', alignItems: 'center', marginBottom: '5px', gap: '10px' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--warning-color)', minWidth: '65px' }}>↳ Dropset</div>
                    <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
                        <input id={`ds-kg-${s.id}-${dsIdx}`} type="number" step="0.25" placeholder="Kg" value={ds.kg} onChange={e => onUpdateSpecialSet('dropsets', dsIdx, 'kg', e.target.value)} onFocus={e => e.target.select()} style={{ margin: 0, flex: 1 }} />
                        <input id={`ds-reps-${s.id}-${dsIdx}`} type="number" placeholder="Reps" value={ds.reps} onChange={e => onUpdateSpecialSet('dropsets', dsIdx, 'reps', e.target.value)} onFocus={e => e.target.select()} style={{ margin: 0, flex: 1 }} />
                        <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => onRemoveSpecialSet('dropsets', dsIdx)}>✕</button>
                    </div>
                </div>
            ))}

            {(s.isometrics || []).map((iso: any, isoIdx: number) => (
                <div key={iso.id || isoIdx} style={{ marginLeft: '20px', borderLeft: '2px solid var(--accent-color)', paddingLeft: '10px', display: 'flex', alignItems: 'center', marginBottom: '5px', gap: '10px' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent-color)', minWidth: '65px' }}>↳ Isometria</div>
                    <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
                        <input id={`iso-kg-${s.id}-${isoIdx}`} type="number" step="0.25" placeholder="Kg" value={iso.kg} onChange={e => onUpdateSpecialSet('isometrics', isoIdx, 'kg', e.target.value)} onFocus={e => e.target.select()} style={{ margin: 0, flex: 1 }} />
                        <input id={`iso-time-${s.id}-${isoIdx}`} type="number" placeholder="Sec" value={iso.time} onChange={e => onUpdateSpecialSet('isometrics', isoIdx, 'time', e.target.value)} onFocus={e => e.target.select()} style={{ margin: 0, flex: 1 }} />
                        <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => onRemoveSpecialSet('isometrics', isoIdx)}>✕</button>
                    </div>
                </div>
            ))}
        </React.Fragment>
    );
};

export default SessionSetRow;
