import { Flame, Dumbbell } from 'lucide-react';
import { Logic } from '../../../lib/logic';

interface HeaderDashboardProps { streak: number; totalWorkouts: number; }

export default function HeaderDashboard({ streak, totalWorkouts }: HeaderDashboardProps) {
    const today = Logic.getLocalDateString();
    return (
        <header className="home-header">
            <div>
                <p className="text-sm home-muted">{Logic.formatItalianDate ? Logic.formatItalianDate(today) : today}</p>
                <h1>LogBook</h1>
            </div>
            <div className="home-header-stats">
                <span className="home-badge"><Flame size={18} aria-hidden="true" /><strong>{streak || 0}</strong> Streak</span>
                <span className="home-badge"><Dumbbell size={18} aria-hidden="true" /><strong>{totalWorkouts}</strong> Sessioni</span>
            </div>
        </header>
    );
}
