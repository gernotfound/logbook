import React, { useState, useMemo, useCallback } from 'react';
import MuscleModelPaths from './MuscleModelPaths';
import { Logic } from '../../lib/logic';

const MUSCLE_NAMES_MAP = new Map<string, string>(Logic.MUSCLES.map(m => [m.id, m.name]));

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
    selectedMuscles = [],
    secondaryMuscles = [],
    muscleColors,
    interactive = false,
    onToggleMuscle
}: MuscleModelProps) {
    const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });

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

        let fill = 'var(--surface-light)';
        if (isPrimary) {
            fill = 'var(--primary-color)';
        } else if (isSecondary) {
            fill = 'var(--secondary-color)';
        }

        return {
            fill,
            stroke: 'var(--text-muted)',
            strokeWidth: '0.3',
            cursor: interactive ? 'pointer' : 'default',
        };
    }, [muscleColors, primaryIds, secondaryIds, interactive]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const target = e.target as SVGElement;
        if (target.tagName === 'path' && target.id) {
            const logicId = REVERSE_GROUP_MAP[target.id];
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
        if (target.tagName === 'path' && target.id) {
            const logicId = REVERSE_GROUP_MAP[target.id];
            if (logicId) {
                onToggleMuscle(logicId);
            }
        }
    }, [interactive, onToggleMuscle]);

    return (
        <div className={`muscle-map-container ${interactive ? 'interactive' : ''}`} style={{ position: 'relative', width: '100%', padding: '30px 0 10px 0', margin: '0 auto', overflow: 'hidden', textAlign: 'center' }}>
            <svg
                role="img"
                aria-label="Mappa dei muscoli: vista anteriore e posteriore"
                viewBox="0 5 70 89"
                style={{ width: '100%', height: 'auto', backgroundColor: 'transparent', borderRadius: 0, overflow: 'visible' }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
            >
                <g id="figures" stroke="var(--text-muted)" strokeWidth="0.3" fill="var(--surface-light)">
                    <MuscleModelPaths getPathStyle={getPathStyle} />
                </g>
            </svg>

            {!muscleColors && (selectedMuscles.length > 0 || secondaryMuscles.length > 0) && <p className="muscle-legend">{selectedMuscles.length > 0 && <>Primari: {selectedMuscles.map(id => Logic.getMuscleName(id)).join(', ')}. </>}{secondaryMuscles.length > 0 && <>Secondari: {secondaryMuscles.map(id => Logic.getMuscleName(id)).join(', ')}.</>}</p>}
            {interactive && onToggleMuscle && <details className="muscle-text-selection"><summary>Seleziona muscoli dall’elenco</summary><div className="muscle-text-options">{Logic.MUSCLES.map(m => <button key={m.id} type="button" aria-pressed={selectedMuscles.includes(m.id) || secondaryMuscles.includes(m.id) || !!muscleColors?.[m.id]} onClick={() => onToggleMuscle(m.id)}>{m.name}{selectedMuscles.includes(m.id) || secondaryMuscles.includes(m.id) || !!muscleColors?.[m.id] ? ' ✓' : ''}</button>)}</div></details>}
            {tooltip.visible && (
                <div style={{
                    position: 'fixed',
                    left: tooltip.x + 15,
                    top: tooltip.y + 15,
                    backgroundColor: 'var(--surface-color)',
                    color: 'var(--text-main)',
                    padding: '6px 12px',
                    borderRadius: '6px',

                    fontWeight: 'bold',
                    pointerEvents: 'none',
                    zIndex: 9999,
                    border: '1px solid var(--glass-border)',
                    whiteSpace: 'nowrap'
                }} className="text-sm">
                    {tooltip.text}
                </div>
            )}
        </div>
    );
}
