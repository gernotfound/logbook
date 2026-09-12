import React from 'react';
import { Activity, Scale } from 'lucide-react';

interface BiometryBentoCardProps {
    weightStats: any;
    bf: string | number;
}

const BiometryBentoCard: React.FC<BiometryBentoCardProps> = ({ weightStats, bf }) => {
    const delta = weightStats?.weightDelta;
    const hasDelta = delta !== null && delta !== undefined && delta !== 0;

    return (
        <div className="home-compact-widget home-biometry">
            <h2 className="home-compact-heading">
                <Scale size={18} aria-hidden="true" />
                Biometria
            </h2>

            <div className="home-metric-stack">
                <div className="home-metric-tile">
                    <span className="home-metric-label">Ultimo peso</span>
                    {weightStats?.latestWeight ? (
                        <div className="home-metric-value-row">
                            <strong className="home-metric-value">
                                {weightStats.latestWeight} <span>kg</span>
                            </strong>
                            {hasDelta && (
                                <span className={`home-metric-delta ${delta < 0 ? 'is-down' : 'is-up'}`}>
                                    {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
                                </span>
                            )}
                        </div>
                    ) : (
                        <strong className="home-metric-value is-empty">—</strong>
                    )}
                </div>

                <div className="home-metric-tile">
                    <span className="home-metric-label home-metric-label--icon">
                        <Activity size={13} aria-hidden="true" />
                        Massa grassa
                    </span>
                    <strong className={`home-metric-value ${bf === '--' ? 'is-empty' : ''}`}>
                        {bf !== '--' ? `${bf} %` : '—'}
                    </strong>
                </div>
            </div>
        </div>
    );
};

export default BiometryBentoCard;
