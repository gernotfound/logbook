import { Activity } from 'lucide-react';
import type { RoutineExerciseItemProps } from './routineExerciseEditorTypes';

interface RoutineExerciseTargetsProps extends Pick<RoutineExerciseItemProps, 'exercise' | 'index' | 'onUpdateSetsCount' | 'onUpdateReps'> {
    trackingType?: string;
    fieldId: string;
}

export function RoutineExerciseTargets({ exercise, index, trackingType, fieldId, onUpdateSetsCount, onUpdateReps }: RoutineExerciseTargetsProps) {
    const isCardio = trackingType === 'cardio';
    const setsId = `${fieldId}-sets`;
    const minRepsId = `${fieldId}-min-reps`;
    const maxRepsId = `${fieldId}-max-reps`;

    return (
        <>
            {isCardio ? (
                /* Esercizio cardio: nessun campo Serie/Reps/Tecnica */
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'var(--primary-soft)',
                    border: '1px solid var(--primary-color)',
                    marginTop: '4px'
                }}>
                    <Activity size={18} aria-hidden="true" style={{ color: 'var(--primary-color)' }} />
                    <span style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                        Esercizio cardio — le metriche verranno registrate durante la sessione.
                    </span>
                </div>
            ) : (
                <>
                    {/* Riga 1: Serie */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label htmlFor={setsId} style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                            Serie:
                        </label>
                        <input
                            id={setsId}
                            type="text" inputMode="numeric" pattern="[0-9]*"
                            placeholder="3"
                            value={exercise.setsCount !== undefined && exercise.setsCount !== null ? exercise.setsCount : ''}
                            onChange={e => {
                                const value = e.target.value;
                                if (/^[0-9]*$/.test(value)) onUpdateSetsCount(index, value);
                            }}
                            onFocus={e => e.target.select()}
                            style={{
                                width: '90px',
                                height: '44px',
                                minHeight: '44px',
                                margin: 0,
                                padding: '8px 12px',
                                fontSize: '16px',
                                textAlign: 'center',
                                borderRadius: '8px',
                                background: 'var(--surface-light)',
                                border: '1px solid var(--glass-border)',
                                color: 'var(--text-main)',
                                boxSizing: 'border-box'
                            }}
                            onClick={e => e.stopPropagation()}
                        />
                    </div>

                    {/* Riga 2: Rep min e Rep max */}
                    {trackingType !== 'time' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <span id={`${fieldId}-reps-label`} style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                                Ripetizioni:
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                <input
                                    id={minRepsId}
                                    type="number"
                                    aria-label="Ripetizioni minime"
                                    aria-describedby={`${fieldId}-reps-label`}
                                    placeholder="Min (es. 8)"
                                    value={exercise.minReps || ''}
                                    onChange={e => onUpdateReps(index, 'minReps', e.target.value)}
                                    onFocus={e => e.target.select()}
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        height: '44px',
                                        minHeight: '44px',
                                        margin: 0,
                                        padding: '8px 8px',
                                        fontSize: '16px',
                                        textAlign: 'center',
                                        borderRadius: '8px',
                                        background: 'var(--surface-light)',
                                        border: '1px solid var(--glass-border)',
                                        color: 'var(--text-main)',
                                        boxSizing: 'border-box'
                                    }}
                                />
                                <span style={{ color: 'var(--text-muted)', fontWeight: 'bold', fontSize: 'var(--font-size-control)' }}>-</span>
                                <input
                                    id={maxRepsId}
                                    type="number"
                                    aria-label="Ripetizioni massime"
                                    aria-describedby={`${fieldId}-reps-label`}
                                    placeholder="Max (es. 12)"
                                    value={exercise.maxReps || ''}
                                    onChange={e => onUpdateReps(index, 'maxReps', e.target.value)}
                                    onFocus={e => e.target.select()}
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        height: '44px',
                                        minHeight: '44px',
                                        margin: 0,
                                        padding: '8px 8px',
                                        fontSize: '16px',
                                        textAlign: 'center',
                                        borderRadius: '8px',
                                        background: 'var(--surface-light)',
                                        border: '1px solid var(--glass-border)',
                                        color: 'var(--text-main)',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                                Tipo:
                            </span>
                            <span className="text-muted text-xs italic">Tracciamento a tempo</span>
                        </div>
                    )}



                </>
            )}
        </>
    );
}
