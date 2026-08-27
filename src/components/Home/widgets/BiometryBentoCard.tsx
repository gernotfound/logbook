import React from 'react';
import { Scale, Activity } from 'lucide-react';

interface BiometryBentoCardProps {
    weightStats: any;
    bf: string | number;
}

const BiometryBentoCard: React.FC<BiometryBentoCardProps> = ({ weightStats, bf }) => {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '15px' }}>
            <h2 style={{ fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Scale size={18} color="var(--primary-color)" />
                Biometria
            </h2>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '12px', marginBottom: '10px' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Ultimo peso</div>
                    {weightStats?.latestWeight ? (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                            <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                                {weightStats.latestWeight} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>kg</span>
                            </span>
                            {weightStats.weightDelta !== null && (
                                <span style={{
                                    fontWeight: '600',
                                    fontSize: '0.75rem',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    background: weightStats.weightDelta < 0 ? 'rgba(74, 222, 128, 0.15)' : (weightStats.weightDelta > 0 ? 'rgba(248, 113, 113, 0.15)' : 'rgba(255, 255, 255, 0.08)'),
                                    color: weightStats.weightDelta < 0 ? '#4ade80' : (weightStats.weightDelta > 0 ? '#f87171' : 'var(--text-muted)')
                                }}>
                                    {weightStats.weightDelta > 0 ? `+${weightStats.weightDelta.toFixed(1)}` : weightStats.weightDelta.toFixed(1)}
                                </span>
                            )}
                        </div>
                    ) : (
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>--</div>
                    )}
                </div>

                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '12px' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Activity size={12} />
                        Massa grassa
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: bf !== '--' ? 'var(--text-main)' : 'var(--text-muted)' }}>
                        {bf !== '--' ? `${bf} %` : '--'}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BiometryBentoCard;
