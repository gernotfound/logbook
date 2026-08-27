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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
                <h1 style={{ margin: 0, fontSize: '1.8rem', color: 'var(--text-main)' }}>LogBook</h1>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formattedDate}</p>
            </div>
            
            <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    background: 'rgba(255, 255, 255, 0.05)', 
                    padding: '6px 10px', 
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                }}>
                    <Flame size={16} color={streak > 0 ? 'var(--warning-color)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: streak > 0 ? 'var(--warning-color)' : 'var(--text-muted)' }}>
                        {streak || 0}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '2px' }}>Streak</span>
                </div>
                
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    background: 'rgba(255, 255, 255, 0.05)', 
                    padding: '6px 10px', 
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                }}>
                    <Dumbbell size={16} color="var(--primary-color)" />
                    <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                        {totalWorkouts}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '2px' }}>Sessioni</span>
                </div>
            </div>
        </div>
    );
};

export default HeaderDashboard;
