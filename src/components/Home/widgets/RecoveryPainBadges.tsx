import { Logic } from '../../../lib/logic';

interface RecoveryPainBadgesProps {
    activePains: string[];
    expanded: boolean;
    onTogglePain: (muscleId: string) => void;
}

export function RecoveryPainBadges({ activePains, expanded, onTogglePain }: RecoveryPainBadgesProps) {
    const isExpanded = expanded;
    return (
        {/* Active Pain Badges */}
        <div 
            style={{
                overflow: 'hidden',
                transition: 'max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease',
                maxHeight: isExpanded && activePains.length > 0 ? '500px' : '0',
                opacity: isExpanded && activePains.length > 0 ? 1 : 0,
                visibility: isExpanded && activePains.length > 0 ? 'visible' : 'hidden',
                marginTop: isExpanded && activePains.length > 0 ? '5px' : '0',
                marginBottom: isExpanded && activePains.length > 0 ? '5px' : '0'
            }}
            aria-hidden={!isExpanded}
        >
            {activePains.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {activePains.map(mId => (
                        <span 
                            key={mId} 
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: 'var(--danger-soft)',
                                border: '1px solid var(--danger-color)',
                                color: 'var(--danger-color)',
                                padding: '4px 10px',
                                borderRadius: '8px',
                                fontSize: 'var(--font-size-meta)',
                                fontWeight: 600
                            }}
                        >
                            {Logic.getMuscleName(mId)}
                            <button
                                type="button"
                                onClick={() => onTogglePain(mId)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--danger-color)',
                                    fontWeight: 'bold',
                                    fontSize: 'var(--font-size-meta)',
                                    cursor: 'pointer',
                                    padding: '0 2px',
                                    minWidth: '44px',
                                    minHeight: '44px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    lineHeight: 1
                                }}
                                aria-label={`Rimuovi dolore ${Logic.getMuscleName(mId)}`}
                            >
                                ✕
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
