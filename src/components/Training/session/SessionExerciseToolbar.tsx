import { useEffect, useRef, useState } from 'react';
import { Trash2, Settings, History } from 'lucide-react';

interface SessionExerciseToolbarProps {
    exIndex: number;
    totalExercises?: number;
    isHistoryOpen: boolean;
    isSetupOpen: boolean;
    onMoveToPosition?: (fromIndex: number, toIndex: number) => void;
    onRemoveExercise: (exIndex: number) => void;
    onToggleHistory: (exIndex: number) => void;
    onToggleSetup: (exIndex: number) => void;
}

export default function SessionExerciseToolbar({
    exIndex, totalExercises, isHistoryOpen, isSetupOpen,
    onMoveToPosition, onRemoveExercise, onToggleHistory, onToggleSetup,
}: SessionExerciseToolbarProps) {
    const [showPositionMenu, setShowPositionMenu] = useState(false);
    const positionMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showPositionMenu) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (positionMenuRef.current && !positionMenuRef.current.contains(event.target as Node)) {
                setShowPositionMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showPositionMenu]);

    return (
        <div className="session-exercise-toolbar">
            <div style={{ position: 'relative' }} ref={positionMenuRef}>
                <button
                    type="button"
                    className="btn-small"
                    style={{ borderRadius: '8px', minWidth: '44px', minHeight: '44px', fontWeight: 'bold', fontSize: 'var(--font-size-meta)', letterSpacing: '0.03em', color: 'var(--text-main)' }}
                    onClick={() => setShowPositionMenu(v => !v)}
                    disabled={totalExercises !== undefined && totalExercises <= 1}
                    aria-label="Cambia posizione esercizio"
                    title={totalExercises !== undefined && totalExercises <= 1 ? 'Unico esercizio nella sessione' : 'Cambia posizione esercizio'}
                >#{exIndex + 1}</button>
                {showPositionMenu && totalExercises !== undefined && totalExercises > 1 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: 'var(--surface-color)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '4px', minWidth: '140px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', marginTop: '4px' }}>
                        {Array.from({ length: totalExercises }, (_, i) => i).map(targetIdx => (
                            <button
                                key={targetIdx}
                                type="button"
                                onClick={() => { setShowPositionMenu(false); if (targetIdx !== exIndex) onMoveToPosition?.(exIndex, targetIdx); }}
                                disabled={targetIdx === exIndex}
                                aria-current={targetIdx === exIndex ? 'true' : undefined}
                                style={{
                                    display: 'block', width: '100%', minHeight: '44px', padding: '8px 12px', textAlign: 'left',
                                    background: targetIdx === exIndex ? 'var(--primary-soft)' : 'transparent',
                                    border: 'none', color: targetIdx === exIndex ? 'var(--primary-color)' : 'var(--text-main)',
                                    cursor: targetIdx === exIndex ? 'default' : 'pointer', fontSize: 'var(--font-size-meta)', borderRadius: '6px'
                                }}
                            >{targetIdx === exIndex ? `✓ ${targetIdx + 1}ª posizione` : `${targetIdx + 1}ª posizione`}</button>
                        ))}
                    </div>
                )}
            </div>
            <button
                type="button"
                className="btn-small"
                style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '8px' }}
                onClick={() => onRemoveExercise(exIndex)}
                aria-label="Rimuovi esercizio dalla sessione"
            >
                <Trash2 size={16} aria-hidden="true" />
    
            </button>
            <button
                type="button"
                className={`btn-small toggle-btn ${isHistoryOpen ? 'active-highlight' : ''}`}
                style={isHistoryOpen ? { background: 'var(--primary-color)', color: 'var(--on-primary)' } : {}}
                onClick={() => onToggleHistory(exIndex)}
                aria-expanded={isHistoryOpen}
                aria-controls={`session-history-${exIndex}`}
            >
                <History size={16} aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} /> Storico
            </button>
            <button
                type="button"
                className={`btn-small toggle-btn ${isSetupOpen ? 'active-highlight' : ''}`}
                style={isSetupOpen ? { background: 'var(--primary-color)', color: 'var(--on-primary)' } : {}}
                onClick={() => onToggleSetup(exIndex)}
                aria-expanded={isSetupOpen}
                aria-controls={`session-setup-${exIndex}`}
            >
                <Settings size={16} aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} /> Setup
            </button>
        </div>
    );
}
