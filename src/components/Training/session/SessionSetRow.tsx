import React from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { SessionSetPrimaryFields } from './SessionSetPrimaryFields';
import { SessionSetAdvancedSegments } from './SessionSetAdvancedSegments';
import { BufferedWorkoutScope } from '../../UI/bufferedWorkoutScope';
import { useDialogStore } from '../../../store/useDialogStore';
import { sessionSetHasMeaningfulData } from '../../../lib/workoutSetData';
import { captureSession, isCurrentSession } from '../../../lib/sync/session';
import type { SessionExerciseSet } from '../../../types';

export interface SessionSetRowProps {
    set: SessionExerciseSet;
    sIndex: number;
    exIndex: number;
    exerciseInstanceId?: string;
    trackingType?: string;
    isOpenMenu: boolean;
    onToggleMenu: (setId: string) => void;
    onRemoveSet: (exIndex: number, sIndex: number, setId: string, exerciseId?: string, workoutId?: string | null, expectedSet?: SessionExerciseSet) => void;
    onUpdateSet: (exIndex: number, setId: string, field: string, value: unknown) => void;
    onAddSpecialSet: (exIndex: number, type: string, setId: string) => void;
    onUpdateSpecialSet: (exIndex: number, setId: string, type: 'segments', segmentId: string, field: string, value: unknown) => void;
    onRemoveSpecialSet: (exIndex: number, setId: string, type: 'segments', segmentId: string) => void;
    onUpdateSetTarget: (exIndex: number, setId: string, reps: number | undefined) => void;
}

const SessionSetRowInner: React.FC<SessionSetRowProps> = ({
    set: s,
    sIndex,
    exIndex,
    exerciseInstanceId,
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
    // Exercise instance + set + segment identity determines a recovery field.
    // Keep isolated component fixtures without an instance ID compatible.
    const recoveryPrefix = exerciseInstanceId ? `${exerciseInstanceId}-` : '';
    const workoutId = React.useContext(BufferedWorkoutScope);
    const [isRirOpen, setIsRirOpen] = React.useState(false);
    const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
    const rirTriggerRef = React.useRef<HTMLButtonElement>(null);
    const firstRirOptionRef = React.useRef<HTMLButtonElement>(null);
    const hasRir = typeof s.rir === 'number' && Number.isInteger(s.rir) && s.rir >= 0 && s.rir <= 10;

    const handleRemoveSetSafely = async () => {
        if (sessionSetHasMeaningfulData(s)) {
            const session = captureSession();
            const confirmed = await useDialogStore.getState().showConfirm(
                'La serie contiene dei dati. Vuoi davvero rimuoverla?'
            );
            if (!confirmed || !isCurrentSession(session)) return;
        }
        onRemoveSet(exIndex, sIndex, s.id, exerciseInstanceId, workoutId, s);
        if (isOpenMenu) onToggleMenu(s.id);
    };

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

    const advancedSegments = Array.isArray(s.segments) ? s.segments : [];

    return (
        <React.Fragment>
            <div className="set-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '10px', border: '1px solid var(--primary-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '75px' }}>
                    <span style={{ fontSize: 'var(--font-size-meta)', fontWeight: 600, color: 'var(--text-main)' }}>S{sIndex + 1}</span>
                    <button
                        className="btn-icon"
                        style={{ color: 'var(--danger-color)', fontSize: 'var(--font-size-body)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                        onClick={() => void handleRemoveSetSafely()}
                        aria-label={`Rimuovi serie ${sIndex + 1}`}
                    >
                        <Trash2 size={16} aria-hidden="true" />

                    </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, position: 'relative', minWidth: 0 }}>
                    <SessionSetPrimaryFields set={s} exIndex={exIndex} trackingType={trackingType}
                        onUpdateSet={onUpdateSet} recoveryPrefix={recoveryPrefix} />
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
                                    <button key={value} className="btn btn-small" style={{ display: 'block', width: '100%', marginBottom: '6px' }} onClick={() => onAddSpecialSet(exIndex, value, s.id)}>+ {label}</button>
                                ))}
                                <button className="btn btn-small" style={{ display: 'block', width: '100%', marginBottom: '6px' }} onClick={() => onAddSpecialSet(exIndex, 'isometry', s.id)}>+ Isometria</button>
                                <button
                                    type="button"
                                    className="btn btn-small session-set-remove-action"
                                    style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}
                                    onClick={() => void handleRemoveSetSafely()}
                                >
                                    <span>Rimuovi questa serie</span>
                                    <Trash2 size={18} aria-hidden="true" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {(advancedSegments.length > 0 || (s.technique && s.technique !== 'straight')) && (
                <SessionSetAdvancedSegments set={s} exIndex={exIndex} recoveryPrefix={recoveryPrefix}
                    advancedSegments={advancedSegments} onUpdateSpecialSet={onUpdateSpecialSet}
                    onRemoveSpecialSet={onRemoveSpecialSet} onUpdateSetTarget={onUpdateSetTarget} />
            )}

        </React.Fragment>
    );
};

// The parent passes stable action references so memo can compare callbacks, too.
// A replaced handler must never remain stale on an otherwise unchanged set.
export const SessionSetRow = React.memo(SessionSetRowInner);

export default SessionSetRow;
