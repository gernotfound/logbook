import { BufferedInput } from '../../UI/BufferedInput';
import { continuationTechniqueLabel, getContinuationTechnique } from '../../../lib/advancedSets';
import type { SessionExerciseSet } from '../../../types';
import type { SessionSetRowProps } from './sessionSetRowTypes';

interface SessionSetAdvancedSegmentsProps extends Pick<SessionSetRowProps, 'set' | 'exIndex' | 'onUpdateSpecialSet' | 'onRemoveSpecialSet' | 'onUpdateSetTarget'> {
    recoveryPrefix: string;
    advancedSegments: NonNullable<SessionExerciseSet['segments']>;
}

export function SessionSetAdvancedSegments({ set: s, exIndex, recoveryPrefix, advancedSegments, onUpdateSpecialSet, onRemoveSpecialSet, onUpdateSetTarget }: SessionSetAdvancedSegmentsProps) {
    const hasRootTargetTechnique = Boolean(s.target)
        && (s.technique === 'rep_match' || s.technique === 'diminishing');

    return (
        <div style={{ marginLeft: '20px', borderLeft: '2px solid var(--primary-color)', padding: '8px 0 8px 10px', marginBottom: '6px' }}>
            {hasRootTargetTechnique && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <span style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>Target reps</span>
                    <BufferedInput id={`${recoveryPrefix}target-${s.id}`} type="number" placeholder="—" value={s.target?.reps ?? ''} onChange={val => {
                        const parsed = Number(val);
                        onUpdateSetTarget(exIndex, s.id, val === '' || !Number.isFinite(parsed) ? undefined : Math.max(0, Math.trunc(parsed)));
                    }} style={{ margin: 0, width: '82px' }} />
                </div>
            )}
            {advancedSegments.length === 0 && s.technique && s.technique !== 'straight' && (
                <div style={{ fontSize: 'var(--font-size-meta)', fontWeight: 700 }}>
                    {continuationTechniqueLabel(s.technique)}
                </div>
            )}
            {advancedSegments.map((segment, segmentIndex: number) => {
                const technique = getContinuationTechnique(s, segment);
                const baseLabel = technique ? continuationTechniqueLabel(technique) : 'Tecnica';
                const occurrence = technique
                    ? advancedSegments.slice(0, segmentIndex + 1).filter((candidate) => getContinuationTechnique(s, candidate) === technique).length
                    : 1;
                const label = technique ? `${baseLabel} ${occurrence}` : baseLabel;
                const isIsometry = technique === 'isometry';
                const isDropset = technique === 'dropset';
                const gridVariant = isIsometry || isDropset ? 'compact' : 'with-rest';

                return (
                    <div key={segment.id || segmentIndex} style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--primary-color)', fontWeight: 700, marginBottom: '4px' }}>↳ {label}</div>
                        <div className={`session-advanced-segment-grid ${gridVariant}`}>
                            {!isDropset && !isIsometry && (
                                <BufferedInput id={`${recoveryPrefix}seg-rest-${s.id}-${segment.id}`} type="number" placeholder="Rec s" value={segment.restBeforeSeconds ?? ''} onChange={val => onUpdateSpecialSet(exIndex, s.id, 'segments', segment.id, 'restBeforeSeconds', val === '' ? undefined : Math.max(0, Math.trunc(Number(val) || 0)))} style={{ margin: 0, minWidth: 0 }} />
                            )}
                            <BufferedInput id={`${recoveryPrefix}seg-kg-${s.id}-${segment.id}`} type="number" step="0.25" placeholder="Kg" value={segment.kg ?? ''} onChange={val => onUpdateSpecialSet(exIndex, s.id, 'segments', segment.id, 'kg', val)} style={{ margin: 0, minWidth: 0 }} />
                            {isIsometry ? (
                                <BufferedInput id={`${recoveryPrefix}seg-time-${s.id}-${segment.id}`} type="number" placeholder="Sec" value={segment.time ?? ''} onChange={val => onUpdateSpecialSet(exIndex, s.id, 'segments', segment.id, 'time', val)} style={{ margin: 0, minWidth: 0 }} />
                            ) : (
                                <BufferedInput id={`${recoveryPrefix}seg-reps-${s.id}-${segment.id}`} type="number" placeholder="Reps" value={segment.reps ?? ''} onChange={val => onUpdateSpecialSet(exIndex, s.id, 'segments', segment.id, 'reps', val)} style={{ margin: 0, minWidth: 0 }} />
                            )}
                            <button className="btn-icon" aria-label={`Rimuovi ${label}`} style={{ minWidth: '44px', minHeight: '44px', color: 'var(--danger-color)' }} onClick={() => onRemoveSpecialSet(exIndex, s.id, 'segments', segment.id)}>✕</button>
                        </div>
                        {(technique === 'rep_match' || technique === 'diminishing') && Boolean(segment.technique) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' }}>
                                <span style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>Target reps</span>
                                <BufferedInput
                                    id={`${recoveryPrefix}seg-target-${s.id}-${segment.id}`}
                                    type="number"
                                    placeholder="—"
                                    value={segment.target?.reps ?? ''}
                                    onChange={val => {
                                        const parsed = Number(val);
                                        onUpdateSpecialSet(
                                            exIndex,
                                            s.id,
                                            'segments',
                                            segment.id,
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
    );
}
