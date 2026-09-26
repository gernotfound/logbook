import React, { useState, useMemo, useCallback, useId } from 'react';
import MuscleModelPaths from './MuscleModelPaths';
import { Logic } from '../../lib/logic';

const MUSCLE_NAMES_MAP = new Map<string, string>(Logic.MUSCLES.map(m => [m.id, m.name]));
const EMPTY_MUSCLES: string[] = [];

const REVERSE_GROUP_MAP: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    const keys = Object.keys(Logic.GROUP_MAP).sort((a, b) => 
        (Logic.GROUP_MAP as any)[a].length - (Logic.GROUP_MAP as any)[b].length
    );
    for (const key of keys) {
        const paths = (Logic.GROUP_MAP as any)[key];
        for (const p of paths) {
            if (!map[p]) {
                map[p] = key;
            }
        }
    }
    return map;
})();

interface MuscleModelProps {
    selectedMuscles?: string[];
    secondaryMuscles?: string[];
    muscleColors?: Record<string, string>;
    interactive?: boolean;
    onToggleMuscle?: (muscleId: string) => void;
}

export default function MuscleModel({ 
    selectedMuscles = EMPTY_MUSCLES,
    secondaryMuscles = EMPTY_MUSCLES,
    muscleColors,
    interactive = false, 
    onToggleMuscle 
}: MuscleModelProps) {
    const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });
    const descriptionId = useId();
    const instanceId = useId().replace(/:/g, '');
    const getPathId = useCallback((pathId: string) => `${instanceId}-${pathId}`, [instanceId]);

    const primaryIds = useMemo(() => {
        const set = new Set<string>();
        selectedMuscles.forEach(muscle => {
            if (!muscle || typeof muscle !== 'string') return;
            const mapped = (Logic.GROUP_MAP as any)[muscle];
            if (mapped) {
                mapped.forEach((id: string) => set.add(id));
            } else {
                set.add(muscle);
            }
        });
        return set;
    }, [selectedMuscles]);

    const secondaryIds = useMemo(() => {
        const set = new Set<string>();
        secondaryMuscles.forEach(muscle => {
            if (!muscle || typeof muscle !== 'string') return;
            const mapped = (Logic.GROUP_MAP as any)[muscle];
            if (mapped) {
                mapped.forEach((id: string) => set.add(id));
            } else {
                set.add(muscle);
            }
        });
        return set;
    }, [secondaryMuscles]);

    const getPathStyle = useCallback((id: string) => {
        const logicId = REVERSE_GROUP_MAP[id];
        
        if (muscleColors) {
            let customColor = muscleColors[id] || (logicId ? muscleColors[logicId] : undefined);
            if (!customColor) {
                for (const [groupKey, color] of Object.entries(muscleColors)) {
                    const paths = (Logic.GROUP_MAP as any)[groupKey];
                    if (paths && Array.isArray(paths) && paths.includes(id)) {
                        customColor = color;
                        break;
                    }
                }
            }
            if (customColor) {
                return {
                    fill: customColor,
                    transition: 'fill 0.3s ease',
                    stroke: 'var(--bg-card)',
                    strokeWidth: '0.5'
                };
            }
        }

        const isPrimary = primaryIds.has(id);
        const isSecondary = secondaryIds.has(id);
        
        let fill = 'var(--surface-light, #1a1a1a)';
        if (isPrimary) {
            fill = 'var(--primary-color, #00e5ff)';
        } else if (isSecondary) {
            fill = 'var(--secondary-color, rgba(0, 229, 255, 0.3))';
        }

        return {
            fill,
            stroke: 'var(--text-muted, #9ba3af)',
            strokeWidth: '0.3',
            cursor: interactive ? 'pointer' : 'default',
        };
    }, [muscleColors, primaryIds, secondaryIds, interactive]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const target = e.target as SVGElement;
        if (target.tagName === 'path') {
            const pathId = target.dataset.musclePath;
            const logicId = pathId ? REVERSE_GROUP_MAP[pathId] : undefined;
            if (logicId) {
                const name = MUSCLE_NAMES_MAP.get(logicId) || logicId;
                const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
                if (!isTouch) {
                    setTooltip({
                        visible: true,
                        text: name,
                        x: e.clientX,
                        y: e.clientY
                    });
                }
                return;
            }
        }
        if (tooltip.visible) {
            setTooltip(prev => ({ ...prev, visible: false }));
        }
    }, [tooltip.visible]);

    const handleMouseLeave = useCallback(() => {
        setTooltip(prev => ({ ...prev, visible: false }));
    }, []);

    const handleClick = useCallback((e: React.MouseEvent) => {
        if (!interactive || !onToggleMuscle) return;
        const target = e.target as SVGElement;
        if (target.tagName === 'path') {
            const pathId = target.dataset.musclePath;
            const logicId = pathId ? REVERSE_GROUP_MAP[pathId] : undefined;
            if (logicId) {
                onToggleMuscle(logicId);
            }
        }
    }, [interactive, onToggleMuscle]);

    return (
        <div className={`muscle-map-container ${interactive ? 'interactive' : ''}`} style={{ position: 'relative', width: '100%', padding: '30px 0 10px 0', margin: '0 auto', overflow: 'hidden', textAlign: 'center' }}>
            <svg
                role="img"
                aria-label="Mappa dei muscoli, vista anteriore e posteriore"
                aria-describedby={descriptionId}
                viewBox="0 5 70 89"
                style={{ width: '100%', height: 'auto', backgroundColor: 'transparent', borderRadius: 0, overflow: 'visible' }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
            >
                <g id={`${instanceId}-figures`} stroke="var(--text-muted, #9ba3af)" strokeWidth="0.3" fill="var(--surface-light, #1a1a1a)">
                    <MuscleModelPaths getPathStyle={getPathStyle} getPathId={getPathId} />
                </g>
            </svg>

            <p id={descriptionId} className="muscle-legend">
                {selectedMuscles.length === 0 && secondaryMuscles.length === 0
                    ? 'Nessun muscolo evidenziato.'
                    : (
                        <>
                            {selectedMuscles.length > 0 ? `Primari: ${selectedMuscles.map(Logic.getMuscleName).join(', ')}. ` : ''}
                            {secondaryMuscles.length > 0 ? `Secondari: ${secondaryMuscles.map(Logic.getMuscleName).join(', ')}.` : ''}
                        </>
                    )}
            </p>

            {interactive && onToggleMuscle ? (
                <details className="muscle-text-selection">
                    <summary className="disclosure-summary">Seleziona muscoli dall’elenco</summary>
                    <div className="muscle-text-options">
                        {Logic.MUSCLES.map(muscle => {
                            const isSelected = selectedMuscles.includes(muscle.id)
                                || secondaryMuscles.includes(muscle.id)
                                || Boolean(muscleColors?.[muscle.id]);
                            return (
                                <button
                                    key={muscle.id}
                                    type="button"
                                    aria-pressed={isSelected}
                                    onClick={() => onToggleMuscle(muscle.id)}
                                >
                                    {muscle.name}{isSelected ? ' ✓' : ''}
                                </button>
                            );
                        })}
                    </div>
                </details>
            ) : null}

            {tooltip.visible && (
                <div style={{
                    position: 'fixed',
                    left: tooltip.x + 15,
                    top: tooltip.y + 15,
                    backgroundColor: 'var(--surface-color, #0d0d0d)',
                    color: 'var(--text-main, #f0f0f0)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    pointerEvents: 'none',
                    zIndex: 9999,
                    border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
                    whiteSpace: 'nowrap'
                }} className="text-sm">
                    {tooltip.text}
                </div>
            )}
        </div>
    );
}
