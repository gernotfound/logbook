import React from 'react';
import { Dumbbell, Flame, Zap } from 'lucide-react';
import { Logic } from '../../../lib/logic';

interface HeaderDashboardProps {
    streak: number;
    totalWorkouts: number;
}

const HeaderDashboard: React.FC<HeaderDashboardProps> = ({ streak, totalWorkouts }) => {
    const today = Logic.getLocalDateString();
    const formattedDate = Logic.formatItalianDate ? Logic.formatItalianDate(today) : today;

    return (
        <header className="home-header">
            <div className="home-brand">
                <span className="home-brand__eyebrow"><Zap size={12} aria-hidden="true" /> Training log</span>
                <h1>LogBook</h1>
                <p>{formattedDate}</p>
            </div>

            <div className="home-kpis" aria-label="Statistiche rapide">
                <div className="home-kpi" title="Streak allenamenti">
                    <div className="home-kpi__top" style={{ color: streak > 0 ? 'var(--warning-color)' : undefined }}>
                        <Flame size={15} aria-hidden="true" />
                        <span>{streak || 0}</span>
                    </div>
                    <span className="home-kpi__label">Streak</span>
                </div>
                <div className="home-kpi" title="Sessioni totali">
                    <div className="home-kpi__top">
                        <Dumbbell size={15} color="var(--primary-color)" aria-hidden="true" />
                        <span>{totalWorkouts}</span>
                    </div>
                    <span className="home-kpi__label">Sessioni</span>
                </div>
            </div>
        </header>
    );
};

export default HeaderDashboard;
