import { Logic } from '../../../lib/logic';
import { Flame, Dumbbell, Settings } from 'lucide-react';

interface HeaderDashboardProps {
    streak: number;
    totalWorkouts: number;
    onOpenSettings?: () => void;
}

const HeaderDashboard = ({ streak, totalWorkouts, onOpenSettings }: HeaderDashboardProps) => {
    const today = Logic.getLocalDateString();
    const formattedDate = Logic.formatItalianDate ? Logic.formatItalianDate(today) : today;

    return (
        <header className="home-header">
            <div className="home-header-copy">
                <p className="text-sm home-muted">{formattedDate}</p>
                <h1>LogBook</h1>
            </div>
            <div className="home-header-actions">
                <div className="home-header-stats">
                    <span className="home-badge"><Flame size={18} aria-hidden="true" /><strong>{streak || 0}</strong> Streak</span>
                    <span className="home-badge"><Dumbbell size={18} aria-hidden="true" /><strong>{totalWorkouts}</strong> Sessioni</span>
                </div>
                <button type="button" className="home-settings-button" aria-label="Apri impostazioni" onClick={onOpenSettings}>
                    <Settings size={24} aria-hidden="true" />
                </button>
            </div>
        </header>
    );
};
export default HeaderDashboard;
