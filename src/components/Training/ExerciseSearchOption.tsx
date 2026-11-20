import { Activity, Plus, Timer } from 'lucide-react';
import { getDetailedMuscleCategory } from '../../lib/logic';
import type { ExerciseLibraryItem } from '../../types';

interface ExerciseSearchOptionProps {
    exercise: ExerciseLibraryItem;
    index: number;
    listboxId: string;
    resultCount: number;
    highlighted: boolean;
    onSelect: () => void;
    onHover: () => void;
}

function ExerciseSearchBadges({ exercise }: { exercise: ExerciseLibraryItem }) {
    const primaryMuscleId = exercise.muscles?.[0] ?? null;
    const muscleCategory = primaryMuscleId ? getDetailedMuscleCategory(primaryMuscleId).label : null;

    return (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '3px' }}>
            {muscleCategory && (
                <span
                    style={{
                        fontSize: 'var(--font-size-micro)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'var(--primary-soft)',
                        color: 'var(--primary-color)',
                        fontWeight: 500,
                    }}
                >
                    {muscleCategory}
                </span>
            )}
            {exercise.trackingType === 'cardio' && (
                <span
                    style={{
                        fontSize: 'var(--font-size-micro)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'var(--success-soft)',
                        color: 'var(--success-color)',
                        fontWeight: 500,
                    }}
                >
                    <Activity size={12} aria-hidden="true" style={{ marginRight: '2px', display: 'inline-block', verticalAlign: 'middle' }} /> Cardio
                </span>
            )}
            {exercise.trackingType === 'time' && (
                <span
                    style={{
                        fontSize: 'var(--font-size-micro)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'var(--warning-soft)',
                        color: 'var(--warning-color)',
                        fontWeight: 500,
                    }}
                >
                    <Timer size={12} aria-hidden="true" style={{ marginRight: '2px', display: 'inline-block', verticalAlign: 'middle' }} /> Tempo
                </span>
            )}
        </div>
    );
}

export function ExerciseSearchOption({
    exercise, index, listboxId, resultCount, highlighted, onSelect, onHover,
}: ExerciseSearchOptionProps) {
    return (
        <div
            role="option"
            id={`${listboxId}-option-${index}`}
            aria-selected={highlighted}
            aria-posinset={index + 1}
            aria-setsize={resultCount}
            className="exercise-dropdown-item"
            onClick={onSelect}
            onMouseEnter={onHover}
            style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--glass-border)',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: highlighted ? 'var(--primary-soft)' : 'transparent',
                borderLeft: highlighted ? '3px solid var(--primary-color)' : '3px solid transparent',
                transition: 'background 0.15s ease, border-left 0.15s ease',
            }}
        >
            <div style={{ flex: 1, minWidth: 0, paddingRight: '10px' }}>
                <div
                    style={{
                        fontWeight: 600,
                        color: 'var(--text-main)',
                        fontSize: 'var(--font-size-body)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {exercise.name}
                </div>
                <ExerciseSearchBadges exercise={exercise} />
            </div>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    background: highlighted ? 'var(--primary-color)' : 'var(--surface-light)',
                    color: highlighted ? 'var(--on-primary)' : 'var(--text-main)',
                    flexShrink: 0,
                }}
            >
                <Plus size={16} />
            </div>
        </div>
    );
}
