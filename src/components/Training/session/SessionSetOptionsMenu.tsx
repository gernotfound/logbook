import React from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { SessionSetRirPicker } from './SessionSetRirPicker';
import type { SessionSetRowProps } from './SessionSetRow';

interface SessionSetOptionsMenuProps extends Pick<SessionSetRowProps,
    'set' | 'sIndex' | 'exIndex' | 'trackingType' | 'isOpenMenu' | 'onToggleMenu' | 'onUpdateSet' | 'onAddSpecialSet'> {
    onRemoveRequested: () => void | Promise<void>;
}

export function SessionSetOptionsMenu({ set: s, sIndex, exIndex, trackingType, isOpenMenu,
    onToggleMenu, onUpdateSet, onAddSpecialSet, onRemoveRequested }: SessionSetOptionsMenuProps) {
    const [isRirOpen, setIsRirOpen] = React.useState(false);
    const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
    const rirTriggerRef = React.useRef<HTMLButtonElement>(null);
    const firstRirOptionRef = React.useRef<HTMLButtonElement>(null);
    const hasRir = typeof s.rir === 'number' && Number.isInteger(s.rir) && s.rir >= 0 && s.rir <= 10;

    React.useEffect(() => {
        if (isRirOpen) firstRirOptionRef.current?.focus();
    }, [isRirOpen]);

    const closeRirMenu = (restoreFocus = false) => {
        setIsRirOpen(false);
        if (restoreFocus) rirTriggerRef.current?.focus();
    };

    const selectRir = (rir: number | undefined) => {
        onUpdateSet(exIndex, s.id, 'rir', rir);
        setIsRirOpen(false);
        onToggleMenu(s.id);
        queueMicrotask(() => menuTriggerRef.current?.focus());
    };

    const toggleSetMenu = () => {
        setIsRirOpen(false);
        onToggleMenu(s.id);
    };

    return (
        <>
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
                                    <SessionSetRirPicker set={s} sIndex={sIndex} firstOptionRef={firstRirOptionRef}
                                        onEscape={() => closeRirMenu(true)} onSelect={selectRir} />
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
                            <button key={value} className="btn btn-small" style={{ display: 'block', width: '100%', marginBottom: '6px' }} onClick={() => onAddSpecialSet(exIndex, value, s.id)}>+ {label}</button>
                        ))}
                        <button className="btn btn-small" style={{ display: 'block', width: '100%', marginBottom: '6px' }} onClick={() => onAddSpecialSet(exIndex, 'isometry', s.id)}>+ Isometria</button>
                        <button
                            type="button"
                            className="btn btn-small session-set-remove-action"
                            style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}
                            onClick={() => void onRemoveRequested()}
                        >
                            <span>Rimuovi questa serie</span>
                            <Trash2 size={18} aria-hidden="true" />
                        </button>
                    </div>
                </>
            )}
        </>
    );
}
