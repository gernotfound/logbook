import React from 'react';
import MuscleModel from '../../Training/MuscleModel';
import { Activity } from 'lucide-react';

interface RecoveryBentoCardProps {
    activePains: string[];
    painColors: Record<string, string>;
}

const RecoveryBentoCard: React.FC<RecoveryBentoCardProps> = ({ activePains, painColors }) => {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={18} color="#ff4d6d" />
                    Recupero
                </h2>
                <span 
                    style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: activePains.length > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                        color: activePains.length > 0 ? '#ff4d6d' : 'var(--text-muted)',
                        border: activePains.length > 0 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)'
                    }}
                >
                    {activePains.length > 0 ? `${activePains.length} attivi` : '0 attivi'}
                </span>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ maxHeight: '140px', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
                    <MuscleModel 
                        muscleColors={painColors} 
                        interactive={false} 
                    />
                </div>
            </div>
        </div>
    );
};

export default RecoveryBentoCard;
