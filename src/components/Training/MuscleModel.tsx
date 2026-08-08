import React, { useState, useMemo, useCallback } from 'react';
import MuscleModelPaths from './MuscleModelPaths';
import { Logic } from '../../lib/logic';

const MUSCLE_NAMES_MAP = new Map<string, string>(Logic.MUSCLES.map(m => [m.id, m.name]));

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

    const reverseMap = useMemo(() => {
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
    }, []);

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
        const logicId = reverseMap[id];
        
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
        
        let fill = 'transparent';
        if (isPrimary) {
            fill = 'var(--primary-color, #00e5ff)';
        } else if (isSecondary) {
            fill = 'var(--secondary-color, rgba(0, 229, 255, 0.3))';
        }

        return {
            fill,
            transition: 'all 0.3s ease',
            cursor: interactive ? 'pointer' : 'default',
        };
    }, [reverseMap, muscleColors, primaryIds, secondaryIds, interactive]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const target = e.target as SVGElement;
        if (target.tagName === 'path' && target.id) {
            const logicId = reverseMap[target.id];
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
    }, [reverseMap, tooltip.visible]);

    const handleMouseLeave = useCallback(() => {
        setTooltip(prev => ({ ...prev, visible: false }));
    }, []);

    const handleClick = useCallback((e: React.MouseEvent) => {
        if (!interactive || !onToggleMuscle) return;
        const target = e.target as SVGElement;
        if (target.tagName === 'path' && target.id) {
            const logicId = reverseMap[target.id];
            if (logicId) {
                onToggleMuscle(logicId);
            }
        }
    }, [interactive, onToggleMuscle, reverseMap]);

    return (
        <div className={`muscle-map-container ${interactive ? 'interactive' : ''}`} style={{ position: 'relative', width: '100%', padding: '30px 0 10px 0', margin: '0 auto', overflow: 'hidden', textAlign: 'center' }}>
            <svg 
                viewBox="0 5 70 89" 
                style={{ width: '100%', height: 'auto', backgroundColor: 'transparent', borderRadius: 0, overflow: 'visible' }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
            >
                <defs>
                    <pattern id="textured_black_pattern" width="10" height="10" patternUnits="userSpaceOnUse">
                        <rect width="10" height="10" fill="#222"></rect>
                        <circle cx="5" cy="5" r="1" fill="#444"></circle>
                    </pattern>
                </defs>
                <g id="figures" stroke="#CCCCCC" strokeWidth="0.3" fill="transparent">
                    <MuscleModelPaths getPathStyle={getPathStyle} />
                </g>
            </svg>

            {tooltip.visible && (
                <div style={{
                    position: 'fixed',
                    left: tooltip.x + 15,
                    top: tooltip.y + 15,
                    backgroundColor: 'rgba(0,0,0,0.85)',
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    pointerEvents: 'none',
                    zIndex: 9999,
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    whiteSpace: 'nowrap'
                }}>
                    {tooltip.text}
                </div>
            )}
        </div>
    );
}
