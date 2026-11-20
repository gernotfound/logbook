import React, { useState, useMemo, useCallback, useId } from 'react';
import MuscleModelPaths from './MuscleModelPaths';
import { Logic } from '../../lib/logic';
import { expandMusclePaths, getMuscleForPath, getMusclePathStyle } from '../../lib/calc/muscleMapPresentation';

const MUSCLE_NAMES_MAP = new Map<string, string>(Logic.MUSCLES.map(m => [m.id, m.name]));
const EMPTY_MUSCLES: string[] = [];

interface MuscleModelProps {
    selectedMuscles?: string[];
    secondaryMuscles?: string[];
    muscleColors?: Record<string, string>;
    interactive?: boolean;
    onToggleMuscle?: (muscleId: string) => void;
    showLegend?: boolean;
    selectedMusclesLabel?: string;
    showTextSelection?: boolean;
}

export default function MuscleModel({ 
    selectedMuscles = EMPTY_MUSCLES,
    secondaryMuscles = EMPTY_MUSCLES,
    muscleColors,
    interactive = false,
    onToggleMuscle,
    showLegend = true,
    selectedMusclesLabel = 'Primari',
    showTextSelection = true,
}: MuscleModelProps) {
    const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });
    const descriptionId = useId();
    const instanceId = useId().replace(/:/g, '');
    const getPathId = useCallback((pathId: string) => `${instanceId}-${pathId}`, [instanceId]);

    const primaryIds = useMemo(() => expandMusclePaths(selectedMuscles), [selectedMuscles]);
    const secondaryIds = useMemo(() => expandMusclePaths(secondaryMuscles), [secondaryMuscles]);
    const getPathStyle = useCallback(
        (id: string) => getMusclePathStyle(id, primaryIds, secondaryIds, muscleColors, interactive),
        [primaryIds, secondaryIds, muscleColors, interactive],
    );

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const target = e.target as SVGElement;
        if (target.tagName === 'path') {
            const pathId = target.dataset.musclePath;
            const logicId = pathId ? getMuscleForPath(pathId) : undefined;
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
            const logicId = pathId ? getMuscleForPath(pathId) : undefined;
            if (logicId) {
                onToggleMuscle(logicId);
            }
        }
    }, [interactive, onToggleMuscle]);

    return (
        <div className={`muscle-map-container ${interactive ? 'interactive' : ''}`} style={{ position: 'relative', width: '100%', padding: '8px 0 10px 0', margin: '0 auto', overflow: 'hidden', textAlign: 'center' }}>
            <svg
                role="img"
                aria-label="Mappa dei muscoli, vista anteriore e posteriore"
                aria-describedby={showLegend ? descriptionId : undefined}
                viewBox="0 0 70 94"
                style={{ width: '100%', height: 'auto', backgroundColor: 'transparent', borderRadius: 0, overflow: 'visible' }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
            >
                <g id={`${instanceId}-figures`} stroke="var(--text-muted)" strokeWidth="0.3" fill="var(--surface-light)">
                    <MuscleModelPaths getPathStyle={getPathStyle} getPathId={getPathId} />
                </g>
            </svg>

            {showLegend && (
                <p id={descriptionId} className="muscle-legend">
                    {selectedMuscles.length === 0 && secondaryMuscles.length === 0
                        ? 'Nessun muscolo evidenziato.'
                        : (
                            <>
                                {selectedMuscles.length > 0 ? `${selectedMusclesLabel}: ${selectedMuscles.map(Logic.getMuscleName).join(', ')}. ` : ''}
                                {secondaryMuscles.length > 0 ? `Secondari: ${secondaryMuscles.map(Logic.getMuscleName).join(', ')}.` : ''}
                            </>
                        )}
                </p>
            )}

            {interactive && onToggleMuscle && showTextSelection ? (
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
