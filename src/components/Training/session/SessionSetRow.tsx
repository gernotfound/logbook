import React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
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
            <div className="set-row workout-set-row">
                <div className="workout-set-row__meta">
                    <span className="workout-set-row__index">S{sIndex + 1}</span>
                    <button
                        type="button"
                        className="btn-icon workout-set-row__remove"
                        onClick={() => onRemoveSet(sIndex)}
                        aria-label={`Rimuovi serie ${sIndex + 1}`}
                    >
                        <Trash2 size={17} aria-hidden="true" />
                    </button>
                </div>

                <div className="workout-set-row__fields">
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
                                className="workout-set-input"
                            />
                            <BufferedInput
                                id={`time-${s.id}`}
                                type="text"
                                placeholder="Tempo (es. 60s)"
                                value={s.time ?? ''}
                                onChange={val => onUpdateSet(s.id, 'time', val)}
                                onFocus={e => e.target.select()}
                                className="workout-set-input workout-set-input--wide"
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
                                className="workout-set-input"
                            />
                            <BufferedInput
                                id={`reps-${s.id}`}
                                type="number"
                                placeholder="Reps"
                                value={s.reps ?? ''}
                                onChange={val => onUpdateSet(s.id, 'reps', val)}
                                onFocus={e => e.target.select()}
                                className="workout-set-input"
                            />
                        </>
                    )}

                    <button
                        type="button"
                        className="btn-icon workout-set-row__special-trigger"
                        onClick={onToggleMenu}
                        aria-expanded={isOpenMenu}
                        aria-label="Aggiungi dropset o isometria"
                    >
                        <Plus size={19} aria-hidden="true" />
                    </button>

                    {isOpenMenu && (
                        <>
                            <button
                                type="button"
                                className="workout-set-menu-backdrop"
                                onClick={onToggleMenu}
                                aria-label="Chiudi menu serie speciale"
                            />
                            <div className="special-menu workout-set-menu" role="menu">
                                <button className="btn btn-small" type="button" onClick={() => onAddSpecialSet('dropset', s.id)}>Dropset</button>
                                <button className="btn btn-small" type="button" onClick={() => onAddSpecialSet('isometry', s.id)}>Isometria</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {(s.dropsets || []).map((ds: any, dsIdx: number) => {
                const label = (s.dropsets && s.dropsets.length > 1) ? `Dropset ${dsIdx + 1}` : 'Dropset';
                return (
                    <div key={ds.id || dsIdx} className="special-set-row special-set-row--drop">
                        <div className="special-set-row__label">{label}</div>
                        <div className="special-set-row__fields">
                            <BufferedInput id={`ds-kg-${s.id}-${dsIdx}`} type="number" step="0.25" placeholder="Kg" value={ds.kg ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'dropsets', dsIdx, 'kg', val)} onFocus={e => e.target.select()} className="workout-set-input" />
                            <BufferedInput id={`ds-reps-${s.id}-${dsIdx}`} type="number" placeholder="Reps" value={ds.reps ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'dropsets', dsIdx, 'reps', val)} onFocus={e => e.target.select()} className="workout-set-input" />
                            <button type="button" className="btn-icon special-set-row__remove" onClick={() => onRemoveSpecialSet(s.id, 'dropsets', dsIdx)} aria-label={`Rimuovi ${label}`}>
                                <X size={17} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                );
            })}

            {(s.isometrics || []).map((iso: any, isoIdx: number) => {
                const label = (s.isometrics && s.isometrics.length > 1) ? `Isometria ${isoIdx + 1}` : 'Isometria';
                return (
                    <div key={iso.id || isoIdx} className="special-set-row special-set-row--iso">
                        <div className="special-set-row__label">{label}</div>
                        <div className="special-set-row__fields">
                            <BufferedInput id={`iso-kg-${s.id}-${isoIdx}`} type="number" step="0.25" placeholder="Kg" value={iso.kg ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'isometrics', isoIdx, 'kg', val)} onFocus={e => e.target.select()} className="workout-set-input" />
                            <BufferedInput id={`iso-time-${s.id}-${isoIdx}`} type="number" placeholder="Sec" value={iso.time ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'isometrics', isoIdx, 'time', val)} onFocus={e => e.target.select()} className="workout-set-input" />
                            <button type="button" className="btn-icon special-set-row__remove" onClick={() => onRemoveSpecialSet(s.id, 'isometrics', isoIdx)} aria-label={`Rimuovi ${label}`}>
                                <X size={17} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                );
            })}
        </React.Fragment>
    );
};

// React.memo con comparatore personalizzato: durante la digitazione si aggiorna solo la serie modificata.
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
