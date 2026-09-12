import React from 'react';
import { Logic } from '../../../lib/logic';
import { Flame, Dumbbell } from 'lucide-react';

interface HeaderDashboardProps {
    streak: number;
    totalWorkouts: number;
}

const HeaderDashboard: React.FC<HeaderDashboardProps> = ({ streak, totalWorkouts }) => {
    const today = Logic.getLocalDateString();
    const formattedDate = Logic.formatItalianDate ? Logic.formatItalianDate(today) : today;

    return (
        <header className="dashboard-header">
            <div className="dashboard-header__brand">
                <h1 className="dashboard-header__title">LogBook</h1>
                <p className="dashboard-header__date">{formattedDate}</p>
            </div>

            <div className="dashboard-metrics" aria-label="Riepilogo attività">
                <div
                    className={`metric-chip ${streak > 0 ? 'metric-chip--warning' : ''}`}
                    aria-label={`${streak || 0} giorni di streak`}
                >
                    <Flame size={16} aria-hidden="true" />
                    <span className="metric-chip__value">{streak || 0}</span>
                    <span className="metric-chip__label">Streak</span>
                </div>

                <div className="metric-chip" aria-label={`${totalWorkouts} sessioni totali`}>
                    <Dumbbell size={16} aria-hidden="true" />
                    <span className="metric-chip__value">{totalWorkouts}</span>
                    <span className="metric-chip__label">Sessioni</span>
                </div>
            </div>
        </header>
    );
};

export default HeaderDashboard;
