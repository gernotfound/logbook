import React from 'react';
import { Utensils } from 'lucide-react';

interface HomeNutritionWidgetProps {
    kcalEaten?: number;
    kcalTarget?: number;
    carbs?: number;
    pro?: number;
    fat?: number;
    onNavigate: (view: string) => void;
}

export const HomeNutritionWidget: React.FC<HomeNutritionWidgetProps> = ({
    kcalEaten = 0,
    kcalTarget = 0,
    carbs = 0,
    pro = 0,
    fat = 0,
    onNavigate
}) => {
    const kcalPercent = kcalTarget > 0 ? Math.min((kcalEaten / kcalTarget) * 100, 100) : 0;
    
    // Simplistic targets for macros (assuming roughly standard split if not provided)
    // Here we'll just display the amounts in mini circles or bars, or just data.
    // The main progress ring is for calories.

    return (
        <div style={{ padding: '20px', cursor: 'pointer' }} onClick={() => onNavigate('nutrition')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{margin: 0,color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Utensils size={20} color="var(--primary-color)" />
                    Nutrizione
                </h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Target: {kcalTarget} kcal
                </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                {/* Calories Progress Ring */}
                <div 
                    className="progress-ring" 
                    style={{ '--progress': kcalPercent } as React.CSSProperties}
                    role="progressbar"
                    aria-valuenow={Math.round(kcalPercent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Calorie: ${Math.round(kcalPercent)}% completato`}
                >
                    <div className="progress-ring-content">
                        <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--text-main)', lineHeight: 1 }}>{kcalEaten}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>kcal</span>
                    </div>
                </div>

                {/* Macros */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>CARBO</span>
                            <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{carbs}g</span>
                        </div>
                        <div className="progress-bg" style={{ height: '6px' }}>
                            <div className="progress-fill" style={{ width: `${Math.min((carbs / 300) * 100, 100)}%`, background: '#3b82f6' }}></div>
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>PRO</span>
                            <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{pro}g</span>
                        </div>
                        <div className="progress-bg" style={{ height: '6px' }}>
                            <div className="progress-fill" style={{ width: `${Math.min((pro / 150) * 100, 100)}%`, background: '#ef4444' }}></div>
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>GRASSI</span>
                            <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{fat}g</span>
                        </div>
                        <div className="progress-bg" style={{ height: '6px' }}>
                            <div className="progress-fill" style={{ width: `${Math.min((fat / 80) * 100, 100)}%`, background: '#eab308' }}></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HomeNutritionWidget;
