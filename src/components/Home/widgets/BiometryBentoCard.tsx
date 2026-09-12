import React from 'react';
import { Scale, Activity } from 'lucide-react';

interface BiometryBentoCardProps {
    weightStats: any;
    bf: string | number;
}

const BiometryBentoCard: React.FC<BiometryBentoCardProps> = ({ weightStats, bf }) => {
    const weightDelta = weightStats?.weightDelta;
    const deltaClass = weightDelta < 0 ? 'stat-delta--down' : 'stat-delta--up';

    return (
        <div className="home-card-stack">
            <h2 className="home-card-title">
                <Scale size={18} aria-hidden="true" />
                Biometria
            </h2>

            <div className="stat-tile-grid">
                <div className="stat-tile">
                    <div className="stat-tile__label">Ultimo peso</div>
                    {weightStats?.latestWeight ? (
                        <div className="stat-tile__value-row">
                            <span className="stat-tile__value">
                                {weightStats.latestWeight} <span className="stat-tile__unit">kg</span>
                            </span>
                            {weightDelta !== null && weightDelta !== undefined && weightDelta !== 0 && (
                                <span className={`stat-delta ${deltaClass}`}>
                                    {weightDelta > 0 ? `+${weightDelta.toFixed(1)}` : weightDelta.toFixed(1)}
                                </span>
                            )}
                        </div>
                    ) : (
                        <div className="stat-tile__empty">--</div>
                    )}
                </div>

                <div className="stat-tile">
                    <div className="stat-tile__label">
                        <Activity size={12} aria-hidden="true" />
                        Massa grassa
                    </div>
                    <div className={bf !== '--' ? 'stat-tile__value' : 'stat-tile__empty'}>
                        {bf !== '--' ? `${bf} %` : '--'}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BiometryBentoCard;
