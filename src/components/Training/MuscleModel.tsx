import React, { useState, useMemo } from 'react';
import MuscleModelPaths from './MuscleModelPaths';
import { Logic } from '../../lib/logic';

interface MuscleModelProps {
    selectedMuscles?: string[];
    secondaryMuscles?: string[];
    interactive?: boolean;
    onToggleMuscle?: (muscleId: string) => void;
}

export default function MuscleModel({ 
    selectedMuscles = [], 
    secondaryMuscles = [], 
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

    const primaryIds = new Set<string>();
    const secondaryIds = new Set<string>();

    selectedMuscles.forEach(muscle => {
        const mapped = (Logic.GROUP_MAP as any)[muscle];
        if (mapped) {
            mapped.forEach((id: string) => primaryIds.add(id));
        } else {
            primaryIds.add(muscle);
        }
    });

    secondaryMuscles.forEach(muscle => {
        const mapped = (Logic.GROUP_MAP as any)[muscle];
        if (mapped) {
            mapped.forEach((id: string) => secondaryIds.add(id));
        } else {
            secondaryIds.add(muscle);
        }
    });

    const getPathStyle = (id: string) => {
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
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const target = e.target as SVGElement;
        if (target.tagName === 'path' && target.id) {
            const logicId = reverseMap[target.id];
            if (logicId) {
                const muscleDef = Logic.MUSCLES.find(m => m.id === logicId);
                const name = muscleDef ? muscleDef.name : logicId;
                setTooltip({
                    visible: true,
                    text: name,
                    x: e.clientX,
                    y: e.clientY
                });
                return;
            }
        }
        if (tooltip.visible) {
            setTooltip(prev => ({ ...prev, visible: false }));
        }
    };

    const handleMouseLeave = () => {
        setTooltip(prev => ({ ...prev, visible: false }));
    };

    const handleClick = (e: React.MouseEvent) => {
        if (!interactive || !onToggleMuscle) return;
        const target = e.target as SVGElement;
        if (target.tagName === 'path' && target.id) {
            const logicId = reverseMap[target.id];
            if (logicId) {
                onToggleMuscle(logicId);
            }
        }
    };

    return (
        <div className={`muscle-map-container ${interactive ? 'interactive' : ''}`} style={{ position: 'relative', width: 'calc(100% + 30px)', padding: '10px 0', margin: '0 -15px', overflowX: 'visible', textAlign: 'center' }}>
            <svg 
                viewBox="2 5 66 89" 
                style={{ width: '100%', maxWidth: '800px', backgroundColor: 'transparent', borderRadius: 0, overflow: 'visible' }}
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
