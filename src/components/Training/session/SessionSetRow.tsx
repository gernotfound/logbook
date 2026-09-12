import React from 'react';
import { Trash2, X } from 'lucide-react';
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
    const isTime = trackingType === 'time';
    const fieldCompatStyle = { minWidth: 0, flex: 1 } as React.CSSProperties;

    return (
        <>
            <div
                className="set-row workout-set-row"
                style={{ '--workout-focus-color': 'var(--primary-color)' } as React.CSSProperties}
            >
                <div className="workout-set-index">
                    <span className="workout-set-index__label">S{sIndex + 1}</span>
                    <button
                        type="button"
                        className="workout-set-delete"
                        onClick={() => onRemoveSet(sIndex)}
                        aria-label={`Rimuovi serie ${sIndex + 1}`}
                        title={`Rimuovi serie ${sIndex + 1}`}
                    >
                        <Trash2 size={15} aria-hidden="true" />
                    </button>
                </div>

                <div className="workout-set-field" style={fieldCompatStyle}>
                    <BufferedInput
                        id={`kg-${s.id}`}
                        type="number"
                        step="0.25"
                        inputMode="decimal"
                        placeholder={isTime ? 'Kg (opz)' : 'Kg'}
                        value={s.kg ?? ''}
                        onChange={val => onUpdateSet(s.id, 'kg', val)}
                        onFocus={e => e.target.select()}
                        style={fieldCompatStyle}
                    />
                </div>

                <div className="workout-set-field" style={fieldCompatStyle}>
                    {isTime ? (
                        <BufferedInput
                            id={`time-${s.id}`}
                            type="text"
                            placeholder="Tempo"
                            value={s.time ?? ''}
                            onChange={val => onUpdateSet(s.id, 'time', val)}
                            onFocus={e => e.target.select()}
                            style={fieldCompatStyle}
                        />
                    ) : (
                        <BufferedInput
                            id={`reps-${s.id}`}
                            type="number"
                            inputMode="numeric"
                            placeholder="Reps"
                            value={s.reps ?? ''}
                            onChange={val => onUpdateSet(s.id, 'reps', val)}
                            onFocus={e => e.target.select()}
                            style={fieldCompatStyle}
                        />
                    )}
                </div>

                <div className="workout-special-wrap" style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                        type="button"
                        className="workout-set-special"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: '50%' }}
                        onClick={onToggleMenu}
                        aria-label="Aggiungi dropset o isometria"
                        title="Aggiungi serie speciale"
                    >
                        +
                    </button>

                    {isOpenMenu && (
                        <>
                            <div
                                className="workout-menu-backdrop"
                                onClick={onToggleMenu}
                                aria-hidden="true"
                            />
                            <div className="special-menu" role="menu" aria-label="Aggiungi serie speciale">
                                <button
                                    type="button"
                                    className="btn btn-small btn-secondary"
                                    onClick={() => onAddSpecialSet('dropset', s.id)}
                                    role="menuitem"
                                >
                                    + Dropset
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-small btn-secondary"
                                    onClick={() => onAddSpecialSet('isometry', s.id)}
                                    role="menuitem"
                                >
                                    + Isometria
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {(s.dropsets || []).map((ds: any, dsIdx: number) => {
                const label = (s.dropsets && s.dropsets.length > 1) ? `Dropset ${dsIdx + 1}` : 'Dropset';
                return (
                    <div key={ds.id || dsIdx} className="workout-special-row" style={{ alignItems: 'center' }}>
                        <div className="workout-special-row__label">↳ {label}</div>
                        <BufferedInput
                            id={`ds-kg-${s.id}-${dsIdx}`}
                            type="number"
                            step="0.25"
                            inputMode="decimal"
                            placeholder="Kg"
                            value={ds.kg ?? ''}
                            onChange={val => onUpdateSpecialSet(s.id, 'dropsets', dsIdx, 'kg', val)}
                            onFocus={e => e.target.select()}
                        />
                        <BufferedInput
                            id={`ds-reps-${s.id}-${dsIdx}`}
                            type="number"
                            inputMode="numeric"
                            placeholder="Reps"
                            value={ds.reps ?? ''}
                            onChange={val => onUpdateSpecialSet(s.id, 'dropsets', dsIdx, 'reps', val)}
                            onFocus={e => e.target.select()}
                        />
                        <button
                            type="button"
                            className="btn-icon"
                            onClick={() => onRemoveSpecialSet(s.id, 'dropsets', dsIdx)}
                            aria-label={`Rimuovi ${label.toLowerCase()}`}
                        >
                            <X size={17} aria-hidden="true" />
                        </button>
                    </div>
                );
            })}

            {(s.isometrics || []).map((iso: any, isoIdx: number) => {
                const label = (s.isometrics && s.isometrics.length > 1) ? `Isometria ${isoIdx + 1}` : 'Isometria';
                return (
                    <div key={iso.id || isoIdx} className="workout-special-row workout-special-row--iso" style={{ alignItems: 'center' }}>
                        <div className="workout-special-row__label">↳ {label}</div>
                        <BufferedInput
                            id={`iso-kg-${s.id}-${isoIdx}`}
                            type="number"
                            step="0.25"
                            inputMode="decimal"
                            placeholder="Kg"
                            value={iso.kg ?? ''}
                            onChange={val => onUpdateSpecialSet(s.id, 'isometrics', isoIdx, 'kg', val)}
                            onFocus={e => e.target.select()}
                        />
                        <BufferedInput
                            id={`iso-time-${s.id}-${isoIdx}`}
                            type="number"
                            inputMode="numeric"
                            placeholder="Sec"
                            value={iso.time ?? ''}
                            onChange={val => onUpdateSpecialSet(s.id, 'isometrics', isoIdx, 'time', val)}
                            onFocus={e => e.target.select()}
                        />
                        <button
                            type="button"
                            className="btn-icon"
                            onClick={() => onRemoveSpecialSet(s.id, 'isometrics', isoIdx)}
                            aria-label={`Rimuovi ${label.toLowerCase()}`}
                        >
                            <X size={17} aria-hidden="true" />
                        </button>
                    </div>
                );
            })}
        </>
    );
};

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
