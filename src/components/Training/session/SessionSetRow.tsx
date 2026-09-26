import React from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { BufferedInput } from '../../UI/BufferedInput';
import { continuationTechniqueLabel, getContinuationTechnique } from '../../../lib/advancedSets';

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
    onUpdateSpecialSet: (setId: string, type: 'dropsets' | 'isometrics' | 'segments', idx: number, field: string, value: any) => void;
    onRemoveSpecialSet: (setId: string, type: 'dropsets' | 'isometrics' | 'segments', idx: number) => void;
    onUpdateSetTarget: (setId: string, reps: number | undefined) => void;
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
    onRemoveSpecialSet,
    onUpdateSetTarget
}) => {
    const [isRirOpen, setIsRirOpen] = React.useState(false);
    const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
    const rirTriggerRef = React.useRef<HTMLButtonElement>(null);
    const firstRirOptionRef = React.useRef<HTMLButtonElement>(null);
    const hasRir = Number.isInteger(s.rir) && s.rir >= 0 && s.rir <= 10;

    React.useEffect(() => {
        if (isRirOpen) firstRirOptionRef.current?.focus();
    }, [isRirOpen]);

    const closeRirMenu = (restoreFocus = false) => {
        setIsRirOpen(false);
        if (restoreFocus) rirTriggerRef.current?.focus();
    };

    const selectRir = (rir: number | undefined) => {
        onUpdateSet(s.id, 'rir', rir);
        setIsRirOpen(false);
        onToggleMenu();
        queueMicrotask(() => menuTriggerRef.current?.focus());
    };

    const toggleSetMenu = () => {
        setIsRirOpen(false);
        onToggleMenu();
    };

    const advancedSegments = Array.isArray(s.segments) ? s.segments : [];
    const hasRootTargetTechnique = Boolean(s.target)
        && (s.technique === 'rep_match' || s.technique === 'diminishing');

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
                        ref={menuTriggerRef}
                        type="button"
                        className="btn-icon"
                        style={{
                            width: '44px',
                            minWidth: '44px',
                            height: '44px',
                            minHeight: '44px',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '12px',
                            background: isOpenMenu ? 'var(--surface-light)' : 'transparent',
                            color: isOpenMenu ? 'var(--primary-color)' : 'var(--text-muted)',
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            margin: 0,
                            lineHeight: 1,
                            alignSelf: 'center'
                        }}
                        onClick={toggleSetMenu}
                        aria-label={`Opzioni serie ${sIndex + 1}`}
                        aria-expanded={isOpenMenu}
                        aria-haspopup="menu"
                    >
                        <MoreHorizontal size={22} aria-hidden="true" />
                    </button>

                    {isOpenMenu && (
                        <>
                            <div
                                style={{ position: 'fixed', inset: 0, zIndex: 45 }}
                                onClick={toggleSetMenu}
                            />
                            <div
                                className="special-menu"
                                style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: '48px',
                                    background: 'var(--surface-color)',
                                    padding: '10px',
                                    borderRadius: '10px',
                                    zIndex: 50,
                                    width: 'min(220px, calc(100vw - 32px))',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
                                    border: '1px solid var(--glass-border)'
                                }}
                            >
                                {trackingType !== 'time' && (
                                    <>
                                        <button
                                            ref={rirTriggerRef}
                                            type="button"
                                            className="btn btn-small"
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                width: '100%',
                                                minHeight: '44px',
                                                marginBottom: '6px'
                                            }}
                                            onClick={() => setIsRirOpen(open => !open)}
                                            aria-label={`Imposta RIR serie ${sIndex + 1}: ${hasRir ? s.rir : 'non registrato'}`}
                                            aria-expanded={isRirOpen}
                                            aria-haspopup="menu"
                                        >
                                            <span>RIR</span>
                                            <strong>{hasRir ? s.rir : '—'}</strong>
                                        </button>
                                        {isRirOpen && (
                                            <div
                                                role="menu"
                                                aria-label={`Seleziona RIR serie ${sIndex + 1}`}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Escape') {
                                                        event.preventDefault();
                                                        closeRirMenu(true);
                                                    }
                                                }}
                                                style={{
                                                    width: '100%',
                                                    marginBottom: '8px',
                                                    padding: '8px',
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(4, minmax(44px, 1fr))',
                                                    gap: '6px',
                                                    background: 'var(--surface-light)',
                                                    border: '1px solid var(--glass-border)',
                                                    borderRadius: '10px',
                                                    boxSizing: 'border-box'
                                                }}
                                            >
                                                {Array.from({ length: 11 }, (_, rir) => (
                                                    <button
                                                        key={rir}
                                                        ref={rir === 0 ? firstRirOptionRef : undefined}
                                                        type="button"
                                                        role="menuitemradio"
                                                        aria-checked={s.rir === rir}
                                                        className="btn-icon"
                                                        style={{
                                                            minWidth: '44px',
                                                            minHeight: '44px',
                                                            padding: 0,
                                                            background: s.rir === rir ? 'var(--primary-color)' : 'var(--surface-color)',
                                                            color: s.rir === rir ? 'var(--on-primary)' : 'var(--text-main)',
                                                            fontWeight: 700
                                                        }}
                                                        onClick={() => selectRir(rir)}
                                                    >
                                                        {rir}
                                                    </button>
                                                ))}
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="btn btn-small"
                                                    style={{ gridColumn: '1 / -1', minHeight: '44px', margin: 0 }}
                                                    onClick={() => selectRir(undefined)}
                                                >
                                                    Non registrato
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                                {[
                                    ['dropset', 'Dropset'],
                                    ['rest_pause', 'Rest-pause'],
                                    ['cluster', 'Cluster'],
                                    ['rep_match', 'Rep-match'],
                                    ['diminishing', 'Diminishing set'],
                                ].map(([value, label]) => (
                                    <button key={value} className="btn btn-small" style={{ display: 'block', width: '100%', marginBottom: '6px' }} onClick={() => onAddSpecialSet(value, s.id)}>+ {label}</button>
                                ))}
                                <button className="btn btn-small" style={{ display: 'block', width: '100%' }} onClick={() => onAddSpecialSet('isometry', s.id)}>+ Isometria</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {(advancedSegments.length > 0 || (s.technique && s.technique !== 'straight')) && (
                <div style={{ marginLeft: '20px', borderLeft: '2px solid var(--primary-color)', padding: '8px 0 8px 10px', marginBottom: '6px' }}>
                    {hasRootTargetTechnique && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target reps</span>
                            <BufferedInput id={`target-${s.id}`} type="number" placeholder="—" value={s.target?.reps ?? ''} onChange={val => {
                                const parsed = Number(val);
                                onUpdateSetTarget(s.id, val === '' || !Number.isFinite(parsed) ? undefined : Math.max(0, Math.trunc(parsed)));
                            }} style={{ margin: 0, width: '82px' }} />
                        </div>
                    )}
                    {advancedSegments.length === 0 && s.technique && s.technique !== 'straight' && (
                        <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                            {continuationTechniqueLabel(s.technique)}
                        </div>
                    )}
                    {advancedSegments.map((segment: any, segmentIndex: number) => {
                        const technique = getContinuationTechnique(s, segment);
                        const baseLabel = technique ? continuationTechniqueLabel(technique) : 'Tecnica';
                        const occurrence = technique
                            ? advancedSegments.slice(0, segmentIndex + 1).filter((candidate: any) => getContinuationTechnique(s, candidate) === technique).length
                            : 1;
                        const label = technique ? `${baseLabel} ${occurrence}` : baseLabel;
                        const isIsometry = technique === 'isometry';
                        const isDropset = technique === 'dropset';
                        const gridTemplateColumns = isIsometry || isDropset ? '1fr 1fr 44px' : '76px 1fr 1fr 44px';

                        return (
                            <div key={segment.id || segmentIndex} style={{ marginBottom: '8px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 700, marginBottom: '4px' }}>↳ {label}</div>
                                <div style={{ display: 'grid', gridTemplateColumns, gap: '5px', alignItems: 'center' }}>
                                    {!isDropset && !isIsometry && (
                                        <BufferedInput id={`seg-rest-${s.id}-${segmentIndex}`} type="number" placeholder="Rec s" value={segment.restBeforeSeconds ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'segments', segmentIndex, 'restBeforeSeconds', val === '' ? undefined : Math.max(0, Math.trunc(Number(val) || 0)))} style={{ margin: 0, minWidth: 0 }} />
                                    )}
                                    <BufferedInput id={`seg-kg-${s.id}-${segmentIndex}`} type="number" step="0.25" placeholder="Kg" value={segment.kg ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'segments', segmentIndex, 'kg', val)} style={{ margin: 0, minWidth: 0 }} />
                                    {isIsometry ? (
                                        <BufferedInput id={`seg-time-${s.id}-${segmentIndex}`} type="number" placeholder="Sec" value={segment.time ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'segments', segmentIndex, 'time', val)} style={{ margin: 0, minWidth: 0 }} />
                                    ) : (
                                        <BufferedInput id={`seg-reps-${s.id}-${segmentIndex}`} type="number" placeholder="Reps" value={segment.reps ?? ''} onChange={val => onUpdateSpecialSet(s.id, 'segments', segmentIndex, 'reps', val)} style={{ margin: 0, minWidth: 0 }} />
                                    )}
                                    <button className="btn-icon" aria-label={`Rimuovi ${label}`} style={{ minWidth: '44px', minHeight: '44px', color: 'var(--danger-color)' }} onClick={() => onRemoveSpecialSet(s.id, 'segments', segmentIndex)}>✕</button>
                                </div>
                                {(technique === 'rep_match' || technique === 'diminishing') && Boolean(segment.technique) && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target reps</span>
                                        <BufferedInput
                                            id={`seg-target-${s.id}-${segmentIndex}`}
                                            type="number"
                                            placeholder="—"
                                            value={segment.target?.reps ?? ''}
                                            onChange={val => {
                                                const parsed = Number(val);
                                                onUpdateSpecialSet(
                                                    s.id,
                                                    'segments',
                                                    segmentIndex,
                                                    'target',
                                                    val === '' || !Number.isFinite(parsed)
                                                        ? undefined
                                                        : { type: 'reps', reps: Math.max(0, Math.trunc(parsed)) },
                                                );
                                            }}
                                            style={{ margin: 0, width: '82px' }}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

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
