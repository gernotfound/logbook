import React from 'react';
import { Trash2 } from 'lucide-react';
import { BufferedInput } from '../../UI/BufferedInput';

interface SessionSetRowProps {
    set: any;
    sIndex: number;
    exIndex: number;
    trackingType?: string;
    isOpenMenu: boolean;
    onToggleMenu: () => void;
    onRemoveSet: (sIndex: number) => void;
    onUpdateSet: (setId: string, field: string, value: any) => void;
    onAddSpecialSet: (type: string, setId: string) => void;
    onUpdateSpecialSet: (setId: string, type: 'dropsets' | 'isometrics', idx: number, field: string, value: any) => void;
    onRemoveSpecialSet: (setId: string, type: 'dropsets' | 'isometrics', idx: number) => void;
}

const SessionSetRowInner: React.FC<SessionSetRowProps> = ({
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
            <div className="set-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '10px', border: '1px solid var(--primary-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '75px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>S{sIndex + 1}</span>
                    <button 
                        className="btn-icon" 
                        style={{ color: 'var(--danger-color)', fontSize: '0.95rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} 
                        onClick={() => onRemoveSet(sIndex)}
                        aria-label={`Rimuovi serie ${sIndex + 1}`}
                    >
                        <Trash2 size={16} aria-hidden="true" />

                    </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, position: 'relative', minWidth: 0 }}>
                    {trackingType === 'time' ? (
                        <>
                            <BufferedInput 
                                id={`kg-${s.id}`} 
                                type="number" 
                                step="0.25" 
                                placeholder="Kg (opz)" 
                                value={s.kg ?? ''} 
                                onChange={val => onUpdateSet(s.id, 'kg', val)} 
                                onFocus={e => e.target.select()}
                                style={{ margin: 0, flex: 1, minWidth: 0 }} 
                            />
                            <BufferedInput 
                                id={`time-${s.id}`} 
                                type="text" 
                                placeholder="Tempo (es. 60s)" 
                                value={s.time ?? ''} 
                                onChange={val => onUpdateSet(s.id, 'time', val)} 
                                onFocus={e => e.target.select()}
                                style={{ margin: 0, flex: 2, minWidth: 0 }} 
                            />
                        </>
                    ) : (
                        <>
                            <BufferedInput 
                                id={`kg-${s.id}`} 
                                type="number" 
                                step="0.25" 
                                placeholder="Kg" 
                                value={s.kg ?? ''} 
                                onChange={val => onUpdateSet(s.id, 'kg', val)} 
                                onFocus={e => e.target.select()}
                                style={{ margin: 0, flex: 1, minWidth: 0 }} 
                            />
                            <BufferedInput 
                                id={`reps-${s.id}`} 
                                type="number" 
                                placeholder="Reps" 
                                value={s.reps ?? ''} 
                                onChange={val => onUpdateSet(s.id, 'reps', val)} 
                                onFocus={e => e.target.select()}
                                style={{ margin: 0, flex: 1, minWidth: 0 }} 
                            />
                        </>
                    )}
                    <button 
                        className="btn-icon" 
                        style={{ 
                            background: 'var(--primary-color)', 
                            borderRadius: '50%', 
                            width: '36px', 
                            height: '36px', 
                            color: '#fff', 
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            margin: 0,
                            fontSize: '1.2rem',
                            lineHeight: 1,
                            alignSelf: 'center'
                        }} 
                        onClick={onToggleMenu}
                        aria-label="Aggiungi dropset o isometria"
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
                                <button className="btn btn-small" style={{ display: 'block', width: '100%', marginBottom: '6px' }} onClick={() => onAddSpecialSet('dropset', s.id)}>+ Dropset</button>
                                <button className="btn btn-small" style={{ display: 'block', width: '100%' }} onClick={() => onAddSpecialSet('isometry', s.id)}>+ Isometria</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {(s.dropsets || []).map((ds: any, dsIdx: number) => {
                const label = (s.dropsets && s.dropsets.length > 1) ? `↳ Dropset ${dsIdx + 1}` : '↳ Dropset';
                return (
                    <div key={ds.id || dsIdx} style={{ marginLeft: '20px', borderLeft: '2px solid var(--warning-color)', paddingLeft: '10px', display: 'flex', alignItems: 'center', marginBottom: '5px', gap: '10px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--warning-color)', minWidth: '78px', fontWeight: 600 }}>{label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>
                            <BufferedInput id={`ds-kg-${s.id}-${dsIdx}`} type="number" step="0.25" placeholder="Kg" value={ds.kg ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'dropsets', dsIdx, 'kg', val)} onFocus={e => e.target.select()} style={{ margin: 0, flex: 1, minWidth: 0 }} />
                            <BufferedInput id={`ds-reps-${s.id}-${dsIdx}`} type="number" placeholder="Reps" value={ds.reps ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'dropsets', dsIdx, 'reps', val)} onFocus={e => e.target.select()} style={{ margin: 0, flex: 1, minWidth: 0 }} />
                            <button className="btn-icon" style={{ color: 'var(--danger-color)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} onClick={() => onRemoveSpecialSet(s.id, 'dropsets', dsIdx)}>✕</button>
                        </div>
                    </div>
                );
            })}

            {(s.isometrics || []).map((iso: any, isoIdx: number) => {
                const label = (s.isometrics && s.isometrics.length > 1) ? `↳ Isometria ${isoIdx + 1}` : '↳ Isometria';
                return (
                    <div key={iso.id || isoIdx} style={{ marginLeft: '20px', borderLeft: '2px solid var(--accent-color)', paddingLeft: '10px', display: 'flex', alignItems: 'center', marginBottom: '5px', gap: '10px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--accent-color)', minWidth: '78px', fontWeight: 600 }}>{label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>
                            <BufferedInput id={`iso-kg-${s.id}-${isoIdx}`} type="number" step="0.25" placeholder="Kg" value={iso.kg ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'isometrics', isoIdx, 'kg', val)} onFocus={e => e.target.select()} style={{ margin: 0, flex: 1, minWidth: 0 }} />
                            <BufferedInput id={`iso-time-${s.id}-${isoIdx}`} type="number" placeholder="Sec" value={iso.time ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'isometrics', isoIdx, 'time', val)} onFocus={e => e.target.select()} style={{ margin: 0, flex: 1, minWidth: 0 }} />
                            <button className="btn-icon" style={{ color: 'var(--danger-color)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} onClick={() => onRemoveSpecialSet(s.id, 'isometrics', isoIdx)}>✕</button>
                        </div>
                    </div>
                );
            })}
        </React.Fragment>
    );
};

// React.memo con comparatore personalizzato:
// Rende la digitazione delle serie fluidissima. Solo la serie modificata si ri-renderizza.
export const SessionSetRow = React.memo(SessionSetRowInner, (prev, next) => {
    return (
        prev.set === next.set &&
        prev.sIndex === next.sIndex &&
        prev.exIndex === next.exIndex &&
        prev.trackingType === next.trackingType &&
        prev.isOpenMenu === next.isOpenMenu
    );
});

export default SessionSetRow;
