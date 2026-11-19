import React from 'react';
import { Trash2 } from 'lucide-react';
import { SessionSetOptionsMenu } from './SessionSetOptionsMenu';
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
                    <SessionSetOptionsMenu set={s} sIndex={sIndex} exIndex={exIndex}
                        trackingType={trackingType} isOpenMenu={isOpenMenu} onToggleMenu={onToggleMenu}
                        onUpdateSet={onUpdateSet} onAddSpecialSet={onAddSpecialSet}
                        onRemoveRequested={handleRemoveSetSafely} />
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
