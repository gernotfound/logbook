import React from 'react';
import { BufferedInput } from '../../UI/BufferedInput';
import { Trash2, Plus, CornerDownRight, X } from 'lucide-react';

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
            <div className="workout-set-row set-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '75px' }}>
                    <span className="workout-set-index">S{sIndex + 1}</span>
                    <button 
                        className="btn-icon" 
                        onClick={() => onRemoveSet(sIndex)}
                        aria-label={`Rimuovi serie ${sIndex + 1}`}
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
                <div className="set-row-metrics">
                    {trackingType === 'time' ? (
                        <>
                            <BufferedInput 
                                id={`kg-${s.id}`} 
                                type="number"
                                inputMode="decimal"
                                step="0.25" 
                                placeholder="Kg (opz)" 
                                value={s.kg ?? ''} 
                                onChange={val => onUpdateSet(s.id, 'kg', val)} 
                                onFocus={e => e.target.select()}
                                className="workout-set-input"
                                style={{ minWidth: 0, flex: 1 }}
                            />
                            <BufferedInput 
                                id={`time-${s.id}`} 
                                type="text"
                                inputMode="decimal"
                                placeholder="Tempo (es. 60s)" 
                                value={s.time ?? ''} 
                                onChange={val => onUpdateSet(s.id, 'time', val)} 
                                onFocus={e => e.target.select()}
                                className="workout-set-input"
                                style={{ minWidth: 0, flex: 2 }}
                            />
                        </>
                    ) : (
                        <>
                            <BufferedInput 
                                id={`kg-${s.id}`} 
                                type="number"
                                inputMode="decimal"
                                step="0.25" 
                                placeholder="Kg" 
                                value={s.kg ?? ''} 
                                onChange={val => onUpdateSet(s.id, 'kg', val)} 
                                onFocus={e => e.target.select()}
                                className="workout-set-input"
                                style={{ minWidth: 0, flex: 1 }}
                            />
                            <BufferedInput 
                                id={`reps-${s.id}`} 
                                type="number"
                                inputMode="numeric"
                                placeholder="Reps" 
                                value={s.reps ?? ''} 
                                onChange={val => onUpdateSet(s.id, 'reps', val)} 
                                onFocus={e => e.target.select()}
                                className="workout-set-input"
                                style={{ minWidth: 0, flex: 1 }}
                            />
                        </>
                    )}
                    <button 
                        className="workout-set-special-trigger btn-icon" 
                        onClick={onToggleMenu}
                        aria-label="Aggiungi dropset o isometria"
                    >
                        <Plus size={18} />
                    </button>
                    
                    {isOpenMenu && (
                        <>
                            <div 
                                style={{ position: 'fixed', inset: 0, zIndex: 45 }} 
                                onClick={onToggleMenu} 
                            />
                            <div className="special-menu">
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
                    <div key={ds.id || dsIdx} className="special-set-row special-set-row--dropset">
                        <div className="special-set-label">
                            <CornerDownRight size={14} /> {label.replace('↳ ', '')}
                        </div>
                        <div className="set-row-metrics">
                            <BufferedInput id={`ds-kg-${s.id}-${dsIdx}`} type="number" inputMode="decimal" step="0.25" placeholder="Kg" value={ds.kg ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'dropsets', dsIdx, 'kg', val)} onFocus={e => e.target.select()} className="workout-set-input" style={{ minWidth: 0, flex: 1 }} />
                            <BufferedInput id={`ds-reps-${s.id}-${dsIdx}`} type="number" inputMode="numeric" placeholder="Reps" value={ds.reps ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'dropsets', dsIdx, 'reps', val)} onFocus={e => e.target.select()} className="workout-set-input" style={{ minWidth: 0, flex: 1 }} />
                            <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => onRemoveSpecialSet(s.id, 'dropsets', dsIdx)}>
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                );
            })}

            {(s.isometrics || []).map((iso: any, isoIdx: number) => {
                const label = (s.isometrics && s.isometrics.length > 1) ? `↳ Isometria ${isoIdx + 1}` : '↳ Isometria';
                return (
                    <div key={iso.id || isoIdx} className="special-set-row special-set-row--isometric">
                        <div className="special-set-label">
                            <CornerDownRight size={14} /> {label.replace('↳ ', '')}
                        </div>
                        <div className="set-row-metrics">
                            <BufferedInput id={`iso-kg-${s.id}-${isoIdx}`} type="number" inputMode="decimal" step="0.25" placeholder="Kg" value={iso.kg ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'isometrics', isoIdx, 'kg', val)} onFocus={e => e.target.select()} className="workout-set-input" style={{ minWidth: 0, flex: 1 }} />
                            <BufferedInput id={`iso-time-${s.id}-${isoIdx}`} type="number" inputMode="decimal" placeholder="Sec" value={iso.time ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'isometrics', isoIdx, 'time', val)} onFocus={e => e.target.select()} className="workout-set-input" style={{ minWidth: 0, flex: 1 }} />
                            <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => onRemoveSpecialSet(s.id, 'isometrics', isoIdx)}>
                                <X size={16} />
                            </button>
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
