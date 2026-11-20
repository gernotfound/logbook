import React, { useState } from 'react';
import MuscleModel from '../../Training/MuscleModel';
import { Activity, ChevronDown } from 'lucide-react';
import { RecoveryPainSearch } from './RecoveryPainSearch';
import { RecoveryPainBadges } from './RecoveryPainBadges';

interface RecoveryBentoCardProps {
    activePains: string[];
    painColors: Record<string, string>;
    muscleColors?: Record<string, string>;
    onTogglePain: (muscleId: string) => void;
}

const RecoveryBentoCardContent: React.FC<RecoveryBentoCardProps> = ({ activePains = [], painColors, muscleColors = {}, onTogglePain }) => {
    const combinedColors = { ...muscleColors, ...painColors };
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="home-recovery">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{margin: 0, display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Activity size={18} color="var(--danger-color)" />
                    Esposizione recente e dolori
                </h2>
                <button
                    type="button"
                    onClick={() => activePains.length > 0 && setIsExpanded(v => !v)}
                    disabled={activePains.length === 0}
                    aria-expanded={isExpanded}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: 'var(--font-size-micro)',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: activePains.length > 0 ? 'var(--danger-soft)' : 'var(--surface-light)',
                        color: activePains.length > 0 ? 'var(--danger-color)' : 'var(--text-muted)',
                        border: activePains.length > 0 ? '1px solid var(--danger-color)' : '1px solid var(--border-color)',
                        cursor: activePains.length > 0 ? 'pointer' : 'default',
                        transition: 'all 0.2s ease'
                    }}
                >
                    {activePains.length > 0 ? `${activePains.length} dolori attivi` : '0 dolori attivi'}
                    {activePains.length > 0 && (
                        <ChevronDown 
                            size={14} 
                            style={{ 
                                transition: 'transform 0.25s ease',
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                            }} 
                        />
                    )}
                </button>
            </div>

            <RecoveryPainSearch activePains={activePains} onTogglePain={onTogglePain} />
            <RecoveryPainBadges activePains={activePains} expanded={isExpanded} onTogglePain={onTogglePain} />

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--surface-light)', padding: '12px', borderRadius: '12px' }}>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                    <MuscleModel 
                        muscleColors={combinedColors} 
                        interactive={false} 
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '12px', fontSize: 'var(--font-size-micro)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--muscle-recent)' }}></div>
                        <span style={{ color: 'var(--text-muted)' }}>Allenato di recente</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--muscle-pain)' }}></div>
                        <span style={{ color: 'var(--text-muted)' }}>Dolorante</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// A transition through zero active pains remounts the disclosure in its
// collapsed state without synchronizing React state from an effect.
const RecoveryBentoCard: React.FC<RecoveryBentoCardProps> = props => (
    <RecoveryBentoCardContent
        key={props.activePains.length === 0 ? 'empty' : 'has-pains'}
        {...props}
    />
);

export default RecoveryBentoCard;
